// routes/live-bids.js - 현장 경매(1차->2차->최종) 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const {
  ecoAucCrawler,
  brandAucCrawler,
  starAucCrawler,
  mekikiAucCrawler,
} = require("../crawlers/index");
const { validateBidByAuction } = require("../utils/submitBid");
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
const { isAdminUser } = require("../utils/adminAuth");
const { syncWmsByBidStatus } = require("../utils/wms-bid-sync");

const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// live_bids.status: 'first', 'second', 'final', 'completed', 'cancelled'
// live_bids.shipping_status (status='completed'일 때만 유효): 'completed', 'domestic_arrived', 'processing', 'shipped'
//                 (status!='completed'일 때): 항상 'pending'

// Updated GET endpoint for live-bids.js
router.get("/", async (req, res) => {
  const {
    search,
    status,
    aucNum,
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

  const userId = req.session.user.id;

  // Prepare base query
  let queryConditions = ["1=1"];
  let queryParams = [];

  // 검색 조건 추가
  if (search) {
    const searchTerm = `%${search}%`;
    const compactSearchTerm = `%${String(search).replace(/\s+/g, "")}%`;
    queryConditions.push(
      "((CONVERT(b.item_id USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(i.original_title USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(i.brand USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(i.additional_info USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(u.login_id USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(u.company_name USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR REPLACE((CONVERT(u.company_name USING utf8mb4) COLLATE utf8mb4_unicode_ci), _utf8mb4' ' COLLATE utf8mb4_unicode_ci, _utf8mb4'' COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(wms.internal_barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(wms.external_barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(wmsi.internal_barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci) OR (CONVERT(wmsi.external_barcode USING utf8mb4) COLLATE utf8mb4_unicode_ci) LIKE (CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci))",
    );
    queryParams.push(
      searchTerm,
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

  // Add status filter if provided
  if (status) {
    const statusArray = status.split(",");
    const SHIPPING_STATUSES = new Set([
      "pending",
      "completed",
      "domestic_arrived",
      "processing",
      "shipped",
    ]);
    const shippingFilters = statusArray.filter((s) => SHIPPING_STATUSES.has(s));
    const bidFilters = statusArray.filter((s) => !SHIPPING_STATUSES.has(s));

    if (shippingFilters.length > 0 && bidFilters.length === 0) {
      // shipping_status 필터만: status='completed'+ shipping_status IN (...)
      const placeholders = shippingFilters.map(() => "?").join(",");
      queryConditions.push(
        `b.status = 'completed' AND b.shipping_status IN (${placeholders})`,
      );
      queryParams.push(...shippingFilters);
    } else if (shippingFilters.length > 0) {
      // 혼합: bid status 또는 shipping_status
      const shippingPlaceholders = shippingFilters.map(() => "?").join(",");
      const bidPlaceholders = bidFilters.map(() => "?").join(",");
      queryConditions.push(
        `(b.status IN (${bidPlaceholders}) OR (b.status = 'completed' AND b.shipping_status IN (${shippingPlaceholders})))`,
      );
      queryParams.push(...bidFilters, ...shippingFilters);
    } else {
      // bid status 필터만
      if (bidFilters.length === 1) {
        queryConditions.push("b.status = ?");
      } else {
        const placeholders = bidFilters.map(() => "?").join(",");
        queryConditions.push(`b.status IN (${placeholders})`);
      }
      queryParams.push(...bidFilters);
    }
  }

  if (aucNum) {
    const aucNumArray = aucNum.split(",");

    if (aucNumArray.length === 1) {
      queryConditions.push("i.auc_num = ?");
      queryParams.push(aucNum);
    } else {
      const placeholders = aucNumArray.map(() => "?").join(",");
      queryConditions.push(`i.auc_num IN (${placeholders})`);
      queryParams.push(...aucNumArray);
    }
  }

  // 시작 날짜 필터 추가
  if (fromDate) {
    queryConditions.push("b.updated_at >= ?");
    queryParams.push(fromDate);
  }

  // 종료 날짜 필터 추가
  if (toDate) {
    queryConditions.push("b.updated_at <= ?");
    queryParams.push(toDate);
  }

  // Regular users can only see their own bids, admins can see all
  if (!isAdminUser(req.session?.user)) {
    queryConditions.push("b.user_id = ?");
    queryParams.push(userId);
  }

  const whereClause = queryConditions.join(" AND ");

  // Count query for pagination
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM live_bids b
    LEFT JOIN crawled_items i ON b.item_id = i.item_id
    LEFT JOIN users u ON b.user_id = u.id
    LEFT JOIN (
      SELECT
        source_bid_type,
        source_bid_id,
        MAX(internal_barcode) AS internal_barcode,
        MAX(external_barcode) AS external_barcode
      FROM wms_items
      GROUP BY source_bid_type, source_bid_id
    ) wms ON wms.source_bid_type = 'live' AND wms.source_bid_id = b.id
    LEFT JOIN (
      SELECT
        source_item_id,
        MAX(internal_barcode) AS internal_barcode,
        MAX(external_barcode) AS external_barcode
      FROM wms_items
      WHERE source_item_id IS NOT NULL
      GROUP BY source_item_id
    ) wmsi ON wmsi.source_item_id = b.item_id
    WHERE ${whereClause}
  `;

  // Main query with JOIN
  const mainQuery = `
    SELECT 
      b.*,
      COALESCE(wms.internal_barcode, wmsi.internal_barcode) AS wms_internal_barcode,
      COALESCE(wms.current_location_code, wmsi.current_location_code) AS wms_location_code,
      i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
      i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title, i.additional_info,
      u.company_name, u.login_id
    FROM live_bids b
    LEFT JOIN crawled_items i ON b.item_id = i.item_id
    LEFT JOIN users u ON b.user_id = u.id
    LEFT JOIN (
      SELECT
        source_bid_type,
        source_bid_id,
        MAX(internal_barcode) AS internal_barcode,
        MAX(external_barcode) AS external_barcode,
        MAX(current_location_code) AS current_location_code
      FROM wms_items
      GROUP BY source_bid_type, source_bid_id
    ) wms ON wms.source_bid_type = 'live' AND wms.source_bid_id = b.id
    LEFT JOIN (
      SELECT
        source_item_id,
        MAX(internal_barcode) AS internal_barcode,
        MAX(external_barcode) AS external_barcode,
        MAX(current_location_code) AS current_location_code
      FROM wms_items
      WHERE source_item_id IS NOT NULL
      GROUP BY source_item_id
    ) wmsi ON wmsi.source_item_id = b.item_id
    WHERE ${whereClause}
  `;

  // 정렬 기준 설정
  let orderByColumn;
  switch (sortBy) {
    case "original_scheduled_date":
      orderByColumn = "i.original_scheduled_date";
      break;
    case "updated_at":
      orderByColumn = "b.updated_at";
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
  const orderByClause = ` ORDER BY ${orderByColumn} ${direction}`;

  let finalQuery = mainQuery + orderByClause;
  let finalQueryParams;

  // 페이지네이션 추가 (limit=0이 아닌 경우에만)
  if (usesPagination) {
    const paginationClause = " LIMIT ? OFFSET ?";
    finalQuery += paginationClause;
    finalQueryParams = [...queryParams, parseInt(limit), parseInt(offset)];
  } else {
    finalQueryParams = [...queryParams];
  }

  const connection = await pool.getConnection();

  try {
    // Get total count
    const [countResult] = await connection.query(countQuery, queryParams);
    const total = countResult[0].total;
    const totalPages = usesPagination ? Math.ceil(total / limit) : 1;

    // Get bids with item details in a single query
    const [rows] = await connection.query(finalQuery, finalQueryParams);

    // Format result to match expected structure
    const bidsWithItems = rows.map((row) => {
      const bid = {
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        login_id: row.login_id,
        company_name: row.company_name,
        first_price: row.first_price,
        second_price: row.second_price,
        final_price: row.final_price,
        status: row.status,
        shipping_status: row.shipping_status || "pending",
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

// 고객의 1차 입찰 제출
// 1차 입찰 제출 부분 수정 (기존 router.post("/", async (req, res) => { 부분)
router.post("/", async (req, res) => {
  const { itemId, aucNum, firstPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !aucNum || !firstPrice) {
    return res.status(400).json({
      message: "Item ID, auction number, and first price are required",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 상품 정보 체크 (scheduled_date 포함)
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
        `[Live Bid] Triggering background detail fetch for ${itemId}`,
      );
      processItem(itemId, aucNum).catch((err) => {
        console.error(`[Background] Failed to process ${itemId}:`, err.message);
      });
    }

    // 1차 입찰 시간 제한 체크: scheduled_date까지만 가능
    const now = new Date();
    const scheduledDate = new Date(item.scheduled_date);

    if (now > scheduledDate) {
      await connection.rollback();
      return res.status(400).json({
        message: "1차 입찰 시간이 종료되었습니다.",
        scheduled_date: item.scheduled_date,
      });
    }

    // 1차 입찰 금액 검증: starting price보다 높아야 함
    if (firstPrice <= item.starting_price) {
      await connection.rollback();
      return res.status(400).json({
        message: `입찰 금액은 시작가보다 높아야 합니다.`,
        starting_price: item.starting_price,
      });
    }

    // 이미 입찰한 내역이 있는지 체크 (FOR UPDATE로 락 걸기)
    const [existingBids] = await connection.query(
      "SELECT * FROM live_bids WHERE item_id = ? AND user_id = ? FOR UPDATE",
      [itemId, userId],
    );

    if (existingBids.length > 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "You already have a bid for this item" });
    }

    // 새 입찰 생성
    const [result] = await connection.query(
      'INSERT INTO live_bids (item_id, user_id, first_price, status) VALUES (?, ?, ?, "first")',
      [itemId, userId, firstPrice],
    );

    await connection.commit();

    res.status(201).json({
      message: "First bid submitted successfully",
      bidId: result.insertId,
      status: "first",
      firstPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error submitting first bid:", err);

    // Duplicate entry error check
    if (err.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ message: "You already have a bid for this item" });
    }

    res.status(500).json({ message: "Error submitting bid" });
  } finally {
    connection.release();
  }
});

// 관리자의 2차 입찰가 제안
router.put("/:id/second", isAdmin, async (req, res) => {
  const { id } = req.params;
  const { secondPrice } = req.body;

  if (!secondPrice) {
    return res.status(400).json({ message: "Second price is required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }
    const bid = bids[0];

    if (bid.status !== "first") {
      await connection.rollback();
      return res.status(400).json({ message: "Bid is not in first stage" });
    }

    // 2차 입찰가 업데이트
    await connection.query(
      'UPDATE live_bids SET second_price = ?, status = "second" WHERE id = ?',
      [secondPrice, id],
    );

    await connection.commit();

    res.status(200).json({
      message: "Second price proposed successfully",
      bidId: id,
      status: "second",
      secondPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error proposing second price:", err);
    res.status(500).json({ message: "Error proposing second price" });
  } finally {
    connection.release();
  }
});

// 고객의 최종 입찰가 제출
router.put("/:id/final", async (req, res) => {
  const { id } = req.params;
  const { finalPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!finalPrice) {
    return res.status(400).json({ message: "Final price is required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 입찰 정보와 상품 정보 확인
    const [bids] = await connection.query(
      `SELECT l.*, i.scheduled_date, i.auc_num, i.additional_info, i.starting_price, i.category
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ?`,
      [id],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    if (bid.user_id !== userId) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "Not authorized to update this bid" });
    }

    if (bid.status !== "second") {
      await connection.rollback();
      return res.status(400).json({ message: "Bid is not in second stage" });
    }

    // 2. 시간 제한 체크
    const now = new Date();
    const scheduledDate = new Date(bid.scheduled_date);
    const deadline = new Date(scheduledDate);
    deadline.setHours(23, 59, 59, 999);

    if (now > deadline) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "최종 입찰 시간이 종료되었습니다. (경매일 저녁 12시까지만 가능)",
        deadline: deadline.toISOString(),
        scheduled_date: bid.scheduled_date,
      });
    }

    // 3. 금액 검증
    if (finalPrice <= bid.starting_price) {
      await connection.rollback();
      return res.status(400).json({
        message: `입찰 금액은 시작가보다 높아야 합니다.`,
        starting_price: bid.starting_price,
      });
    }

    const currentHighestPrice = bid.starting_price;
    const validation = validateBidByAuction(
      bid.auc_num,
      finalPrice,
      currentHighestPrice,
      true,
    );

    if (!validation.valid) {
      await connection.rollback();
      return res.status(400).json({
        message: validation.message,
      });
    }

    // 4. 환율 조회
    const exchangeRate = await getExchangeRate();

    // 5. 차감액 계산 - 계정 타입별 분리
    const totalPrice = calculateTotalPrice(
      finalPrice,
      bid.auc_num,
      bid.category,
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

    // 8. 입찰 상태 변경
    await connection.query(
      'UPDATE live_bids SET final_price = ?, status = "final" WHERE id = ?',
      [finalPrice, id],
    );

    // 9. Commit (크롤러가 DB 조회하므로 데드락 방지)
    await connection.commit();

    // 10. 크롤러 처리 (주 로직)
    if (bid.auc_num == 1 && ecoAucCrawler) {
      ecoAucCrawler.liveBid(bid.item_id, finalPrice);
      ecoAucCrawler.addWishlist(bid.item_id, 1);
    } else if (bid.auc_num == 2 && brandAucCrawler) {
      brandAucCrawler.liveBid(bid.item_id, finalPrice);
      const additionalInfo =
        typeof bid.additional_info === "string"
          ? JSON.parse(bid.additional_info)
          : bid.additional_info || {};
      brandAucCrawler.addWishlist(
        bid.item_id,
        "A",
        additionalInfo.kaisaiKaisu || 0,
      );
    } else if (bid.auc_num == 4 && mekikiAucCrawler) {
      const additionalInfo =
        typeof bid.additional_info === "string"
          ? JSON.parse(bid.additional_info)
          : bid.additional_info || {};
      mekikiAucCrawler.liveBid(
        bid.item_id,
        finalPrice,
        additionalInfo.event_id,
      );
      mekikiAucCrawler.addWishlist(bid.item_id, additionalInfo.event_id);
    }

    // 11. 예치금/한도 차감 (별도 트랜잭션)
    const newConnection = await pool.getConnection();
    try {
      await newConnection.beginTransaction();

      if (account.account_type === "individual") {
        await deductDeposit(
          newConnection,
          userId,
          deductAmount,
          "live_bid",
          id,
          `현장경매 최종입찰 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      } else {
        await deductLimit(
          newConnection,
          userId,
          deductAmount,
          "live_bid",
          id,
          `현장경매 최종입찰 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      }

      await newConnection.commit();
    } catch (err) {
      await newConnection.rollback();
      console.error("예치금 차감 실패:", err);

      // 차감 실패 시 입찰도 롤백
      const rollbackConnection = await pool.getConnection();
      try {
        await rollbackConnection.query(
          'UPDATE live_bids SET status = "cancelled" WHERE id = ?',
          [id],
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

    res.status(200).json({
      message: "Final price submitted successfully",
      bidId: id,
      status: "final",
      finalPrice,
      deductAmount,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error submitting final price:", err);
    res.status(500).json({ message: "Error submitting final price" });
  } finally {
    connection.release();
  }
});

// 낙찰 완료 처리 - 단일 또는 다중 처리 지원
router.put("/complete", isAdmin, async (req, res) => {
  const { id, ids, winningPrice } = req.body; // 단일 id 또는 다중 ids 배열 수신

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환하여 일관된 처리
  const bidIds = id ? [id] : ids;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 한 번의 쿼리로 여러 입찰 상태를 업데이트
    const placeholders = bidIds.map(() => "?").join(",");

    let updateResult;
    let completedCount = 0;
    let cancelledCount = 0;

    // 낙찰 금액이 있는 경우
    if (winningPrice !== undefined) {
      // 취소될 입찰 정보 조회 (예치금/한도 복구를 위해)
      const [bidsToCancel] = await connection.query(
        `SELECT lb.id, lb.user_id, u.account_type
         FROM live_bids lb
         JOIN user_accounts u ON lb.user_id = u.user_id
         WHERE lb.id IN (${placeholders}) AND lb.status = 'final' AND lb.final_price < ?`,
        [...bidIds, winningPrice],
      );

      // 예치금/한도 복구
      for (const bid of bidsToCancel) {
        const deductAmount = await getBidDeductAmount(
          connection,
          bid.id,
          "live_bid",
        );

        if (deductAmount > 0) {
          if (bid.account_type === "individual") {
            await refundDeposit(
              connection,
              bid.user_id,
              deductAmount,
              "live_bid",
              bid.id,
              "낙찰가 초과로 인한 취소 환불",
            );
          } else {
            await refundLimit(
              connection,
              bid.user_id,
              deductAmount,
              "live_bid",
              bid.id,
              "낙찰가 초과로 인한 취소 환불",
            );
          }
        }
      }

      // 취소 처리: winningPrice > final_price
      const [cancelResult] = await connection.query(
        `UPDATE live_bids SET status = 'cancelled', winning_price = ? WHERE id IN (${placeholders}) AND status = 'final' AND final_price < ?`,
        [winningPrice, ...bidIds, winningPrice],
      );
      cancelledCount = cancelResult.affectedRows;

      // 완료 처리: winningPrice <= final_price
      const [completeResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed', shipping_status = 'completed', winning_price = ?, completed_at = NOW() WHERE id IN (${placeholders}) AND status = 'final' AND final_price >= ?`,
        [winningPrice, ...bidIds, winningPrice],
      );
      completedCount = completeResult.affectedRows;

      updateResult = {
        affectedRows: cancelledCount + completedCount,
      };
    } else {
      // 낙찰 금액이 없을 경우 기존 최종 입찰가를 winning_price로 설정하여 완료 처리
      [updateResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed', shipping_status = 'completed', winning_price = final_price, completed_at = NOW() WHERE id IN (${placeholders}) AND status = 'final'`,
        bidIds,
      );
      completedCount = updateResult.affectedRows;
    }

    // commit 전에 완료될 입찰 데이터 조회
    let completedBidsData = [];
    if (completedCount > 0) {
      [completedBidsData] = await connection.query(
        `SELECT l.id, l.item_id, l.user_id, l.winning_price, l.final_price, i.title, i.scheduled_date 
        FROM live_bids l 
        LEFT JOIN crawled_items i ON l.item_id = i.item_id 
        WHERE l.id IN (${placeholders}) AND l.status = 'completed'`,
        bidIds,
      );

      for (const completedBid of completedBidsData) {
        const syncResult = await syncWmsByBidStatus(connection, {
          bidType: "live",
          bidId: Number(completedBid.id),
          itemId: completedBid.item_id || null,
          nextStatus: "completed",
        });
        if (!syncResult?.updated && syncResult?.reason !== "already-synced") {
          console.warn(
            "[WMS sync][live][complete] status update not applied:",
            {
              bidId: Number(completedBid.id),
              itemId: completedBid.item_id || null,
              reason: syncResult?.reason || "unknown",
            },
          );
        }
      }
    }

    await connection.commit();

    // 완료된 입찰에 대해 정산 생성 및 조정 처리
    for (const bid of completedBidsData) {
      try {
        const date = new Date(bid.scheduled_date).toISOString().split("T")[0];

        // 정산 생성
        await createOrUpdateSettlement(bid.user_id, date);

        // 계정 타입 확인
        const conn = await pool.getConnection();
        try {
          const [accounts] = await conn.query(
            "SELECT account_type FROM user_accounts WHERE user_id = ?",
            [bid.user_id],
          );

          // 개인 회원인 경우에만 예치금 조정 + payment_status 업데이트
          if (accounts[0]?.account_type === "individual") {
            await adjustDepositBalance(
              bid.user_id,
              bid.winning_price,
              date,
              bid.title,
            );

            await conn.query(
              `UPDATE daily_settlements 
              SET payment_status = 'paid', payment_method = 'deposit' 
              WHERE user_id = ? AND settlement_date = ?`,
              [bid.user_id, date],
            );

            console.log(`[SETTLEMENT] 예치금 조정 완료: user=${bid.user_id}`);
          }
        } finally {
          conn.release();
        }
      } catch (err) {
        console.error(
          `Error processing settlement for user ${bid.user_id}:`,
          err,
        );
      }
    }

    // 응답 메시지 구성
    let message;
    if (id) {
      if (winningPrice !== undefined) {
        if (completedCount > 0) {
          message = "Bid completed successfully";
        } else if (cancelledCount > 0) {
          message = "Bid cancelled (winning price exceeds final price)";
        } else {
          message = "No bid found or already processed";
        }
      } else {
        message = "Bid completed successfully";
      }
    } else {
      const messages = [];
      if (completedCount > 0) {
        messages.push(`${completedCount} bid(s) completed`);
      }
      if (cancelledCount > 0) {
        messages.push(
          `${cancelledCount} bid(s) cancelled (winning price exceeds final price)`,
        );
      }
      message =
        messages.length > 0
          ? messages.join(", ")
          : "No bids found or already processed";
    }

    res.status(200).json({
      message: message,
      completedCount: completedCount,
      cancelledCount: cancelledCount,
      winningPrice: winningPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error completing bid(s):", err);
    res.status(500).json({ message: "Error completing bid(s)" });
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
      `SELECT l.id, l.user_id, l.status, i.scheduled_date
       FROM live_bids l
       JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.id IN (${placeholders}) AND l.status != 'completed'`,
      bidIds,
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No bids to cancel" });
    }

    // 2. 입찰 취소 처리
    await connection.query(
      `UPDATE live_bids SET status = 'cancelled' WHERE id IN (${placeholders}) AND status != 'completed'`,
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
        "live_bid",
      );

      if (deductAmount > 0) {
        if (account[0]?.account_type === "individual") {
          // 예치금 복구
          await refundDeposit(
            connection,
            bid.user_id,
            deductAmount,
            "live_bid",
            bid.id,
            "입찰 취소 환불",
          );
        } else {
          // 한도 복구
          await refundLimit(
            connection,
            bid.user_id,
            deductAmount,
            "live_bid",
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

// GET endpoint to retrieve a specific bid by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  const connection = await pool.getConnection();

  try {
    // Get bid
    const [bids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id],
    );

    if (bids.length === 0) {
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    // Check authorization - only admin or bid owner can view
    if (!isAdminUser(req.session?.user) && bid.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this bid" });
    }

    // Get item details (JOIN 사용)
    const [items] = await connection.query(
      "SELECT i.* FROM crawled_items i JOIN live_bids b ON i.item_id = b.item_id WHERE b.id = ? LIMIT 1",
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

// live_bids 수정 라우터
router.put("/:id", isAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    first_price,
    second_price,
    final_price,
    status,
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
      "SELECT * FROM live_bids WHERE id = ?",
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

    if (first_price !== undefined) {
      updates.push("first_price = ?");
      params.push(first_price);
    }
    if (second_price !== undefined) {
      updates.push("second_price = ?");
      params.push(second_price);
    }
    if (final_price !== undefined) {
      updates.push("final_price = ?");
      params.push(final_price);
    }
    if (status !== undefined) {
      // 유효한 bid status 값 체크 (물류 상태 제외)
      const validBidStatuses = [
        "first",
        "second",
        "final",
        "completed",
        "cancelled",
      ];
      if (!validBidStatuses.includes(status)) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Invalid status. Must be one of: " + validBidStatuses.join(", "),
        });
      }
      updates.push("status = ?");
      params.push(status);
      // status 연동 shipping_status 자동 설정 (명시적 shipping_status 값이 없는 경우)
      if (shipping_status === undefined) {
        if (status === "completed") {
          updates.push("shipping_status = 'completed'");
        } else {
          updates.push("shipping_status = 'pending'");
        }
      }
    }
    if (shipping_status !== undefined) {
      // shipping_status 독립 설정: status='completed'인 상태여야만 허용
      const validShippingStatuses = [
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
    if (winning_price !== undefined) {
      updates.push("winning_price = ?");
      params.push(winning_price);
    }

    // 업데이트할 필드가 없으면 에러 반환
    if (updates.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "No valid fields to update. Allowed fields: first_price, second_price, final_price, status, shipping_status, winning_price",
      });
    }

    if (updates.length > 0) {
      // updated_at 자동 업데이트 추가
      updates.push("updated_at = NOW()");
      params.push(id);

      const updateQuery = `UPDATE live_bids SET ${updates.join(
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

    // bid status 변경 시 WMS 동기화
    if (status !== undefined) {
      const syncResult = await syncWmsByBidStatus(connection, {
        bidType: "live",
        bidId: Number(id),
        itemId: bid.item_id || null,
        nextStatus: status,
      });
      if (!syncResult?.updated && syncResult?.reason !== "already-synced") {
        console.warn("[WMS sync][live] status update not applied:", {
          bidId: Number(id),
          itemId: bid.item_id || null,
          status,
          reason: syncResult?.reason || "unknown",
        });
      }
    }

    // shipping_status 변경 시 WMS 동기화
    if (shipping_status !== undefined) {
      const syncResult = await syncWmsByBidStatus(connection, {
        bidType: "live",
        bidId: Number(id),
        itemId: bid.item_id || null,
        nextStatus: shipping_status,
      });
      if (!syncResult?.updated && syncResult?.reason !== "already-synced") {
        console.warn("[WMS sync][live] shipping_status update not applied:", {
          bidId: Number(id),
          itemId: bid.item_id || null,
          shipping_status,
          reason: syncResult?.reason || "unknown",
        });
      }
    }

    await connection.commit();

    // 업데이트된 bid 정보 반환
    const [updatedBids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id],
    );

    // status나 winning_price가 변경된 경우 정산 업데이트
    if (status !== undefined || winning_price !== undefined) {
      const [bidWithItem] = await connection.query(
        `SELECT l.user_id, i.scheduled_date 
         FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id 
         WHERE l.id = ?`,
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

module.exports = router;
