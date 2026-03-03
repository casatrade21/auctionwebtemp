// routes/values.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const esManager = require("../utils/elasticsearch");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// ===== 캐싱 관련 설정 =====
const CACHE_DURATION = 60 * 60 * 1000;

const cache = {
  filters: {
    lists: {
      brands: { data: null, lastFetched: null },
      categories: { data: null, lastFetched: null },
    },
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
    },
  },
};

function isCacheValid(cacheItem) {
  const currentTime = new Date().getTime();
  return (
    cacheItem.data !== null &&
    cacheItem.lastFetched !== null &&
    currentTime - cacheItem.lastFetched < CACHE_DURATION
  );
}

function updateCache(cacheItem, data) {
  cacheItem.data = data;
  cacheItem.lastFetched = new Date().getTime();
}

function invalidateCache(type, subType = null) {
  if (type === "all") {
    Object.keys(cache.filters).forEach((category) => {
      Object.keys(cache.filters[category]).forEach((item) => {
        cache.filters[category][item].data = null;
        cache.filters[category][item].lastFetched = null;
      });
    });
  } else if (type === "filters") {
    if (subType === null) {
      Object.keys(cache.filters).forEach((category) => {
        Object.keys(cache.filters[category]).forEach((item) => {
          cache.filters[category][item].data = null;
          cache.filters[category][item].lastFetched = null;
        });
      });
    } else if (cache.filters.lists[subType]) {
      cache.filters.lists[subType].data = null;
      cache.filters.lists[subType].lastFetched = null;

      if (cache.filters.withStats[subType]) {
        cache.filters.withStats[subType].data = null;
        cache.filters.withStats[subType].lastFetched = null;
      }
    } else if (cache.filters.withStats[subType]) {
      cache.filters.withStats[subType].data = null;
      cache.filters.withStats[subType].lastFetched = null;
    }
  }
}

