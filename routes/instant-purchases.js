// routes/instant-purchases.js - 바로 구매 (Instant Purchase) 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { brandAucCrawler } = require("../crawlers/index");
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
const { isAdminUser } = require("../utils/adminAuth");
const { syncWmsByBidStatus } = require("../utils/wms-bid-sync");

const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// STATUS -> 'pending', 'completed', 'cancelled'
// shipping_status -> 'pending', 'completed', 'domestic_arrived', 'processing', 'shipped'
const SHIPPING_STATUSES = new Set([
  "pending",
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
]);

// ============================================================
// GET / - 바로 구매 목록 조회
// ============================================================
router.get("/", async (req, res) => {
  const {
    search,
    status,
    page = 1,
    limit = 10,
    fromDate,
    toDate,
    sortBy = "created_at",
    sortOrder = "desc",
  } = req.query;

  const usesPagination = parseInt(limit) !== 0;
  const offset = usesPagination ? (page - 1) * limit : 0;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const connection = await pool.getConnection();

  try {
    let queryParams = [];

    let countQuery = `
      SELECT COUNT(*) as total 
      FROM instant_purchases p
      LEFT JOIN crawled_items i ON p.item_id = i.item_id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN (
        SELECT
          source_bid_type,
          source_bid_id,
          MAX(internal_barcode) AS internal_barcode,
          MAX(external_barcode) AS external_barcode
        FROM wms_items
        GROUP BY source_bid_type, source_bid_id
      ) wms ON wms.source_bid_type = 'instant' AND wms.source_bid_id = p.id
      WHERE 1=1
    `;

    let mainQuery = `
      SELECT 
        p.*,
        COALESCE(wms.internal_barcode) AS wms_internal_barcode,
        COALESCE(wms.current_location_code) AS wms_location_code,
        i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
        i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title, i.additional_info,
        u.company_name, u.login_id
      FROM instant_purchases p
      LEFT JOIN crawled_items i ON p.item_id = i.item_id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN (
        SELECT
          source_bid_type,
          source_bid_id,
          MAX(internal_barcode) AS internal_barcode,
          MAX(external_barcode) AS external_barcode,
          MAX(current_location_code) AS current_location_code
        FROM wms_items
        GROUP BY source_bid_type, source_bid_id
      ) wms ON wms.source_bid_type = 'instant' AND wms.source_bid_id = p.id
      WHERE 1=1
    `;

    // 검색 조건
    if (search) {
      const searchTerm = `%${search}%`;
      const compactSearchTerm = `%${String(search).replace(/\s+/g, "")}%`;
      const searchClause = ` AND (
        CONVERT(p.item_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4) 
        OR CONVERT(i.original_title USING utf8mb4) LIKE CONVERT(? USING utf8mb4)
        OR CONVERT(u.login_id USING utf8mb4) LIKE CONVERT(? USING utf8mb4)
        OR CONVERT(u.company_name USING utf8mb4) LIKE CONVERT(? USING utf8mb4)
        OR REPLACE(CONVERT(u.company_name USING utf8mb4), ' ', '') LIKE CONVERT(? USING utf8mb4)
        OR CONVERT(wms.internal_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4)
        OR CONVERT(wms.external_barcode USING utf8mb4) LIKE CONVERT(? USING utf8mb4)
      )`;
      countQuery += searchClause;
      mainQuery += searchClause;
      queryParams.push(
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        compactSearchTerm,
        searchTerm,
        searchTerm,
      );
    }

    // 상태 필터
    if (status) {
      const statusArray = status.split(",");
      const shippingFilters = statusArray.filter((s) =>
        SHIPPING_STATUSES.has(s),
      );
      const purchaseFilters = statusArray.filter(
        (s) => !SHIPPING_STATUSES.has(s),
      );

      if (shippingFilters.length > 0 && purchaseFilters.length === 0) {
        const placeholders = shippingFilters.map(() => "?").join(",");
        countQuery += ` AND p.status = 'completed' AND p.shipping_status IN (${placeholders})`;
        mainQuery += ` AND p.status = 'completed' AND p.shipping_status IN (${placeholders})`;
        queryParams.push(...shippingFilters);
      } else if (shippingFilters.length > 0) {
        const shippingPlaceholders = shippingFilters.map(() => "?").join(",");
        const purchasePlaceholders = purchaseFilters.map(() => "?").join(",");
        countQuery += ` AND (p.shipping_status IN (${shippingPlaceholders}) OR p.status IN (${purchasePlaceholders}))`;
        mainQuery += ` AND (p.shipping_status IN (${shippingPlaceholders}) OR p.status IN (${purchasePlaceholders}))`;
        queryParams.push(...shippingFilters, ...purchaseFilters);
      } else {
        if (purchaseFilters.length === 1) {
          countQuery += " AND p.status = ?";
          mainQuery += " AND p.status = ?";
        } else {
          const placeholders = purchaseFilters.map(() => "?").join(",");
          countQuery += ` AND p.status IN (${placeholders})`;
          mainQuery += ` AND p.status IN (${placeholders})`;
        }
        queryParams.push(...purchaseFilters);
      }
    }

    // 날짜 필터
    if (fromDate) {
      countQuery += " AND p.created_at >= ?";
      mainQuery += " AND p.created_at >= ?";
      queryParams.push(fromDate);
    }
    if (toDate) {
      countQuery += " AND p.created_at <= ?";
      mainQuery += " AND p.created_at <= ?";
      queryParams.push(toDate);
    }

    // 일반 사용자는 자신의 구매만 조회
    if (!isAdminUser(req.session?.user)) {
      countQuery += " AND p.user_id = ?";
      mainQuery += " AND p.user_id = ?";
      queryParams.push(req.session.user.id);
    }

    // 정렬
    let orderByColumn;
    switch (sortBy) {
      case "created_at":
        orderByColumn = "p.created_at";
        break;
      case "updated_at":
        orderByColumn = "p.updated_at";
        break;
      case "original_title":
        orderByColumn = "i.original_title";
        break;
      case "starting_price":
        orderByColumn = "i.starting_price";
        break;
      case "brand":
        orderByColumn = "i.brand";
        break;
      default:
        orderByColumn = "p.created_at";
        break;
    }
    const direction = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    mainQuery += ` ORDER BY ${orderByColumn} ${direction}`;

    // 페이지네이션
    let mainQueryParams;
    if (usesPagination) {
      mainQuery += " LIMIT ? OFFSET ?";
      mainQueryParams = [...queryParams, parseInt(limit), parseInt(offset)];
    } else {
      mainQueryParams = [...queryParams];
    }

    const [countResult] = await connection.query(countQuery, queryParams);
    const total = countResult[0].total;
    const totalPages = usesPagination ? Math.ceil(total / limit) : 1;

    const [rows] = await connection.query(mainQuery, mainQueryParams);

    const purchasesWithItems = rows.map((row) => {
      const purchase = {
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        login_id: row.login_id,
        company_name: row.company_name,
        purchase_price: row.purchase_price,
        status: row.status,
        shipping_status: row.shipping_status || "pending",
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        platform_response: row.platform_response,
        appr_id: row.appr_id,
        repair_requested_at: row.repair_requested_at,
        repair_details: row.repair_details,
        repair_fee: row.repair_fee,
        internal_barcode: row.wms_internal_barcode || null,
        wms_location_code: row.wms_location_code || null,
      };

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

      return { ...purchase, item };
    });

    res.status(200).json({
      count: purchasesWithItems.length,
      total,
      totalPages,
      currentPage: parseInt(page),
      purchases: purchasesWithItems,
    });
  } catch (err) {
    console.error("Error retrieving instant purchases:", err);
    res.status(500).json({ message: "Error retrieving instant purchases" });
  } finally {
    connection.release();
  }
});

