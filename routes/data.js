/**
 * routes/data.js — 상품 데이터 및 검색 API
 *
 * Elasticsearch 퍼지 검색 + DB LIKE 폴백,
 * 아이템 처리(processItem), 환율 조회.
 * 마운트: /api/data
 */
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { pool } = require("../utils/DB");
const esManager = require("../utils/elasticsearch");
const { processItem } = require("../utils/processItem");
const {
  getExchangeRate,
  getCachedExchangeRate,
} = require("../utils/exchange-rate");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

// ===== 캐싱 관련 설정 =====
const STATS_CACHE_DURATION = 10 * 60 * 1000; // 통계 캐시: 10분

const cache = {
  filters: {
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
    // 추천 아이템만 대상으로 한 필터 캐시
    recommend: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
  },
};

// ===== 캐시 헬퍼 함수들 =====
function isCacheValid(cacheItem, duration) {
  const currentTime = new Date().getTime();

  return (
    cacheItem.data !== null &&
    cacheItem.lastFetched !== null &&
    currentTime - cacheItem.lastFetched < duration
  );
}

function updateCache(cacheItem, data) {
  cacheItem.data = data;
  cacheItem.lastFetched = new Date().getTime();
}

// ===== 기본 필터 조건 (단순화) =====
async function buildBaseFilterConditions(isRecommendOnly = false) {
  const conditions = ["ci.is_enabled = 1", "ci.auc_num != 3"];
  const queryParams = [];

  if (isRecommendOnly) {
    conditions.push("ci.recommend >= 1");
  }

  return { conditions, queryParams };
}

// rank 정규화 함수 추가 (파일 상단에)
function normalizeRank(rank) {
  if (!rank) return rank;

  // 전각 → 반각 변환
  const fullToHalf = rank
    .toString()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
    })
    .trim();

  return fullToHalf;
}

