// routes/direct-bids.js - 직접 경매(고전적인 경매) 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const submitBid = require("../utils/submitBid");
const { validateBidByAuction, validateBidUnit } = require("../utils/submitBid");
const {
  ecoAucCrawler,
  brandAucCrawler,
  starAucCrawler,
  mekikiAucCrawler,
} = require("../crawlers/index");
const { notifyClientsOfChanges } = require("./crawler");
const {
  createOrUpdateSettlement,
  getUserCommissionRate,
  adjustDepositBalance,
} = require("../utils/settlement");
const { calculateFee, calculateTotalPrice } = require("../utils/calculate-fee");
const { getExchangeRate } = require("../utils/exchange-rate");
const {
  deductDeposit,
  refundDeposit,
  deductLimit,
  refundLimit,
  getBidDeductAmount,
} = require("../utils/deposit");
const { processItem } = require("../utils/processItem");
const cron = require("node-cron");
const { isAdminUser } = require("../utils/adminAuth");
const { syncWmsByBidStatus } = require("../utils/wms-bid-sync");

const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// STATUS -> 'active', 'completed', 'cancelled'
// shipping_status -> 'pending', 'completed', 'domestic_arrived', 'processing', 'shipped'
//   (shipping_status can only be updated when status = 'completed')
const SHIPPING_STATUSES = new Set([
  "pending",
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
]);
// GET endpoint to retrieve all bids, with optional filtering
// Updated GET endpoint for direct-bids.js
router.get("/", async (req, res) => {
  const {
    search,
    status,
    aucNum,
    highestOnly,
    page = 1,
    limit = 10,
    fromDate,
    toDate,
    sortBy = "original_scheduled_date",
    sortOrder = "desc",
  } = req.query;

  // limit=0일 때는 페이지네이션 적용하지 않음
  const usesPagination = parseInt(limit) !== 0;
  const offset = usesPagination ? (page - 1) * limit : 0;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const connection = await pool.getConnection();

  try {
    let mainQuery, countQuery;
    let queryParams = [];

    // 기본 쿼리 준비
    if (highestOnly === "true") {
      // 각 아이템별로 가장 높은 입찰가만 가져오기
      countQuery = `
        SELECT COUNT(*) as total
        FROM direct_bids d
        INNER JOIN (
          SELECT item_id, MAX(current_price) as max_price
          FROM direct_bids
          WHERE status = 'active'
          GROUP BY item_id
        ) m ON d.item_id = m.item_id AND d.current_price = m.max_price
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN (
          SELECT
            source_bid_type,
            source_bid_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode
          FROM wms_items
          GROUP BY source_bid_type, source_bid_id
        ) wms ON wms.source_bid_type = 'direct' AND wms.source_bid_id = d.id
        LEFT JOIN (
          SELECT
            source_item_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode
          FROM wms_items
          WHERE source_item_id IS NOT NULL
          GROUP BY source_item_id
        ) wmsi ON wmsi.source_item_id = d.item_id
        WHERE 1=1
      `;

      mainQuery = `
        SELECT 
          d.*,
          COALESCE(wms.internal_barcode, wmsi.internal_barcode) AS wms_internal_barcode,
          COALESCE(wms.current_location_code, wmsi.current_location_code) AS wms_location_code,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title, i.additional_info,
          u.company_name
        FROM direct_bids d
        INNER JOIN (
          SELECT item_id, MAX(current_price) as max_price
          FROM direct_bids
          WHERE status = 'active'
          GROUP BY item_id
        ) m ON d.item_id = m.item_id AND d.current_price = m.max_price
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN (
          SELECT
            source_bid_type,
            source_bid_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode,
            MAX(current_location_code) AS current_location_code
          FROM wms_items
          GROUP BY source_bid_type, source_bid_id
        ) wms ON wms.source_bid_type = 'direct' AND wms.source_bid_id = d.id
        LEFT JOIN (
          SELECT
            source_item_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode,
            MAX(current_location_code) AS current_location_code
          FROM wms_items
          WHERE source_item_id IS NOT NULL
          GROUP BY source_item_id
        ) wmsi ON wmsi.source_item_id = d.item_id
        WHERE 1=1
      `;
    } else {
      // 모든 입찰 가져오기
      countQuery = `
        SELECT COUNT(*) as total 
        FROM direct_bids d
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN (
          SELECT
            source_bid_type,
            source_bid_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode
          FROM wms_items
          GROUP BY source_bid_type, source_bid_id
        ) wms ON wms.source_bid_type = 'direct' AND wms.source_bid_id = d.id
        LEFT JOIN (
          SELECT
            source_item_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode
          FROM wms_items
          WHERE source_item_id IS NOT NULL
          GROUP BY source_item_id
        ) wmsi ON wmsi.source_item_id = d.item_id
        WHERE 1=1
      `;

      mainQuery = `
        SELECT 
          d.*,
          COALESCE(wms.internal_barcode, wmsi.internal_barcode) AS wms_internal_barcode,
          COALESCE(wms.current_location_code, wmsi.current_location_code) AS wms_location_code,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title, i.additional_info,
          u.company_name, u.login_id
        FROM direct_bids d
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        LEFT JOIN users u ON d.user_id = u.id
        LEFT JOIN (
          SELECT
            source_bid_type,
            source_bid_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode,
            MAX(current_location_code) AS current_location_code
          FROM wms_items
          GROUP BY source_bid_type, source_bid_id
        ) wms ON wms.source_bid_type = 'direct' AND wms.source_bid_id = d.id
        LEFT JOIN (
          SELECT
            source_item_id,
            MAX(internal_barcode) AS internal_barcode,
            MAX(external_barcode) AS external_barcode,
            MAX(current_location_code) AS current_location_code
          FROM wms_items
          WHERE source_item_id IS NOT NULL
          GROUP BY source_item_id
        ) wmsi ON wmsi.source_item_id = d.item_id
        WHERE 1=1
      `;
    }

    // 검색 조건 추가
    if (search) {
      const searchTerm = `%${search}%`;
      const compactSearchTerm = `%${String(search).replace(/\s+/g, "")}%`;
      countQuery +=
        " AND (CONVERT(d.item_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(i.original_title USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(i.additional_info USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(u.login_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(u.company_name USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR REPLACE(CONVERT(u.company_name USING utf8mb4), ' ', '') LIKE CONVERT(? USING utf8mb4) OR CONVERT(wms.internal_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wms.external_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wmsi.internal_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wmsi.external_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4))";
      mainQuery +=
        " AND (CONVERT(d.item_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(i.original_title USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(i.additional_info USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(u.login_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(u.company_name USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR REPLACE(CONVERT(u.company_name USING utf8mb4), ' ', '') LIKE CONVERT(? USING utf8mb4) OR CONVERT(wms.internal_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wms.external_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wmsi.internal_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4) OR CONVERT(wmsi.external_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4))";
      queryParams.push(
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        compactSearchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
      );
    }

    // 상태 필터 추가
    if (status) {
      const statusArray = status.split(",");
      const shippingFilters = statusArray.filter((s) =>
        SHIPPING_STATUSES.has(s),
      );
      const bidFilters = statusArray.filter((s) => !SHIPPING_STATUSES.has(s));

      if (shippingFilters.length > 0 && bidFilters.length === 0) {
        // shipping_status 만 필터
        const placeholders = shippingFilters.map(() => "?").join(",");
        countQuery += ` AND d.status = 'completed' AND d.shipping_status IN (${placeholders})`;
        mainQuery += ` AND d.status = 'completed' AND d.shipping_status IN (${placeholders})`;
        queryParams.push(...shippingFilters);
      } else if (shippingFilters.length > 0) {
        // 혼합: shipping_status 또는 bid status
        const shippingPlaceholders = shippingFilters.map(() => "?").join(",");
        const bidPlaceholders = bidFilters.map(() => "?").join(",");
        countQuery += ` AND (d.shipping_status IN (${shippingPlaceholders}) OR d.status IN (${bidPlaceholders}))`;
        mainQuery += ` AND (d.shipping_status IN (${shippingPlaceholders}) OR d.status IN (${bidPlaceholders}))`;
        queryParams.push(...shippingFilters, ...bidFilters);
      } else {
        // bid 테이블 status 만
        if (bidFilters.length === 1) {
          countQuery += " AND d.status = ?";
          mainQuery += " AND d.status = ?";
        } else {
          const placeholders = bidFilters.map(() => "?").join(",");
          countQuery += ` AND d.status IN (${placeholders})`;
          mainQuery += ` AND d.status IN (${placeholders})`;
        }
        queryParams.push(...bidFilters);
      }
    }

    if (aucNum) {
      const aucNumArray = aucNum.split(",");

      if (aucNumArray.length === 1) {
        countQuery += " AND i.auc_num = ?";
        mainQuery += " AND i.auc_num = ?";
        queryParams.push(aucNum);
      } else {
        const placeholders = aucNumArray.map(() => "?").join(",");
        countQuery += ` AND i.auc_num IN (${placeholders})`;
        mainQuery += ` AND i.auc_num IN (${placeholders})`;
        queryParams.push(...aucNumArray);
      }
    }

    // 시작 날짜 필터 추가
    if (fromDate) {
      countQuery += " AND d.updated_at >= ?";
      mainQuery += " AND d.updated_at >= ?";
      queryParams.push(fromDate);
    }

    // 종료 날짜 필터 추가
    if (toDate) {
      countQuery += " AND d.updated_at <= ?";
      mainQuery += " AND d.updated_at <= ?";
      queryParams.push(toDate);
    }

    // 일반 사용자는 자신의 입찰만 볼 수 있고, 관리자는 모든 입찰을 볼 수 있음
    if (!isAdminUser(req.session?.user)) {
      countQuery += " AND d.user_id = ?";
      mainQuery += " AND d.user_id = ?";
      queryParams.push(req.session.user.id);
    }

    // 정렬 설정
    let orderByColumn;
    switch (sortBy) {
      case "original_scheduled_date":
        orderByColumn = "i.original_scheduled_date";
        break;
      case "updated_at":
        orderByColumn = "d.updated_at";
        break;
      case "original_title":
        orderByColumn = "i.original_title";
        break;
      default:
        orderByColumn = "i.original_scheduled_date"; // 기본값
        break;
    }

    // 정렬 방향 설정
    const direction = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 정렬 쿼리 추가
    mainQuery += ` ORDER BY ${orderByColumn} ${direction}`;

    // 페이지네이션 추가 (limit=0이 아닌 경우에만)
    let mainQueryParams;
    if (usesPagination) {
      mainQuery += " LIMIT ? OFFSET ?";
      mainQueryParams = [...queryParams, parseInt(limit), parseInt(offset)];
    } else {
      mainQueryParams = [...queryParams];
    }

    // 총 개수 가져오기
    const [countResult] = await connection.query(countQuery, queryParams);
    const total = countResult[0].total;
    const totalPages = usesPagination ? Math.ceil(total / limit) : 1;

    // 데이터 쿼리 실행
    const [rows] = await connection.query(mainQuery, mainQueryParams);

    // Format result to match expected structure
    const bidsWithItems = rows.map((row) => {
      const bid = {
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        login_id: row.login_id,
        company_name: row.company_name,
        current_price: row.current_price,
        status: row.status,
        shipping_status: row.shipping_status || "pending",
        submitted_to_platform: row.submitted_to_platform,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        winning_price: row.winning_price,
        notification_sent_at: row.notification_sent_at,
        appr_id: row.appr_id,
        repair_requested_at: row.repair_requested_at,
        repair_details: row.repair_details,
        repair_fee: row.repair_fee,
        internal_barcode: row.wms_internal_barcode || null,
        wms_location_code: row.wms_location_code || null,
      };

      // Only include item if it exists
      let item = null;
      if (row.item_id) {
        item = {
          item_id: row.item_id,
          original_title: row.original_title,
          title: row.title,
          auc_num: row.auc_num,
          category: row.category,
          brand: row.brand,
          rank: row.rank,
          starting_price: row.starting_price,
          scheduled_date: row.scheduled_date,
          original_scheduled_date: row.original_scheduled_date,
          image: row.image,
          additional_info: row.additional_info,
        };
      }

      return {
        ...bid,
        item: item,
      };
    });

    res.status(200).json({
      count: bidsWithItems.length,
      total: total,
      totalPages: totalPages,
      currentPage: parseInt(page),
      bids: bidsWithItems,
    });
  } catch (err) {
    console.error("Error retrieving bids:", err);
    res.status(500).json({ message: "Error retrieving bids" });
  } finally {
    connection.release();
  }
});