// ============================================================
// POST / - 바로 구매 실행 (1-step: 클릭 → API 호출 → 완료)
// ============================================================
router.post("/", async (req, res) => {
  const { itemId, aucNum } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !aucNum) {
    return res
      .status(400)
      .json({ message: "Item ID and auction number are required" });
  }

  // 현재 BrandAuc(2번)만 지원
  if (String(aucNum) !== "2") {
    return res
      .status(400)
      .json({ message: "바로 구매는 현재 BrandAuc(2번)만 지원합니다" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 아이템 정보 확인
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ? AND bid_type = 'instant'",
      [itemId, aucNum],
    );

    if (items.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "바로 구매 가능한 상품을 찾을 수 없습니다" });
    }

    const item = items[0];
    const purchasePrice = Number(item.starting_price);

    // 2. 이미 구매한 상품인지 확인
    const [existingPurchases] = await connection.query(
      "SELECT id FROM instant_purchases WHERE item_id = ? AND status IN ('pending', 'completed')",
      [itemId],
    );

    if (existingPurchases.length > 0) {
      await connection.rollback();
      return res.status(409).json({ message: "이미 구매 처리된 상품입니다" });
    }

    // 3. additional_info 파싱
    let additionalInfo = {};
    try {
      additionalInfo =
        typeof item.additional_info === "string"
          ? JSON.parse(item.additional_info)
          : item.additional_info || {};
    } catch (e) {
      console.warn("Failed to parse additional_info:", e.message);
    }

    const { invTorokuBng, lockVersion, genreCd } = additionalInfo;

    if (!invTorokuBng) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "구매에 필요한 정보가 부족합니다 (invTorokuBng)" });
    }

    // 4. 환율 조회
    const exchangeRate = await getExchangeRate();

    // 5. 차감액 계산
    const totalPrice = calculateTotalPrice(
      purchasePrice,
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
      deductAmount = totalPrice + platformFee;
    } else {
      deductAmount = totalPrice;
    }

    // 8. 예치금/한도 체크
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
          available,
        });
      }
    }

    // 9. instant_purchases 레코드 생성 (pending 상태)
    const [result] = await connection.query(
      `INSERT INTO instant_purchases 
       (user_id, item_id, purchase_price, status, shipping_status) 
       VALUES (?, ?, ?, 'pending', 'pending')`,
      [userId, itemId, purchasePrice],
    );

    const purchaseId = result.insertId;

    // 10. Commit (API 호출 전 DB 저장)
    await connection.commit();

    // 11. BrandAuc API 호출 - 바로 구매 실행
    const purchaseResult = await brandAucCrawler.instantBuy(
      invTorokuBng,
      lockVersion || 0,
      genreCd,
    );

    if (!purchaseResult || !purchaseResult.success) {
      // API 실패 시 구매 취소
      await pool.query(
        "UPDATE instant_purchases SET status = 'cancelled' WHERE id = ?",
        [purchaseId],
      );
      return res.status(409).json({
        message: "바로 구매에 실패했습니다. 이미 판매된 상품일 수 있습니다.",
        error: purchaseResult?.error || "Unknown error",
      });
    }

    // 12. API 성공 → 상태 업데이트 + 예치금/한도 차감
    const newConnection = await pool.getConnection();
    try {
      await newConnection.beginTransaction();

      // 구매 완료 상태로 업데이트
      await newConnection.query(
        `UPDATE instant_purchases 
         SET status = 'completed', 
             shipping_status = 'completed',
             completed_at = NOW(), 
             platform_response = ?
         WHERE id = ?`,
        [JSON.stringify(purchaseResult.data || {}), purchaseId],
      );

      // 예치금/한도 차감
      if (account.account_type === "individual") {
        await deductDeposit(
          newConnection,
          userId,
          deductAmount,
          "instant_purchase",
          purchaseId,
          `바로 구매 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      } else {
        await deductLimit(
          newConnection,
          userId,
          deductAmount,
          "instant_purchase",
          purchaseId,
          `바로 구매 차감 (환율: ${exchangeRate.toFixed(2)})`,
        );
      }

      // WMS 동기화
      try {
        await syncWmsByBidStatus(newConnection, {
          bidType: "instant",
          bidId: purchaseId,
          itemId: itemId,
          nextStatus: "completed",
        });
      } catch (wmsErr) {
        console.warn("[WMS sync][instant] warning:", wmsErr.message);
      }

      await newConnection.commit();
    } catch (err) {
      await newConnection.rollback();
      console.error("예치금 차감 실패 (바로 구매):", err);

      // 차감 실패 시에도 구매 자체는 경매장에서 완료됨 → 로그만 남기기
      await pool.query(
        "UPDATE instant_purchases SET platform_response = ? WHERE id = ?",
        [
          JSON.stringify({
            ...purchaseResult.data,
            deposit_error: err.message,
          }),
          purchaseId,
        ],
      );

      return res.status(500).json({
        message:
          "구매는 완료되었으나 예치금 차감에 실패했습니다. 관리자에게 문의해주세요.",
        purchaseId,
        error: err.message,
      });
    } finally {
      newConnection.release();
    }

    // 13. 정산 생성
    try {
      const settlementDate = new Date().toISOString().split("T")[0];
      await createOrUpdateSettlement(userId, settlementDate);

      if (account.account_type === "individual") {
        const settlementConn = await pool.getConnection();
        try {
          await adjustDepositBalance(settlementConn, userId, settlementDate);
          await settlementConn.query(
            `UPDATE daily_settlements 
             SET payment_status = 'paid', payment_method = 'deposit' 
             WHERE user_id = ? AND settlement_date = ?`,
            [userId, settlementDate],
          );
        } finally {
          settlementConn.release();
        }
      }
    } catch (settlementError) {
      console.error("[SETTLEMENT ERROR] instant purchase:", settlementError);
      // 정산 실패해도 구매 확정은 유지
    }

    res.status(201).json({
      message: "바로 구매가 성공적으로 완료되었습니다",
      purchaseId,
      status: "completed",
      purchasePrice,
      deductAmount,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error placing instant purchase:", err);
    res.status(500).json({ message: "Error placing instant purchase" });
  } finally {
    connection.release();
  }
});

// ============================================================
// PUT /cancel - 바로 구매 취소 (관리자)
// ============================================================
router.put("/cancel", isAdmin, async (req, res) => {
  const { id, ids } = req.body;

  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Purchase ID(s) are required" });
  }

  const purchaseIds = id ? [id] : ids;
  const placeholders = purchaseIds.map(() => "?").join(",");

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 취소할 구매 정보 조회
    const [purchases] = await connection.query(
      `SELECT p.id, p.user_id, p.status, p.purchase_price, p.completed_at
       FROM instant_purchases p
       WHERE p.id IN (${placeholders})`,
      purchaseIds,
    );

    if (purchases.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No purchases to cancel" });
    }

    // 2. 구매 취소 처리
    await connection.query(
      `UPDATE instant_purchases SET status = 'cancelled', shipping_status = 'pending' WHERE id IN (${placeholders})`,
      purchaseIds,
    );

    // 3. 예치금/한도 복구
    for (const purchase of purchases) {
      if (purchase.status === "cancelled") continue; // 이미 취소된 건 스킵

      const [accountRows] = await connection.query(
        "SELECT account_type FROM user_accounts WHERE user_id = ?",
        [purchase.user_id],
      );

      const deductAmount = await getBidDeductAmount(
        connection,
        purchase.id,
        "instant_purchase",
      );

      if (deductAmount > 0) {
        if (accountRows[0]?.account_type === "individual") {
          await refundDeposit(
            connection,
            purchase.user_id,
            deductAmount,
            "instant_purchase",
            purchase.id,
            "바로 구매 취소 환불",
          );
        } else {
          await refundLimit(
            connection,
            purchase.user_id,
            deductAmount,
            "instant_purchase",
            purchase.id,
            "바로 구매 취소 환불",
          );
        }
      }

      // 4. 정산 재계산
      if (purchase.completed_at) {
        try {
          const settlementDate = new Date(purchase.completed_at)
            .toISOString()
            .split("T")[0];
          await createOrUpdateSettlement(purchase.user_id, settlementDate);
        } catch (settlementError) {
          console.error(
            `[SETTLEMENT ERROR] cancel instant purchase user=${purchase.user_id}:`,
            settlementError,
          );
        }
      }
    }

    await connection.commit();

    res.status(200).json({
      message: `${purchases.length} purchase(s) cancelled`,
      cancelledCount: purchases.length,
    });
  } catch (err) {
    await connection.rollback();
    console.error("[CANCEL ERROR] instant purchase:", err);
    res.status(500).json({ message: "Error cancelling purchase(s)" });
  } finally {
    connection.release();
  }
});

// ============================================================
// PUT /shipping-status - 배송 상태 업데이트 (관리자)
// ============================================================
router.put("/shipping-status", isAdmin, async (req, res) => {
  const { id, ids, shippingStatus } = req.body;

  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Purchase ID(s) are required" });
  }

  if (!shippingStatus || !SHIPPING_STATUSES.has(shippingStatus)) {
    return res.status(400).json({
      message: `Invalid shipping status. Must be one of: ${[...SHIPPING_STATUSES].join(", ")}`,
    });
  }

  const purchaseIds = id ? [id] : ids;
  const placeholders = purchaseIds.map(() => "?").join(",");

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // completed 상태인 구매만 배송 상태 변경 가능
    const [result] = await connection.query(
      `UPDATE instant_purchases 
       SET shipping_status = ?, updated_at = NOW()
       WHERE id IN (${placeholders}) AND status = 'completed'`,
      [shippingStatus, ...purchaseIds],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "No completed purchases found to update",
      });
    }

    // WMS 동기화
    const [updatedPurchases] = await connection.query(
      `SELECT p.id, p.item_id FROM instant_purchases p WHERE p.id IN (${placeholders})`,
      purchaseIds,
    );

    for (const purchase of updatedPurchases) {
      try {
        await syncWmsByBidStatus(connection, {
          bidType: "instant",
          bidId: Number(purchase.id),
          itemId: purchase.item_id || null,
          nextStatus: shippingStatus,
        });
      } catch (wmsErr) {
        console.warn(
          "[WMS sync][instant] shipping update warning:",
          wmsErr.message,
        );
      }
    }

    await connection.commit();

    res.status(200).json({
      message: `${result.affectedRows} purchase(s) shipping status updated to ${shippingStatus}`,
      updatedCount: result.affectedRows,
    });
  } catch (err) {
    await connection.rollback();
    console.error("[SHIPPING STATUS ERROR] instant purchase:", err);
    res.status(500).json({ message: "Error updating shipping status" });
  } finally {
    connection.release();
  }
});

module.exports = router;