// ===== 메인 데이터 조회 라우터 =====
router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    favoriteNumbers,
    aucNums,
    search,
    ranks,
    auctionTypes,
    withDetails = "false",
    bidsOnly = "false",
    sortBy = "scheduled_date",
    sortOrder = "asc",
    excludeExpired = "true",
    minRecommend = 0,
  } = req.query;

  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    // 2. 사용자 입찰 데이터 조회 (통합 쿼리)
    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      const [userLiveBids] = await pool.query(
        `
        SELECT 'live' as bid_type, item_id, first_price, second_price, final_price, status, id
        FROM live_bids WHERE user_id = ?
      `,
        [userId],
      );

      const [userDirectBids] = await pool.query(
        `
        SELECT 'direct' as bid_type, item_id, current_price, status, id
        FROM direct_bids WHERE user_id = ?
      `,
        [userId],
      );

      const [userInstantPurchases] = await pool.query(
        `
        SELECT 'instant' as bid_type, item_id, purchase_price, status, id
        FROM instant_purchases WHERE user_id = ?
      `,
        [userId],
      );

      bidData = [...userLiveBids, ...userDirectBids, ...userInstantPurchases];
      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    // 3. 쿼리 구성 시작
    let baseQuery = "SELECT ci.* FROM crawled_items ci";
    const joins = [];
    const conditions = ["ci.is_enabled = 1", "ci.auc_num != 3"]; // 기본 조건: 활성화된 아이템만
    const queryParams = [];

    if (!userId) {
      conditions.push("ci.auc_num != 1"); // 비로그인 시 1번 경매 제외
      conditions.push("ci.auc_num != 2"); // 비로그인 시 2번 경매 제외
    }

    // 4. 추천 점수 필터
    if (minRecommend && parseInt(minRecommend) > 0) {
      conditions.push("ci.recommend >= ?");
      queryParams.push(parseInt(minRecommend));
    }

    // 5. 즐겨찾기 필터
    if (favoriteNumbers && userId) {
      const favoriteNumbersList = favoriteNumbers.split(",").map(Number);
      if (favoriteNumbersList.length > 0) {
        conditions.push(
          `ci.item_id IN (SELECT DISTINCT item_id FROM wishlists WHERE user_id = ? AND favorite_number IN (${favoriteNumbersList
            .map(() => "?")
            .join(",")}))`,
        );
        queryParams.push(userId, ...favoriteNumbersList);
      }
    }

    // 6. 기본 조건들
    if (excludeExpired === "true") {
      conditions.push("ci.is_expired = 0");
    }

    // 입찰한 아이템만 보기
    if (bidsOnly === "true" && userId) {
      if (userBidItemIds.length > 0) {
        conditions.push(
          `ci.item_id IN (${userBidItemIds.map(() => "?").join(",")})`,
        );
        queryParams.push(...userBidItemIds);
      } else {
        return res.json({
          data: [],
          wishlist: [],
          page: parseInt(page),
          limit: parseInt(limit),
          totalItems: 0,
          totalPages: 0,
        });
      }
    }

    // 7. 검색 조건 - Elasticsearch 사용
    if (search && search.trim()) {
      // ES가 활성화되어 있으면 ES 사용, 아니면 LIKE 사용
      if (esManager.isHealthy()) {
        try {
          // Elasticsearch로 검색
          const filters = {};

          // 기존 필터들을 ES 필터로 변환
          if (brands) filters.brand = brands.split(",");
          if (categories) filters.category = categories.split(",");
          if (aucNums) filters.auc_num = aucNums.split(",");

          const itemIds = await esManager.search(
            "crawled_items",
            search.trim(),
            filters,
            {
              fields: ["title^2", "brand"],
              fuzziness: "AUTO",
              operator: "and",
              size: 5000,
            },
          );

          if (itemIds.length > 0) {
            conditions.push(
              `ci.item_id IN (${itemIds.map(() => "?").join(",")})`,
            );
            queryParams.push(...itemIds);
          } else {
            return res.json({
              data: [],
              wishlist: [],
              page: parseInt(page),
              limit: parseInt(limit),
              totalItems: 0,
              totalPages: 0,
            });
          }
        } catch (esError) {
          console.error(
            "ES search failed, using DB LIKE fallback:",
            esError.message,
          );
          const searchTerms = search.trim().split(/\s+/);
          const searchConditions = searchTerms
            .map(() => "ci.title LIKE ?")
            .join(" AND ");
          conditions.push(`(${searchConditions})`);
          searchTerms.forEach((term) => {
            queryParams.push(`%${term}%`);
          });
        }
      } else {
        // ES 비활성화 시 LIKE 검색 사용
        const searchTerms = search.trim().split(/\s+/);
        const searchConditions = searchTerms
          .map(() => "ci.title LIKE ?")
          .join(" AND ");
        conditions.push(`(${searchConditions})`);
        searchTerms.forEach((term) => {
          queryParams.push(`%${term}%`);
        });
      }
    }

    // 8. 사용자 선택 필터들 (검색 여부와 무관하게 적용)
    if (brands) {
      const brandList = brands.split(",");
      conditions.push(`ci.brand IN (${brandList.map(() => "?").join(",")})`);
      queryParams.push(...brandList);
    }

    if (categories) {
      const categoryList = categories.split(",");
      conditions.push(
        `ci.category IN (${categoryList.map(() => "?").join(",")})`,
      );
      queryParams.push(...categoryList);
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      const dateConds = [];
      dateList.forEach((date) => {
        if (date === "null") {
          dateConds.push("ci.scheduled_date IS NULL");
        } else {
          dateConds.push(`DATE(ci.scheduled_date) = ?`);
          queryParams.push(date);
        }
      });
      conditions.push(`(${dateConds.join(" OR ")})`);
    }

    if (ranks) {
      const rankList = ranks.split(",");
      conditions.push(`ci.rank IN (${rankList.map(() => "?").join(",")})`);
      queryParams.push(...rankList);
    }

    if (auctionTypes) {
      const auctionTypeList = auctionTypes.split(",");
      conditions.push(
        `ci.bid_type IN (${auctionTypeList.map(() => "?").join(",")})`,
      );
      queryParams.push(...auctionTypeList);
    }

    if (aucNums) {
      const aucNumList = aucNums.split(",");
      conditions.push(`ci.auc_num IN (${aucNumList.map(() => "?").join(",")})`);
      queryParams.push(...aucNumList);
    }

    // 9. 최종 쿼리 조립
    let finalQuery = baseQuery;

    if (joins.length > 0) {
      finalQuery += " " + joins.join(" ");
    }

    if (conditions.length > 0) {
      finalQuery += " WHERE " + conditions.join(" AND ");
    }

    // 10. 정렬 (추천 점수 포함)
    let orderByClause;
    switch (sortBy) {
      case "recommend":
        orderByClause = "ci.recommend";
        break;
      case "title":
        orderByClause = "ci.title";
        break;
      case "rank":
        // MariaDB 호환 FIELD 사용
        orderByClause =
          "FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "scheduled_date":
        orderByClause = "ci.scheduled_date IS NULL, ci.scheduled_date";
        break;
      case "starting_price":
        // MariaDB 호환 숫자 변환
        orderByClause = "ci.starting_price + 0";
        break;
      case "brand":
        orderByClause = "ci.brand";
        break;
      default:
        orderByClause = "ci.scheduled_date";
    }

    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    finalQuery += ` ORDER BY ${orderByClause} ${sortDirection}`;

    // 11. 카운트 쿼리 (LIMIT 전에)
    const countQuery = `SELECT COUNT(*) as total FROM (${finalQuery}) as subquery`;

    // 12. 페이징 추가
    finalQuery += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    // 13. 쿼리 실행
    const [items] = await pool.query(finalQuery, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2),
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 14. 위시리스트 조회
    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId],
      );
    }

    // 15. 입찰 정보 매핑
    const itemBidMap = {};
    bidData.forEach((bid) => {
      if (!itemBidMap[bid.item_id]) {
        itemBidMap[bid.item_id] = {};
      }
      itemBidMap[bid.item_id][bid.bid_type] = bid;
    });

    // 16. 상세 정보 처리 (필요시)
    let finalItems = items;
    if (withDetails === "true") {
      const limit = pLimit(5);
      const processItemsInBatches = async (items) => {
        const promises = items.map((item) =>
          limit(() =>
            processItem(item.item_id, false, null, true, null, 2, item.auc_num),
          ),
        );
        const processedItems = await Promise.all(promises);
        return processedItems.filter((item) => item !== null);
      };
      finalItems = await processItemsInBatches(items);
    }

    // 17. 최종 응답 구성
    const itemsWithBids = finalItems.map((item) => {
      const itemBids = itemBidMap[item.item_id] || {};
      return {
        ...item,
        bids: {
          live: itemBids.live || null,
          direct: itemBids.direct || null,
          instant: itemBids.instant || null,
        },
      };
    });

    res.json({
      data: itemsWithBids,
      wishlist,
      page: parseInt(page),
      limit: parseInt(limit),
      totalItems,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching data from database:", error);
    res.status(500).json({ message: "Error fetching data" });
  }
});