// 입찰 옵션 정보 제공 API
router.get("/bid-options/:itemId", async (req, res) => {
  const { itemId } = req.params;
  const { aucNum } = req.query;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    // 1. 아이템 정보 조회
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ?",
      [itemId, aucNum],
    );

    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    const item = items[0];

    // 1-1. 3번 사이트(스타옥션)의 경우 crawlUpdateWithId로 최신 가격 확인
    if (item.auc_num == 3) {
      try {
        const crawler = starAucCrawler;

        if (crawler && crawler.crawlUpdateWithId) {
          console.log(
            `Checking latest price for item ${itemId} (auc_num=${item.auc_num})`,
          );
          const latestItemInfo = await crawler.crawlUpdateWithId(itemId, item);

          // 최신 정보가 있고 가격이나 날짜가 다르면 DB 업데이트
          if (latestItemInfo) {
            let needsUpdate = false;
            const updates = [];
            const updateValues = [];

            // 가격 업데이트 확인
            if (
              latestItemInfo.starting_price !== undefined &&
              parseFloat(latestItemInfo.starting_price) !==
                parseFloat(item.starting_price)
            ) {
              console.log(
                `Price changed for item ${itemId}: ${item.starting_price} -> ${latestItemInfo.starting_price}`,
              );
              updates.push("starting_price = ?");
              updateValues.push(latestItemInfo.starting_price);
              needsUpdate = true;

              // item 객체 업데이트
              item.starting_price = latestItemInfo.starting_price;
            }

            // 날짜 업데이트 확인
            if (latestItemInfo.scheduled_date) {
              // 날짜를 Date 객체로 변환하여 비교
              const latestDate = new Date(latestItemInfo.scheduled_date);
              const currentDate = new Date(item.scheduled_date);

              // 시간 값(timestamp)으로 비교
              if (latestDate.getTime() !== currentDate.getTime()) {
                console.log(
                  `Scheduled date changed for item ${itemId}: ${item.scheduled_date} -> ${latestItemInfo.scheduled_date}`,
                );
                updates.push("scheduled_date = ?");
                updateValues.push(latestItemInfo.scheduled_date);
                needsUpdate = true;

                // item 객체 업데이트
                item.scheduled_date = latestItemInfo.scheduled_date;
              }
            }

            // DB 업데이트가 필요하면 실행
            if (needsUpdate) {
              updateValues.push(itemId);
              updateValues.push(item.auc_num);
              pool.query(
                `UPDATE crawled_items SET ${updates.join(
                  ", ",
                )} WHERE item_id = ? AND auc_num = ?`,
                updateValues,
              );
              console.log(
                `Updated item ${itemId} (auc_num=${item.auc_num}) in database with latest info`,
              );
              notifyClientsOfChanges([{ item_id: itemId }]);
            }
          }
        }
      } catch (error) {
        // 크롤링에 실패해도 기존 가격으로 진행
        console.error(`Error checking latest price for item ${itemId}:`, error);
      }
    }

    // 2. 사용자의 현재 입찰 확인
    const [userBids] = await connection.query(
      "SELECT * FROM direct_bids WHERE item_id = ? AND user_id = ? AND status = 'active'",
      [itemId, userId],
    );

    const isFirstBid = userBids.length === 0;
    const currentBid = userBids.length > 0 ? userBids[0] : null;

    // 3. 경매장별 다음 유효 입찰가 계산
    let nextValidBid = null;
    let minIncrement = 1000; // 기본값

    switch (item.auc_num) {
      case "1": // 에코옥션 - 1000엔 단위
      case "4": // 메키키옥션 - 1000엔 단위
        minIncrement = 1000;
        nextValidBid =
          Math.ceil((parseFloat(item.starting_price) + minIncrement) / 1000) *
          1000;
        break;

      case "2": // 브랜드옥션 - 첫 입찰 1000엔, 이후 500엔
        if (isFirstBid) {
          minIncrement = 1000;
          nextValidBid =
            Math.ceil((parseFloat(item.starting_price) + minIncrement) / 1000) *
            1000;
        } else {
          minIncrement = 500;
          const currentPrice = currentBid
            ? parseFloat(currentBid.current_price)
            : parseFloat(item.starting_price);
          nextValidBid = Math.ceil((currentPrice + minIncrement) / 500) * 500;
        }
        break;

      case "3": // 스타옥션 - 자동 최소금액 계산
        // 스타옥션은 현재 최고가(starting_price가 실시간으로 업데이트됨)를 기준으로 계산
        const currentPrice = parseFloat(item.starting_price);
        const getIncrement = (price) => {
          if (price >= 0 && price <= 999) return 100;
          if (price >= 1000 && price <= 9999) return 500;
          if (price >= 10000 && price <= 29999) return 1000;
          if (price >= 30000 && price <= 49999) return 2000;
          if (price >= 50000 && price <= 99999) return 3000;
          if (price >= 100000 && price <= 299999) return 5000;
          if (price >= 300000 && price <= 999999) return 10000;
          return 30000; // 1,000,000엔 이상
        };

        minIncrement = getIncrement(currentPrice);
        nextValidBid = currentPrice + minIncrement;
        break;

      default:
        minIncrement = 1000;
        nextValidBid =
          Math.ceil((parseFloat(item.starting_price) + minIncrement) / 1000) *
          1000;
    }

    res.status(200).json({
      itemId: itemId,
      auctionNum: item.auc_num,
      isFirstBid: isFirstBid,
      currentPrice: item.starting_price,
      currentBid: currentBid ? currentBid.current_price : null,
      nextValidBid: nextValidBid,
      minIncrement: minIncrement,
      rules: {
        1: { description: "1,000엔 단위 입찰", unit: 1000 },
        2: {
          description: isFirstBid
            ? "첫 입찰: 1,000엔 단위"
            : "이후 입찰: 500엔 단위",
          unit: isFirstBid ? 1000 : 500,
        },
        3: { description: "자동 최소금액 계산", unit: minIncrement },
        4: { description: "1,000엔 단위 입찰", unit: 1000 },
      }[item.auc_num],
    });
  } catch (err) {
    console.error("Error getting bid options:", err);
    res.status(500).json({ message: "Error getting bid options" });
  } finally {
    connection.release();
  }
});