// ===== 메인 데이터 조회 라우터 =====
router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    aucNums,
    search,
    ranks,
    withDetails = "false",
    sortBy = "scheduled_date",
    sortOrder = "desc",
  } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = "SELECT * FROM values_items";
    const queryParams = [];
    let conditions = [];

    // 검색 조건 - Elasticsearch 사용
    if (search && search.trim()) {
      // ES가 활성화되어 있으면 ES 사용, 아니면 LIKE 사용
      if (esManager.isHealthy()) {
        try {
          const filters = {};
          if (brands) filters.brand = brands.split(",");
          if (categories) filters.category = categories.split(",");
          if (aucNums) filters.auc_num = aucNums.split(",");

          const itemIds = await esManager.search(
            "values_items",
            search.trim(),
            filters,
            {
              fields: ["title^2", "brand"],
              fuzziness: "AUTO",
              operator: "and",
              size: 5000,
            }
          );

          if (itemIds.length > 0) {
            conditions.push(`item_id IN (${itemIds.map(() => "?").join(",")})`);
            queryParams.push(...itemIds);
          } else {
            return res.json({
              data: [],
              page: parseInt(page),
              limit: parseInt(limit),
              totalItems: 0,
              totalPages: 0,
            });
          }
        } catch (esError) {
          console.error(
            "ES search failed, using DB LIKE fallback:",
            esError.message
          );
          const searchTerms = search.trim().split(/\s+/);
          const searchConditions = searchTerms.map(() => "title LIKE ?");
          conditions.push(`(${searchConditions.join(" AND ")})`);
          searchTerms.forEach((term) => {
            queryParams.push(`%${term}%`);
          });
        }
      } else {
        // ES 비활성화 시 LIKE 검색 사용
        const searchTerms = search.trim().split(/\s+/);
        const searchConditions = searchTerms.map(() => "title LIKE ?");
        conditions.push(`(${searchConditions.join(" AND ")})`);
        searchTerms.forEach((term) => {
          queryParams.push(`%${term}%`);
        });
      }
    }

    // 등급 필터 (검색 여부와 무관하게 적용)
    if (ranks) {
      const rankList = ranks.split(",");
      conditions.push(`rank IN (${rankList.map(() => "?").join(",")})`);
      queryParams.push(...rankList);
    }

    // 브랜드 필터 (검색 여부와 무관하게 적용)
    if (brands) {
      const brandList = brands.split(",");
      if (brandList.length > 0) {
        conditions.push(`brand IN (${brandList.map(() => "?").join(",")})`);
        queryParams.push(...brandList);
      }
    }

    // 카테고리 필터
    if (categories) {
      const categoryList = categories.split(",");
      if (categoryList.length > 0) {
        conditions.push(
          `category IN (${categoryList.map(() => "?").join(",")})`
        );
        queryParams.push(...categoryList);
      }
    }

    // 날짜 필터 (원본과 동일)
    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      if (dateList.length > 0) {
        const dateConds = [];
        dateList.forEach((date) => {
          dateConds.push(`DATE(scheduled_date) = ?`);
          queryParams.push(date);
        });
        if (dateConds.length > 0) {
          conditions.push(`(${dateConds.join(" OR ")})`);
        }
      }
    }

    // 경매번호 필터
    if (aucNums) {
      const aucNumList = aucNums.split(",");
      if (aucNumList.length > 0) {
        conditions.push(`auc_num IN (${aucNumList.map(() => "?").join(",")})`);
        queryParams.push(...aucNumList);
      }
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;

    // 정렬 (원본과 동일하지만 MariaDB 호환성 고려)
    let orderByClause = "";
    switch (sortBy) {
      case "title":
        orderByClause = "title";
        break;
      case "rank":
        // MariaDB 호환 FIELD 사용
        orderByClause =
          "FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "scheduled_date":
        orderByClause = "scheduled_date";
        break;
      case "starting_price":
      case "final_price":
        // MariaDB 호환 숫자 변환
        orderByClause = "final_price + 0";
        break;
      case "brand":
        // 브랜드
        orderByClause = "brand";
        break;
      default:
        orderByClause = "title";
    }

    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderByClause} ${sortDirection}`;

    // 원본과 동일한 보조 정렬
    if (orderByClause !== "item_id") {
      query += ", item_id DESC";
    }

    query += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 상세 정보 처리
    if (withDetails === "true") {
      const limit = pLimit(3);

      const processItemsInBatches = async (items) => {
        const promises = items.map((item) =>
          limit(() =>
            processItem(item.item_id, true, null, true, null, 2, item.auc_num)
          )
        );
        const processedItems = await Promise.all(promises);
        return processedItems.filter((item) => item !== null);
      };

      const detailedItems = await processItemsInBatches(items);

      res.json({
        data: detailedItems.filter((item) => item !== null),
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    } else {
      res.json({
        data: items,
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    }
  } catch (error) {
    console.error("Error fetching data from database:", error);
    res.status(500).json({ message: "Error fetching data" });
  }
});

// ===== 통계와 함께 브랜드 조회 =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.brands)) {
      return res.json(cache.filters.withStats.brands.data);
    }

    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      WHERE brand IS NOT NULL
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);

    updateCache(cache.filters.withStats.brands, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

// ===== 통계와 함께 날짜 조회 (원본과 동일한 시간대 처리) =====
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.dates)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM values_items
      WHERE scheduled_date IS NOT NULL
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `);

    updateCache(cache.filters.withStats.dates, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

// ===== 브랜드 목록 조회 =====
router.get("/brands", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.lists.brands)) {
      return res.json(cache.filters.lists.brands.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      WHERE brand IS NOT NULL
      ORDER BY brand ASC
    `);

    const brandsList = results.map((row) => row.brand);
    updateCache(cache.filters.lists.brands, brandsList);
    res.json(brandsList);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

// ===== 카테고리 목록 조회 =====
router.get("/categories", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.lists.categories)) {
      return res.json(cache.filters.lists.categories.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      WHERE category IS NOT NULL
      ORDER BY category ASC
    `);

    const categoriesList = results.map((row) => row.category);
    updateCache(cache.filters.lists.categories, categoriesList);
    res.json(categoriesList);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// ===== 등급 조회 (최적화: 복잡한 CASE문 제거) =====
router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.ranks)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const [results] = await pool.query(`
      SELECT rank, COUNT(*) as count
      FROM values_items
      WHERE rank IS NOT NULL
      GROUP BY rank
      ORDER BY FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);

    updateCache(cache.filters.withStats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

// ===== 경매번호 조회 =====
router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.aucNums)) {
      return res.json(cache.filters.withStats.aucNums.data);
    }

    const [results] = await pool.query(`
      SELECT auc_num, COUNT(*) as count
      FROM values_items
      WHERE auc_num IS NOT NULL
      GROUP BY auc_num
      ORDER BY auc_num ASC
    `);

    updateCache(cache.filters.withStats.aucNums, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
  }
});

// ===== 캐시 무효화 =====
router.post("/invalidate-cache", (req, res) => {
  try {
    const { type, subType } = req.body;

    if (!req.session.user?.isAdmin) {
      return res
        .status(403)
        .json({ message: "Unauthorized: Admin access required" });
    }

    invalidateCache(type, subType);
    res.json({ message: "Cache invalidated successfully" });
  } catch (error) {
    console.error("Error invalidating cache:", error);
    res.status(500).json({ message: "Error invalidating cache" });
  }
});

module.exports = router;