// ===== 추천 아이템 조회 라우터 =====
router.get("/recommended", async (req, res) => {
  const { limit = 10, minScore = 1 } = req.query;

  try {
    const [items] = await pool.query(
      `
      SELECT ci.* FROM crawled_items ci
      WHERE ci.is_enabled = 1 AND ci.recommend >= ?
      ORDER BY ci.recommend DESC, ci.scheduled_date ASC
      LIMIT ?
    `,
      [parseInt(minScore), parseInt(limit)],
    );

    res.json(items);
  } catch (error) {
    console.error("Error fetching recommended items:", error);
    res.status(500).json({ message: "Error fetching recommended items" });
  }
});

// ===== 통계와 함께 브랜드 조회 =====
router.get("/brands-with-count", async (req, res) => {
  const { recommend = "false" } = req.query;
  const isRecommendOnly = recommend === "true";

  try {
    const cacheKey = isRecommendOnly
      ? cache.filters.recommend.brands
      : cache.filters.withStats.brands;

    if (isCacheValid(cacheKey, STATS_CACHE_DURATION)) {
      return res.json(cacheKey.data);
    }

    const { conditions, queryParams } =
      await buildBaseFilterConditions(isRecommendOnly);

    const [results] = await pool.query(
      `SELECT ci.brand, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY ci.brand
       ORDER BY count DESC, ci.brand ASC`,
      queryParams,
    );

    updateCache(cacheKey, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

// ===== 경매 타입 조회 =====
router.get("/auction-types", async (req, res) => {
  const { recommend = "false" } = req.query;
  const isRecommendOnly = recommend === "true";

  try {
    const cacheKey = isRecommendOnly
      ? cache.filters.recommend.auctionTypes
      : cache.filters.withStats.auctionTypes;

    if (isCacheValid(cacheKey, STATS_CACHE_DURATION)) {
      return res.json(cacheKey.data);
    }

    const { conditions, queryParams } =
      await buildBaseFilterConditions(isRecommendOnly);

    const [results] = await pool.query(
      `SELECT ci.bid_type, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")} AND ci.bid_type IS NOT NULL
       GROUP BY ci.bid_type
       ORDER BY count DESC`,
      queryParams,
    );

    updateCache(cacheKey, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction types:", error);
    res.status(500).json({ message: "Error fetching auction types" });
  }
});

// ===== 통계와 함께 날짜 조회 =====
router.get("/scheduled-dates-with-count", async (req, res) => {
  const { recommend = "false" } = req.query;
  const isRecommendOnly = recommend === "true";

  try {
    const cacheKey = isRecommendOnly
      ? cache.filters.recommend.dates
      : cache.filters.withStats.dates;

    if (isCacheValid(cacheKey, STATS_CACHE_DURATION)) {
      return res.json(cacheKey.data);
    }

    const { conditions, queryParams } =
      await buildBaseFilterConditions(isRecommendOnly);

    const [results] = await pool.query(
      `SELECT DATE(ci.scheduled_date) as Date, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY DATE(ci.scheduled_date)
       ORDER BY Date ASC`,
      queryParams,
    );

    updateCache(cacheKey, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

// ===== 경매번호 조회 =====
router.get("/auc-nums", async (req, res) => {
  const { recommend = "false" } = req.query;
  const isRecommendOnly = recommend === "true";

  try {
    const cacheKey = isRecommendOnly
      ? cache.filters.recommend.aucNums
      : cache.filters.withStats.aucNums;

    if (isCacheValid(cacheKey, STATS_CACHE_DURATION)) {
      return res.json(cacheKey.data);
    }

    const { conditions, queryParams } =
      await buildBaseFilterConditions(isRecommendOnly);

    const [results] = await pool.query(
      `SELECT ci.auc_num, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")} AND ci.auc_num IS NOT NULL
       GROUP BY ci.auc_num
       ORDER BY ci.auc_num ASC`,
      queryParams,
    );

    updateCache(cacheKey, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
  }
});

// ===== 등급 조회 =====
router.get("/ranks", async (req, res) => {
  const { recommend = "false" } = req.query;
  const isRecommendOnly = recommend === "true";

  try {
    const cacheKey = isRecommendOnly
      ? cache.filters.recommend.ranks
      : cache.filters.withStats.ranks;

    if (isCacheValid(cacheKey, STATS_CACHE_DURATION)) {
      return res.json(cacheKey.data);
    }

    const { conditions, queryParams } =
      await buildBaseFilterConditions(isRecommendOnly);

    const [results] = await pool.query(
      `SELECT TRIM(ci.rank) as rank, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY TRIM(ci.rank)
       ORDER BY FIELD(TRIM(ci.rank), 'N', 'S', 'SA', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')`,
      queryParams,
    );

    const normalizedResults = results.map((result) => ({
      rank: normalizeRank(result.rank),
      count: result.count,
    }));

    updateCache(cacheKey, normalizedResults);
    res.json(normalizedResults);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

// ===== 단순 필터 조회 API들 =====
router.get("/brands", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT ci.brand 
      FROM crawled_items ci 
      WHERE ci.is_enabled = 1 AND ci.brand IS NOT NULL AND ci.brand != ''
      ORDER BY ci.brand
    `);

    res.json(results.map((row) => row.brand));
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT ci.category 
      FROM crawled_items ci 
      WHERE ci.is_enabled = 1 AND ci.category IS NOT NULL AND ci.category != ''
      ORDER BY ci.category
    `);

    res.json(results.map((row) => row.category));
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// ===== 환율 조회 =====
router.get("/exchange-rate", async (req, res) => {
  try {
    const rate = await getExchangeRate();
    res.json({ rate });
  } catch (error) {
    console.error("Error fetching exchange rate:", error);

    // 실패 시 캐시된 환율 반환
    const cachedRate = getCachedExchangeRate();
    res.json({
      rate: cachedRate,
      cached: true,
      error: "Failed to fetch new exchange rate, using cached data",
    });
  }
});

module.exports = router;