// 사용자의 입찰 (자동 생성/업데이트) - 자동 제출 기능 추가
router.post("/", async (req, res) => {
  const { itemId, aucNum, currentPrice, autoSubmit = true } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !aucNum || !currentPrice) {
    return res
      .status(400)
      .json({ message: "Item ID, auction number, and price are required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 아이템 정보 확인
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ?",
      [itemId, aucNum],
    );

    if (items.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    const item = items[0];

    if (!item.description) {
      console.log(
        `[Direct Bid] Triggering background detail fetch for ${itemId}`,
      );
      processItem(itemId, aucNum).catch((err) => {
        console.error(`[Background] Failed to process ${itemId}:`, err.message);
      });
    }

    // 2. 경매 종료 확인
    const now = new Date();
    const scheduledDate = new Date(item.scheduled_date);

    if (scheduledDate < now) {
      await connection.rollback();
      return res.status(400).json({
        message: "Auction has already ended",
        scheduled_date: item.scheduled_date,
      });
    }

    // 3. 단위 검증
    const unitValidation = validateBidUnit(
      item.auc_num,
      currentPrice,
      item.starting_price,
    );

    if (!unitValidation.valid) {
      await connection.rollback();
      return res.status(400).json({
        message: unitValidation.message,
      });
    }

    // 4. 환율 조회
    const exchangeRate = await getExchangeRate();

    // 5. 차감액 계산 - 계정 타입별 분리
    const totalPrice = calculateTotalPrice(
      currentPrice,
      item.auc_num,
      item.category,
      exchangeRate,
    );
    const userCommissionRate = await getUserCommissionRate(userId);
    const platformFee = calculateFee(totalPrice, userCommissionRate);

    // 6. 계정 정보 조회
    const [accounts] = await connection.query(
      "SELECT account_type, deposit_balance, daily_limit, daily_used FROM user_accounts WHERE user_id = ?",
      [userId],
    );

    let account = accounts[0];

    // 계정 없으면 생성 (개인 회원 기본)
    if (!account) {
      await connection.query(
        'INSERT INTO user_accounts (user_id, account_type, deposit_balance) VALUES (?, "individual", 0)',
        [userId],
      );
      account = {
        account_type: "individual",
        deposit_balance: 0,
        daily_limit: 0,
        daily_used: 0,
      };
    }

    // 7. 계정 타입별 차감액 결정
    let deductAmount;
    if (account.account_type === "individual") {
      deductAmount = totalPrice + platformFee; // 개인: 수수료 포함
    } else {
      deductAmount = totalPrice; // 기업: 수수료 제외
    }

    // 8. 예치금/한도 체크 (부족 시 거부)
    if (account.account_type === "individual") {
      if (account.deposit_balance < deductAmount) {
        await connection.rollback();
        return res.status(400).json({
          message: "예치금 부족",
          required: deductAmount,
          current: account.deposit_balance,
          deficit: deductAmount - account.deposit_balance,
        });
      }
    } else {
      // corporate
      const available = account.daily_limit - account.daily_used;
      if (available < deductAmount) {
        await connection.rollback();
        return res.status(400).json({
          message: "일일 한도 초과",
          required: deductAmount,
          available: available,
        });
      }
    }

    // 8. UPSERT로 입찰 생성/업데이트
    const [result] = await connection.query(
      `INSERT INTO direct_bids (user_id, item_id, current_price, status) 
       VALUES (?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE 
         current_price = VALUES(current_price),
         status = 'active',
         id = LAST_INSERT_ID(id)`,
      [userId, itemId, currentPrice],
    );

    const bidId = result.insertId;

    // 9. Commit (submitBid가 DB 조회하므로 데드락 방지)
    await connection.commit();

    // 10. API 호출 (주 로직)
    if (autoSubmit) {
      const submissionResult = await submitBid(
        { bid_id: bidId, price: currentPrice },
        item,
      );

      if (!submissionResult || !submissionResult.success) {
        // API 실패 시 입찰 삭제 (보상 트랜잭션)
        await pool.query("DELETE FROM direct_bids WHERE id = ?", [bidId]);
        return res.status(409).json({
          message: "지금은 입찰할 수 없는 상태입니다.",
          error: submissionResult?.error || "Unknown error",
        });
      }
    }

    // 11. API 성공 → 예치금/한도 차감 + 낮은 입찰 취소 (같은 트랜잭션)
    const newConnection = await pool.getConnection();
    try {
      await newConnection.beginTransaction();

      if (account.account_type === "individual") {
        await deductDeposit(
          newConnection,
          userId,
          deductAmount,
          "direct_bid",
          bidId,
          `직접경매 입찰 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      } else {
        await deductLimit(
          newConnection,
          userId,
          deductAmount,
          "direct_bid",
          bidId,
          `직접경매 입찰 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      }

      // 낮은 입찰 취소 및 예치금/한도 복구 (같은 트랜잭션 내에서 원자적 처리)
      // 1) 취소할 낮은 입찰들 조회
      const [lowerBids] = await newConnection.query(
        `SELECT d.id, d.user_id, d.current_price, u.account_type 
         FROM direct_bids d
         JOIN user_accounts u ON d.user_id = u.user_id
         WHERE d.item_id = ? AND d.current_price < ? AND d.status = 'active' AND d.id != ?`,
        [itemId, currentPrice, bidId],
      );

      // 2) 각 낮은 입찰에 대해 예치금/한도 복구
      for (const lowerBid of lowerBids) {
        const lowerBidDeductAmount = await getBidDeductAmount(
          newConnection,
          lowerBid.id,
          "direct_bid",
        );

        if (lowerBidDeductAmount > 0) {
          if (lowerBid.account_type === "individual") {
            await refundDeposit(
              newConnection,
              lowerBid.user_id,
              lowerBidDeductAmount,
              "direct_bid",
              lowerBid.id,
              "상위 입찰로 인한 취소 환불",
            );
          } else {
            await refundLimit(
              newConnection,
              lowerBid.user_id,
              lowerBidDeductAmount,
              "direct_bid",
              lowerBid.id,
              "상위 입찰로 인한 취소 환불",
            );
          }
        }
      }

      // 3) 낮은 입찰 상태 변경
      await newConnection.query(
        "UPDATE direct_bids SET status = 'cancelled' WHERE item_id = ? AND current_price < ? AND status = 'active' AND id != ?",
        [itemId, currentPrice, bidId],
      );

      await newConnection.commit();
    } catch (err) {
      await newConnection.rollback();
      console.error("예치금 차감 실패:", err);

      // 차감 실패 시 입찰도 롤백
      const rollbackConnection = await pool.getConnection();
      try {
        await rollbackConnection.query(
          "UPDATE direct_bids SET status = 'cancelled' WHERE id = ?",
          [bidId],
        );
      } finally {
        rollbackConnection.release();
      }

      return res.status(500).json({
        message: "예치금 차감 실패로 입찰이 취소되었습니다",
        error: err.message,
      });
    } finally {
      newConnection.release();
    }

    res.status(201).json({
      message: "입찰이 성공적으로 제출되었습니다",
      bidId: bidId,
      status: "active",
      currentPrice,
      deductAmount,
      submitted: true,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error placing bid:", err);
    res.status(500).json({ message: "Error placing bid" });
  } finally {
    connection.release();
  }
});

// 낙찰 완료 처리 - 단일 또는 다중 처리 지원
// 낙찰 완료 처리 - 단일 또는 다중 처리 지원
router.put("/complete", isAdmin, async (req, res) => {
  const { id, ids, winningPrice } = req.body;

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환
  const bidIds = id ? [id] : ids;
  const placeholders = bidIds.map(() => "?").join(",");

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // ===== 1. 입찰 상태 업데이트 =====
    let completedCount = 0;
    let cancelledCount = 0;

    if (winningPrice !== undefined) {
      // 낙찰가 있는 경우: winning_price와 비교
      const [cancelResult] = await connection.query(
        `UPDATE direct_bids 
         SET status = 'cancelled', winning_price = ? 
         WHERE id IN (${placeholders}) 
           AND status = 'active' 
           AND current_price < ?`,
        [winningPrice, ...bidIds, winningPrice],
      );
      cancelledCount = cancelResult.affectedRows;

      const [completeResult] = await connection.query(
        `UPDATE direct_bids 
         SET status = 'completed', shipping_status = 'completed', winning_price = ?, completed_at = NOW() 
         WHERE id IN (${placeholders}) 
           AND status = 'active' 
           AND current_price >= ?`,
        [winningPrice, ...bidIds, winningPrice],
      );
      completedCount = completeResult.affectedRows;
    } else {
      // 낙찰가 없는 경우: current_price를 winning_price로 사용
      const [completeResult] = await connection.query(
        `UPDATE direct_bids 
         SET status = 'completed', shipping_status = 'completed', winning_price = current_price, completed_at = NOW() 
         WHERE id IN (${placeholders}) 
           AND status = 'active'`,
        bidIds,
      );
      completedCount = completeResult.affectedRows;
    }

    if (completedCount === 0 && cancelledCount === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "No bids found or already processed",
      });
    }

    // ===== 2. 완료된 입찰 데이터 조회 =====
    let completedBids = [];
    if (completedCount > 0) {
      const [rows] = await connection.query(
        `SELECT 
           d.id, 
           d.user_id, 
           d.item_id,
           d.winning_price, 
           d.current_price, 
           i.title, 
           i.scheduled_date 
         FROM direct_bids d 
         LEFT JOIN crawled_items i ON d.item_id = i.item_id 
         WHERE d.id IN (${placeholders}) 
           AND d.status = 'completed'`,
        bidIds,
      );
      completedBids = rows;

      console.log(
        `[COMPLETE] ${completedBids.length}건 낙찰 확정:`,
        completedBids.map((b) => `ID:${b.id} User:${b.user_id}`).join(", "),
      );

      for (const completedBid of completedBids) {
        const syncResult = await syncWmsByBidStatus(connection, {
          bidType: "direct",
          bidId: Number(completedBid.id),
          itemId: completedBid.item_id || null,
          nextStatus: "completed",
        });
        if (!syncResult?.updated && syncResult?.reason !== "already-synced") {
          console.warn(
            "[WMS sync][direct][complete] status update not applied:",
            {
              bidId: Number(completedBid.id),
              itemId: completedBid.item_id || null,
              reason: syncResult?.reason || "unknown",
            },
          );
        }
      }
    }

    // ===== 3. 동일 상품의 다른 입찰 취소 및 예치금/한도 복구 =====
    for (const bid of completedBids) {
      // 3-1) 취소할 다른 입찰들 조회
      const [otherBids] = await connection.query(
        `SELECT d.id, d.user_id, u.account_type 
         FROM direct_bids d
         JOIN user_accounts u ON d.user_id = u.user_id
         WHERE d.item_id = ? 
           AND d.id NOT IN (${placeholders}) 
           AND d.status = 'active'`,
        [bid.item_id, ...bidIds],
      );

      // 3-2) 각 입찰에 대해 예치금/한도 복구
      for (const otherBid of otherBids) {
        const otherBidDeductAmount = await getBidDeductAmount(
          connection,
          otherBid.id,
          "direct_bid",
        );

        if (otherBidDeductAmount > 0) {
          if (otherBid.account_type === "individual") {
            await refundDeposit(
              connection,
              otherBid.user_id,
              otherBidDeductAmount,
              "direct_bid",
              otherBid.id,
              "낙찰 완료로 인한 취소 환불",
            );
          } else {
            await refundLimit(
              connection,
              otherBid.user_id,
              otherBidDeductAmount,
              "direct_bid",
              otherBid.id,
              "낙찰 완료로 인한 취소 환불",
            );
          }
        }
      }

      // 3-3) 입찰 상태 변경
      await connection.query(
        `UPDATE direct_bids 
         SET status = 'cancelled' 
         WHERE item_id = ? 
           AND id NOT IN (${placeholders}) 
           AND status = 'active'`,
        [bid.item_id, ...bidIds],
      );
    }

    await connection.commit();

    // ===== 4. 후속 처리: 정산 생성 및 예치금 조정 =====
    const processedSettlements = new Set();

    for (const bid of completedBids) {
      try {
        // 정산 날짜 계산 (scheduled_date 기준)
        const settlementDate = new Date(bid.scheduled_date)
          .toISOString()
          .split("T")[0];

        const settlementKey = `${bid.user_id}-${settlementDate}`;

        // 이미 처리한 (사용자, 날짜) 조합은 스킵
        if (processedSettlements.has(settlementKey)) {
          continue;
        }
        processedSettlements.add(settlementKey);

        console.log(
          `[SETTLEMENT] 정산 생성: user=${bid.user_id}, date=${settlementDate}`,
        );

        // 정산 생성/업데이트
        await createOrUpdateSettlement(bid.user_id, settlementDate);

        // 계정 타입 확인
        const [accounts] = await connection.query(
          "SELECT account_type FROM user_accounts WHERE user_id = ?",
          [bid.user_id],
        );

        // 개인 회원인 경우 예치금 조정 + payment_status 업데이트
        if (accounts[0]?.account_type === "individual") {
          await adjustDepositBalance(connection, bid.user_id, settlementDate);

          await connection.query(
            `UPDATE daily_settlements 
             SET payment_status = 'paid', payment_method = 'deposit' 
             WHERE user_id = ? AND settlement_date = ?`,
            [bid.user_id, settlementDate],
          );

          console.log(`[SETTLEMENT] 예치금 조정 완료: user=${bid.user_id}`);
        }
      } catch (settlementError) {
        console.error(
          `[SETTLEMENT ERROR] user=${bid.user_id}:`,
          settlementError,
        );
        // 정산 생성 실패해도 낙찰 확정은 유지
      }
    }

    // ===== 5. 응답 =====
    let message;
    if (id) {
      // 단일 처리
      if (completedCount > 0) {
        message = "Bid completed successfully";
      } else if (cancelledCount > 0) {
        message = "Bid cancelled (winning price exceeds current price)";
      } else {
        message = "No bid found or already processed";
      }
    } else {
      // 다중 처리
      const messages = [];
      if (completedCount > 0) {
        messages.push(`${completedCount} bid(s) completed`);
      }
      if (cancelledCount > 0) {
        messages.push(`${cancelledCount} bid(s) cancelled`);
      }
      message =
        messages.length > 0
          ? messages.join(", ")
          : "No bids found or already processed";
    }

    res.status(200).json({
      message: message,
      status: "completed",
      completedCount: completedCount,
      cancelledCount: cancelledCount,
      winningPrice: winningPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("[COMPLETE ERROR]", err);
    res.status(500).json({
      message: "Error completing bid(s)",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    connection.release();
  }
});

// 낙찰 실패 처리 - 단일 또는 다중 처리 지원
router.put("/cancel", isAdmin, async (req, res) => {
  const { id, ids } = req.body; // 단일 id 또는 다중 ids 배열 수신

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환하여 일관된 처리
  const bidIds = id ? [id] : ids;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const placeholders = bidIds.map(() => "?").join(",");

    // 1. 취소할 입찰 정보 조회 (관리자는 completed도 취소 가능)
    const [bids] = await connection.query(
      `SELECT d.id, d.user_id, d.status, i.scheduled_date
       FROM direct_bids d
       JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.id IN (${placeholders})`,
      bidIds,
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No bids to cancel" });
    }

    // 2. 입찰 취소 처리 (shipping_status도 pending으로 리셋)
    await connection.query(
      `UPDATE direct_bids SET status = 'cancelled', shipping_status = 'pending' WHERE id IN (${placeholders})`,
      bidIds,
    );

    // 3. 예치금/한도 복구 및 정산 재계산
    for (const bid of bids) {
      const [account] = await connection.query(
        "SELECT account_type FROM user_accounts WHERE user_id = ?",
        [bid.user_id],
      );

      // 차감액 조회
      const deductAmount = await getBidDeductAmount(
        connection,
        bid.id,
        "direct_bid",
      );

      if (deductAmount > 0) {
        if (account[0]?.account_type === "individual") {
          // 예치금 복구
          await refundDeposit(
            connection,
            bid.user_id,
            deductAmount,
            "direct_bid",
            bid.id,
            "입찰 취소 환불",
          );
        } else {
          // 한도 복구
          await refundLimit(
            connection,
            bid.user_id,
            deductAmount,
            "direct_bid",
            bid.id,
            "입찰 취소 환불",
          );
        }
      }

      // 정산 재계산
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      await createOrUpdateSettlement(bid.user_id, settlementDate);
    }

    await connection.commit();

    res.status(200).json({
      message: id
        ? "Bid cancelled successfully"
        : `${bids.length} bids cancelled successfully`,
      status: "cancelled",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error cancelling bid(s):", err);
    res.status(500).json({ message: "Error cancelling bid(s)" });
  } finally {
    connection.release();
  }
});

// 입찰 수동 제출 API
router.post("/:id/submit", isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // 입찰 정보 조회
    const connection = await pool.getConnection();

    try {
      const [bids] = await connection.query(
        "SELECT * FROM direct_bids WHERE id = ?",
        [id],
      );

      if (bids.length === 0) {
        return res.status(404).json({ message: "Bid not found" });
      }

      const bid = bids[0];

      // 이미 제출된 입찰인지 확인
      if (bid.submitted_to_platform) {
        return res.status(400).json({
          message: "This bid has already been submitted to the platform",
        });
      }

      // 입찰 상태 확인
      if (bid.status !== "active") {
        return res.status(400).json({
          message: "Only active bids can be submitted to the platform",
        });
      }

      // JOIN을 사용하여 item 정보 가져오기
      const [itemResults] = await connection.query(
        "SELECT i.* FROM crawled_items i JOIN direct_bids b ON i.item_id = b.item_id AND i.auc_num = (SELECT auc_num FROM crawled_items WHERE item_id = b.item_id LIMIT 1) WHERE b.id = ?",
        [id],
      );

      if (itemResults.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      const item = itemResults[0];

      // submitBid 함수 호출
      const result = await submitBid(
        {
          bid_id: id,
          price: bid.current_price,
        },
        item,
      );

      if (result.success) {
        return res.status(200).json({
          message: "Bid successfully submitted to platform",
          bidId: id,
          success: true,
        });
      } else {
        return res.status(result.statusCode || 500).json({
          message: result.message,
          error: result.error,
          success: false,
        });
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error submitting bid:", error);
    return res.status(500).json({
      message: "Error submitting bid",
      error: error.message,
      success: false,
    });
  }
});

// 플랫폼 반영 완료 표시 - 단일 또는 다중 처리 지원
router.put("/mark-submitted", isAdmin, async (req, res) => {
  const { id, ids } = req.body; // 단일 id 또는 다중 ids 배열 수신

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환하여 일관된 처리
  const bidIds = id ? [id] : ids;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 한 번의 쿼리로 여러 입찰의 플랫폼 반영 상태를 업데이트
    const placeholders = bidIds.map(() => "?").join(",");

    const [updateResult] = await connection.query(
      `UPDATE direct_bids SET submitted_to_platform = TRUE WHERE id IN (${placeholders}) AND submitted_to_platform = FALSE`,
      bidIds,
    );

    await connection.commit();

    res.status(200).json({
      message: id
        ? "Bid marked as submitted successfully"
        : `${updateResult.affectedRows} bids marked as submitted successfully`,
      submitted_to_platform: true,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error marking bid(s) as submitted:", err);
    res.status(500).json({ message: "Error marking bid(s) as submitted" });
  } finally {
    connection.release();
  }
});

// GET endpoint to retrieve a specific bid by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  const connection = await pool.getConnection();

  try {
    // 입찰 정보 가져오기
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id],
    );

    if (bids.length === 0) {
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    // 인증 확인 - 관리자 또는 입찰 소유자만 볼 수 있음
    if (!isAdminUser(req.session?.user) && bid.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this bid" });
    }

    // 아이템 정보 가져오기 (JOIN 사용)
    const [items] = await connection.query(
      "SELECT i.* FROM crawled_items i JOIN direct_bids b ON i.item_id = b.item_id WHERE b.id = ? LIMIT 1",
      [id],
    );

    const bidWithItem = {
      ...bid,
      item: items.length > 0 ? items[0] : null,
    };

    res.status(200).json(bidWithItem);
  } catch (err) {
    console.error("Error retrieving bid:", err);
    res.status(500).json({ message: "Error retrieving bid" });
  } finally {
    connection.release();
  }
});

// direct_bids 수정 라우터
router.put("/:id", isAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    current_price,
    status,
    submitted_to_platform,
    winning_price,
    shipping_status,
  } = req.body;

  if (!id) {
    return res.status(400).json({ message: "Bid ID is required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }
    const bid = bids[0];

    // 업데이트할 필드들과 값들을 동적으로 구성
    const updates = [];
    const params = [];

    if (current_price !== undefined) {
      updates.push("current_price = ?");
      params.push(current_price);
    }
    if (status !== undefined) {
      // 유효한 status 값 체크
      const validBidStatuses = ["active", "completed", "cancelled"];
      if (!validBidStatuses.includes(status)) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Invalid status. Must be one of: " + validBidStatuses.join(", "),
        });
      }
      updates.push("status = ?");
      params.push(status);
      // shipping_status를 명시적으로 제공하지 않은 경우 자동 설정
      if (shipping_status === undefined) {
        if (status === "completed") {
          updates.push("shipping_status = ?");
          params.push("completed");
        } else {
          updates.push("shipping_status = ?");
          params.push("pending");
        }
      }
    }
    // shipping_status 독립 처리 (status = 'completed'일 때만 허용)
    if (shipping_status !== undefined) {
      const validShippingStatuses = [
        "pending",
        "completed",
        "domestic_arrived",
        "processing",
        "shipped",
      ];
      if (!validShippingStatuses.includes(shipping_status)) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Invalid shipping_status. Must be one of: " +
            validShippingStatuses.join(", "),
        });
      }
      const currentStatus = status !== undefined ? status : bid.status;
      if (currentStatus !== "completed") {
        await connection.rollback();
        return res.status(400).json({
          message: "shipping_status can only be set when status is 'completed'",
        });
      }
      updates.push("shipping_status = ?");
      params.push(shipping_status);
    }
    if (submitted_to_platform !== undefined) {
      // boolean 값 확인
      if (typeof submitted_to_platform !== "boolean") {
        await connection.rollback();
        return res.status(400).json({
          message: "submitted_to_platform must be a boolean value",
        });
      }
      updates.push("submitted_to_platform = ?");
      params.push(submitted_to_platform);
    }
    if (winning_price !== undefined) {
      updates.push("winning_price = ?");
      params.push(winning_price);
    }

    // 업데이트할 필드가 없으면 에러 반환
    if (updates.length === 0 && shipping_status === undefined) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "No valid fields to update. Allowed fields: current_price, status, submitted_to_platform, winning_price, shipping_status",
      });
    }

    if (updates.length > 0) {
      // updated_at 자동 업데이트 추가
      updates.push("updated_at = NOW()");
      params.push(id);

      const updateQuery = `UPDATE direct_bids SET ${updates.join(
        ", ",
      )} WHERE id = ?`;

      const [updateResult] = await connection.query(updateQuery, params);

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ message: "Bid not found or no changes made" });
      }
    }

    // shipping_status가 명시적으로 제공되거나 status 변경으로 자동 확정된 경우 WMS 동기화
    const effectiveShippingStatus =
      shipping_status !== undefined
        ? shipping_status
        : status === "completed"
          ? "completed"
          : status !== undefined
            ? "pending"
            : null;

    if (effectiveShippingStatus !== null) {
      const syncResult = await syncWmsByBidStatus(connection, {
        bidType: "direct",
        bidId: Number(id),
        itemId: bid.item_id || null,
        nextStatus: effectiveShippingStatus,
      });
      if (!syncResult?.updated && syncResult?.reason !== "already-synced") {
        console.warn("[WMS sync][direct] shipping_status update not applied:", {
          bidId: Number(id),
          itemId: bid.item_id || null,
          effectiveShippingStatus,
          reason: syncResult?.reason || "unknown",
        });
      }
    }

    await connection.commit();

    // 업데이트된 bid 정보 반환
    const [updatedBids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id],
    );

    // status나 winning_price가 변경된 경우 정산 업데이트
    if (status !== undefined || winning_price !== undefined) {
      const [bidWithItem] = await connection.query(
        `SELECT d.user_id, i.scheduled_date 
         FROM direct_bids d 
         JOIN crawled_items i ON d.item_id = i.item_id 
         WHERE d.id = ?`,
        [id],
      );

      if (bidWithItem.length > 0 && bidWithItem[0].scheduled_date) {
        const settlementDate = new Date(bidWithItem[0].scheduled_date)
          .toISOString()
          .split("T")[0];
        createOrUpdateSettlement(bidWithItem[0].user_id, settlementDate).catch(
          console.error,
        );
      }
    }

    res.status(200).json({
      message: "Bid updated successfully",
      bid: updatedBids[0],
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error updating bid:", err);
    res.status(500).json({ message: "Error updating bid" });
  } finally {
    connection.release();
  }
});

// 자동 입찰 제출 스케줄러 - 월요일 매 시간 정각 실행
const startAutoSubmitScheduler = () => {
  // 크론 표현식: '0 * * * 1' = 월요일 매 시간 0분에 실행
  cron.schedule(
    "0 * * * 1",
    async () => {
      console.log("[Auto-Submit] 월요일 정기 재시도 작업 시작...");
      const connection = await pool.getConnection();
      try {
        // starting_price와 current_price가 다른 입찰만 조회하여 재입찰
        const [unsubmittedBids] = await connection.query(
          `SELECT d.*, i.* FROM direct_bids d 
         JOIN crawled_items i ON d.item_id = i.item_id 
         WHERE d.status = 'active' 
         AND d.submitted_to_platform = FALSE
         AND i.starting_price != d.current_price`,
        );

        console.log(
          `[Auto-Submit] ${unsubmittedBids.length}건의 미제출 입찰 발견`,
        );

        for (const bid of unsubmittedBids) {
          try {
            await submitBid(
              {
                bid_id: bid.id,
                price: bid.current_price,
              },
              bid,
            );
            console.log(`[Auto-Submit] 입찰 ${bid.id} 자동 제출 성공`);
          } catch (error) {
            console.error(`[Auto-Submit] 입찰 ${bid.id} 제출 실패:`, error);
          }
        }
      } catch (error) {
        console.error("[Auto-Submit] 스케줄러 오류:", error);
      } finally {
        connection.release();
      }
    },
    {
      timezone: "Asia/Seoul",
    },
  );

  console.log("[Auto-Submit] 스케줄러 시작됨 - 월요일 매 시간 정각 실행");
};

startAutoSubmitScheduler();

module.exports = router;
