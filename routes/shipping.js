// routes/shipping.js - 배송(출고) 관리 API
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { requireAdmin } = require("../utils/adminAuth");
const logen = require("../utils/logen");
const {
  generateShippingLabel,
  generateShippingLabelsA4,
} = require("../utils/shippingPdf");
const cron = require("node-cron");

const isAdmin = requireAdmin;

// ── 테이블 자동 생성 ────────────────────────────────

let tablesEnsured = false;

async function ensureTables() {
  if (tablesEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_companies (
      code VARCHAR(20) PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    INSERT IGNORE INTO courier_companies (code, name, sort_order) VALUES
    ('LOGEN', '로젠택배', 1),
    ('CJ', 'CJ대한통운', 2),
    ('HANJIN', '한진택배', 3),
    ('LOTTE', '롯데택배', 4),
    ('POST', '우체국택배', 5),
    ('ETC', '기타', 99)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      bid_type ENUM('live','direct','instant') NOT NULL,
      bid_id INT NOT NULL,
      wms_item_id INT DEFAULT NULL,
      user_id INT NOT NULL,
      logen_slip_no VARCHAR(11) DEFAULT NULL,
      logen_order_no VARCHAR(100) DEFAULT NULL,
      logen_bran_cd VARCHAR(4) DEFAULT NULL,
      logen_class_cd VARCHAR(10) DEFAULT NULL,
      logen_fare_ty VARCHAR(3) DEFAULT NULL,
      courier_code VARCHAR(20) NOT NULL DEFAULT 'LOGEN',
      tracking_number VARCHAR(50) DEFAULT NULL,
      receiver_name VARCHAR(100) NOT NULL,
      receiver_phone VARCHAR(20) NOT NULL,
      receiver_cell_phone VARCHAR(20) DEFAULT NULL,
      receiver_zipcode VARCHAR(10) DEFAULT NULL,
      receiver_address TEXT NOT NULL,
      receiver_address_detail VARCHAR(500) DEFAULT NULL,
      sender_name VARCHAR(100) DEFAULT NULL,
      sender_phone VARCHAR(20) DEFAULT NULL,
      sender_cell_phone VARCHAR(20) DEFAULT NULL,
      sender_address TEXT DEFAULT NULL,
      item_name VARCHAR(1000) DEFAULT NULL,
      item_count INT DEFAULT 1,
      goods_amount INT DEFAULT 0,
      is_jeju TINYINT(1) DEFAULT 0,
      is_island TINYINT(1) DEFAULT 0,
      is_mountain TINYINT(1) DEFAULT 0,
      dlv_fare INT DEFAULT 0,
      extra_fare INT DEFAULT 0,
      jeju_fare INT DEFAULT 0,
      island_fare INT DEFAULT 0,
      mountain_fare INT DEFAULT 0,
      total_fare INT DEFAULT 0,
      status ENUM('ready','slip_issued','order_registered','picked_up','in_transit','out_for_delivery','delivered','failed','returned') DEFAULT 'ready',
      tracking_data JSON DEFAULT NULL,
      tracking_last_status VARCHAR(100) DEFAULT NULL,
      last_tracked_at DATETIME DEFAULT NULL,
      delivered_at DATETIME DEFAULT NULL,
      logen_registered_at DATETIME DEFAULT NULL,
      logen_result_cd VARCHAR(20) DEFAULT NULL,
      logen_result_msg TEXT DEFAULT NULL,
      admin_memo TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_bid (bid_type, bid_id),
      INDEX idx_tracking (tracking_number),
      INDEX idx_slip (logen_slip_no),
      INDEX idx_status (status),
      INDEX idx_wms (wms_item_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tablesEnsured = true;
}

// ── 헬퍼 ────────────────────────────────────────────

function bidTable(bidType) {
  if (bidType === "direct") return "direct_bids";
  if (bidType === "instant") return "instant_purchases";
  return "live_bids";
}

const STATUS_LABELS = {
  ready: "출고준비",
  slip_issued: "송장채번",
  order_registered: "주문등록",
  picked_up: "집하",
  in_transit: "배송중",
  out_for_delivery: "배달중",
  delivered: "배달완료",
  failed: "배달실패",
  returned: "반송",
};

// =====================================================
// 관리자 API
// =====================================================

/**
 * GET /api/shipping/status
 * 로젠 API 설정 상태 확인
 */
router.get("/status", isAdmin, async (req, res) => {
  res.json({
    configured: logen.isConfigured(),
    isTest: (process.env.LOGEN_IS_TEST || "true") === "true",
    userId: logen.USER_ID ? logen.USER_ID.slice(0, 4) + "****" : null,
    custCd: logen.CUST_CD ? logen.CUST_CD.slice(0, 4) + "****" : null,
  });
});

/**
 * GET /api/shipping/couriers
 * 택배사 목록
 */
router.get("/couriers", async (req, res) => {
  await ensureTables();
  const [rows] = await pool.query(
    "SELECT * FROM courier_companies WHERE is_active = 1 ORDER BY sort_order",
  );
  res.json({ success: true, couriers: rows });
});

/**
 * GET /api/shipping/contract-info
 * 로젠 계약정보 조회 (관리자 확인용)
 */
router.get("/contract-info", isAdmin, async (req, res) => {
  try {
    if (!logen.isConfigured()) {
      return res
        .status(400)
        .json({ success: false, message: "로젠 API 미설정" });
    }
    const info = await logen.getContractInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    console.error("계약정보 조회 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/shipping/outbound-ready
 * 출고 대기 목록 (WMS 출고존 + 아직 shipment 미등록)
 */
router.get("/outbound-ready", isAdmin, async (req, res) => {
  await ensureTables();
  try {
    const [rows] = await pool.query(`
      SELECT
        w.id AS wms_item_id,
        w.source_bid_type AS bid_type,
        w.source_bid_id AS bid_id,
        w.source_item_id AS item_id,
        w.internal_barcode,
        w.member_name,
        w.current_status,
        w.current_location_code,
        w.request_type,
        w.metadata_text,
        CASE
          WHEN w.source_bid_type = 'direct' THEN d.user_id
          WHEN w.source_bid_type = 'instant' THEN ip.user_id
          ELSE l.user_id
        END AS user_id,
        CASE
          WHEN w.source_bid_type = 'direct' THEN du.address
          WHEN w.source_bid_type = 'instant' THEN iu.address
          ELSE lu.address
        END AS company_address,
        CASE
          WHEN w.source_bid_type = 'direct' THEN du.company_name
          WHEN w.source_bid_type = 'instant' THEN iu.company_name
          ELSE lu.company_name
        END AS company_name,
        CASE
          WHEN w.source_bid_type = 'direct' THEN du.phone
          WHEN w.source_bid_type = 'instant' THEN iu.phone
          ELSE lu.phone
        END AS phone,
        ci.title AS original_title,
        ci.brand,
        ci.category
      FROM wms_items w
      LEFT JOIN direct_bids d ON w.source_bid_type = 'direct' AND w.source_bid_id = d.id
      LEFT JOIN live_bids l ON w.source_bid_type = 'live' AND w.source_bid_id = l.id
      LEFT JOIN instant_purchases ip ON w.source_bid_type = 'instant' AND w.source_bid_id = ip.id
      LEFT JOIN users du ON d.user_id = du.id
      LEFT JOIN users lu ON l.user_id = lu.id
      LEFT JOIN users iu ON ip.user_id = iu.id
      LEFT JOIN crawled_items ci
        ON w.source_item_id COLLATE utf8mb4_unicode_ci = ci.item_id COLLATE utf8mb4_unicode_ci
      WHERE w.current_location_code = 'OUTBOUND_ZONE'
        AND w.current_status IN ('OUTBOUND_READY', 'SHIPPED')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s
          WHERE s.wms_item_id = w.id
            AND s.status NOT IN ('failed', 'returned')
        )
      ORDER BY w.updated_at DESC
    `);

    res.json({ success: true, items: rows });
  } catch (err) {
    console.error("출고 대기 목록 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/shipping/lookup-address
 * 주소 → 배송점코드/운임 정보 조회 (integratedInquiry)
 */
router.post("/lookup-address", isAdmin, async (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, message: "주소를 입력하세요" });
  }
  try {
    if (!logen.isConfigured()) {
      return res
        .status(400)
        .json({ success: false, message: "로젠 API 미설정" });
    }
    const info = await logen.getDeliveryInfo(address);
    res.json({ success: true, data: info });
  } catch (err) {
    console.error("주소 조회 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/shipping/register
 * 송장 등록 (채번 → 주소조회 → 운임조회 → 주문등록까지 원스텝)
 *
 * Body: {
 *   bid_type, bid_id, wms_item_id, user_id,
 *   receiver_name, receiver_phone, receiver_cell_phone,
 *   receiver_address, receiver_address_detail,
 *   item_name, goods_amount, admin_memo
 * }
 */
router.post("/register", isAdmin, async (req, res) => {
  await ensureTables();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const {
      bid_type,
      bid_id,
      wms_item_id,
      user_id,
      receiver_name,
      receiver_phone,
      receiver_cell_phone,
      receiver_address,
      receiver_address_detail,
      item_name,
      goods_amount,
      admin_memo,
    } = req.body;

    if (
      !bid_type ||
      !bid_id ||
      !receiver_name ||
      !receiver_phone ||
      !receiver_address
    ) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    // 중복 체크
    const [existing] = await conn.query(
      `SELECT id FROM shipments WHERE bid_type = ? AND bid_id = ? AND status NOT IN ('failed','returned') LIMIT 1`,
      [bid_type, bid_id],
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res
        .status(409)
        .json({
          success: false,
          message: "이미 등록된 송장이 있습니다.",
          shipment_id: existing[0].id,
        });
    }

    let slipNo = null;
    let branCd = null;
    let classCd = null;
    let fareTy = null;
    let dlvFare = 0;
    let extraFare = 0;
    let jejuFare = 0;
    let islandFare = 0;
    let mountainFare = 0;
    let isJeju = false;
    let isIsland = false;
    let isMountain = false;
    let logenRegisteredAt = null;
    let logenResultCd = null;
    let logenResultMsg = null;
    let status = "ready";
    let orderNo = `SH-${Date.now()}-${bid_type[0].toUpperCase()}${bid_id}`;

    if (logen.isConfigured()) {
      // Step 1: 주소 → 배송점코드
      try {
        const addrInfo = await logen.getDeliveryInfo(receiver_address);
        branCd = addrInfo.branCd;
        classCd = addrInfo.classCd;
        isJeju = addrInfo.jejuRegYn;
        isIsland = addrInfo.shipYn;
        isMountain = addrInfo.montYn;
      } catch (e) {
        console.error("주소 조회 실패:", e.message);
        // 실패해도 계속 진행 (수동 처리 가능)
      }

      // Step 2: 계약정보 → 운임타입
      try {
        const contract = await logen.getContractInfo();
        fareTy = contract.fareTy;
      } catch (e) {
        console.error("계약정보 조회 실패:", e.message);
        fareTy = "040"; // 본사신용 기본값
      }

      // Step 3: 운임 조회
      if (fareTy) {
        try {
          const fareInfo = await logen.getContractFares(fareTy);
          if (fareInfo.fares.length > 0) {
            dlvFare = fareInfo.fares[0].dlvFare;
          }
        } catch (e) {
          console.error("운임 조회 실패:", e.message);
        }
      }

      // Step 4: 송장번호 채번
      try {
        const slipResult = await logen.issueSlipNumbers(1);
        slipNo = slipResult.startSlipNo;
        if (slipNo) status = "slip_issued";
      } catch (e) {
        console.error("송장번호 채번 실패:", e.message);
      }

      // Step 5: 주문 등록
      if (slipNo && branCd) {
        try {
          const orderResult = await logen.registerOrder({
            slipNo,
            rcvBranCd: branCd,
            fareTy: fareTy || "040",
            rcvCustNm: receiver_name,
            rcvTelNo: receiver_phone,
            rcvCellNo: receiver_cell_phone || "",
            rcvCustAddr1: receiver_address,
            rcvCustAddr2: receiver_address_detail || "",
            goodsNm: item_name || "",
            dlvFare,
            extraFare: 0,
            goodsAmt: goods_amount || 0,
            fixTakeNo: orderNo,
            remarks: admin_memo || "",
            shipYn: isIsland ? "Y" : "N",
          });
          logenResultCd = orderResult.resultCd;
          logenResultMsg = orderResult.resultMsg;
          logenRegisteredAt = new Date();
          status = "order_registered";
        } catch (e) {
          console.error("로젠 주문 등록 실패:", e.message);
          logenResultMsg = e.message;
          // 채번은 됐으므로 slip_issued 유지
        }
      }
    }

    const totalFare =
      dlvFare + extraFare + jejuFare + islandFare + mountainFare;

    // DB 저장
    const [insertResult] = await conn.query(
      `INSERT INTO shipments (
        bid_type, bid_id, wms_item_id, user_id,
        logen_slip_no, logen_order_no, logen_bran_cd, logen_class_cd, logen_fare_ty,
        courier_code, tracking_number,
        receiver_name, receiver_phone, receiver_cell_phone, receiver_zipcode,
        receiver_address, receiver_address_detail,
        sender_name, sender_phone, sender_cell_phone, sender_address,
        item_name, goods_amount,
        is_jeju, is_island, is_mountain,
        dlv_fare, extra_fare, jeju_fare, island_fare, mountain_fare, total_fare,
        status,
        logen_registered_at, logen_result_cd, logen_result_msg,
        admin_memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOGEN', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bid_type,
        bid_id,
        wms_item_id || null,
        user_id,
        slipNo,
        orderNo,
        branCd,
        classCd,
        fareTy,
        slipNo, // tracking_number = slip_no
        receiver_name,
        receiver_phone,
        receiver_cell_phone || null,
        receiver_address,
        receiver_address_detail || null,
        logen.DEFAULT_SENDER.name,
        logen.DEFAULT_SENDER.tel,
        logen.DEFAULT_SENDER.cell,
        logen.DEFAULT_SENDER.address,
        item_name || null,
        goods_amount || 0,
        isJeju ? 1 : 0,
        isIsland ? 1 : 0,
        isMountain ? 1 : 0,
        dlvFare,
        extraFare,
        jejuFare,
        islandFare,
        mountainFare,
        totalFare,
        status,
        logenRegisteredAt,
        logenResultCd,
        logenResultMsg,
        admin_memo || null,
      ],
    );

    const shipmentId = insertResult.insertId;

    // bid 테이블 shipping_status 업데이트
    const bt = bidTable(bid_type);
    await conn.query(
      `UPDATE ${bt} SET shipping_status = 'shipped', updated_at = NOW() WHERE id = ? AND status = 'completed'`,
      [bid_id],
    );

    // WMS 상태도 SHIPPED로
    if (wms_item_id) {
      await conn.query(
        `UPDATE wms_items SET current_status = 'SHIPPED', updated_at = NOW() WHERE id = ?`,
        [wms_item_id],
      );
    }

    await conn.commit();

    res.json({
      success: true,
      shipment_id: shipmentId,
      slip_no: slipNo,
      status,
      logen_configured: logen.isConfigured(),
      message: logen.isConfigured()
        ? status === "order_registered"
          ? "로젠 주문 등록 완료"
          : "송장 채번 완료 (주문 등록은 수동 필요)"
        : "배송 정보 저장 완료 (로젠 API 미설정 - .env 설정 필요)",
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("송장 등록 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /api/shipping/list
 * 배송 목록 (관리자)
 */
router.get("/list", isAdmin, async (req, res) => {
  await ensureTables();
  const { status, search, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = "1=1";
  const params = [];

  if (status && status !== "all") {
    where += " AND s.status = ?";
    params.push(status);
  }
  if (search) {
    where +=
      " AND (s.tracking_number LIKE ? OR s.receiver_name LIKE ? OR s.item_name LIKE ? OR s.logen_order_no LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM shipments s WHERE ${where}`,
      params,
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT s.*,
        u.company_name,
        u.username
       FROM shipments s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset],
    );

    res.json({
      success: true,
      shipments: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error("배송 목록 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/shipping/:id
 * 배송 상세 (관리자)
 */
router.get("/:id(\\d+)", isAdmin, async (req, res) => {
  await ensureTables();
  try {
    const [rows] = await pool.query(
      `SELECT s.*, u.company_name, u.username
       FROM shipments s LEFT JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "배송 정보를 찾을 수 없습니다." });
    }
    res.json({ success: true, shipment: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/shipping/track/:id
 * 배송 추적 (로젠 API 실시간 호출) - 관리자
 */
router.get("/track/:id(\\d+)", isAdmin, async (req, res) => {
  await ensureTables();
  try {
    const [rows] = await pool.query("SELECT * FROM shipments WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "배송 정보 없음" });
    }

    const shipment = rows[0];
    const slipNo = shipment.logen_slip_no || shipment.tracking_number;

    if (!slipNo) {
      return res.json({
        success: true,
        shipment,
        tracking: null,
        message: "송장번호 없음",
      });
    }

    if (!logen.isConfigured()) {
      return res.json({
        success: true,
        shipment,
        tracking: shipment.tracking_data
          ? JSON.parse(shipment.tracking_data)
          : null,
        message: "로젠 API 미설정 - 캐시된 데이터 반환",
      });
    }

    const tracking = await logen.trackPackage(slipNo);

    // DB 업데이트
    const newStatus = tracking.isDelivered
      ? "delivered"
      : logen.mapLogenStatus(tracking.lastStatus);
    await pool.query(
      `UPDATE shipments SET
        tracking_data = ?, tracking_last_status = ?,
        last_tracked_at = NOW(), status = ?,
        delivered_at = IF(? = 'delivered' AND delivered_at IS NULL, NOW(), delivered_at),
        updated_at = NOW()
       WHERE id = ?`,
      [
        JSON.stringify(tracking),
        tracking.lastStatus,
        newStatus,
        newStatus,
        shipment.id,
      ],
    );

    // bid 테이블 동기화
    if (newStatus === "delivered") {
      const bt = bidTable(shipment.bid_type);
      await pool.query(
        `UPDATE ${bt} SET shipping_status = 'completed', updated_at = NOW() WHERE id = ?`,
        [shipment.bid_id],
      );
    }

    res.json({
      success: true,
      shipment: { ...shipment, status: newStatus },
      tracking,
    });
  } catch (err) {
    console.error("배송 추적 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/shipping/:id/memo
 * 관리자 메모 수정
 */
router.put("/:id(\\d+)/memo", isAdmin, async (req, res) => {
  const { memo } = req.body;
  try {
    await pool.query(
      "UPDATE shipments SET admin_memo = ?, updated_at = NOW() WHERE id = ?",
      [memo, req.params.id],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/shipping/refresh-all
 * 배송 상태 일괄 갱신 (미배달완료 건)
 */
router.post("/refresh-all", isAdmin, async (req, res) => {
  const result = await refreshShippingStatuses();
  res.json({ success: true, ...result });
});

// =====================================================
// 사용자 API
// =====================================================

/**
 * GET /api/shipping/my
 * 내 배송 목록
 */
router.get("/my", async (req, res) => {
  if (!req.session?.user) {
    return res
      .status(401)
      .json({ success: false, message: "로그인이 필요합니다." });
  }
  await ensureTables();
  const userId = req.session.user.id;

  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.bid_type, s.bid_id, s.courier_code, s.tracking_number,
        s.receiver_name, s.item_name, s.status, s.tracking_last_status,
        s.delivered_at, s.created_at, s.updated_at,
        cc.name AS courier_name
       FROM shipments s
       LEFT JOIN courier_companies cc ON s.courier_code = cc.code
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [userId],
    );

    res.json({ success: true, shipments: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/shipping/my/:id/track
 * 내 배송 추적 상세
 */
router.get("/my/:id(\\d+)/track", async (req, res) => {
  if (!req.session?.user) {
    return res
      .status(401)
      .json({ success: false, message: "로그인이 필요합니다." });
  }
  await ensureTables();
  const userId = req.session.user.id;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM shipments WHERE id = ? AND user_id = ?",
      [req.params.id, userId],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "배송 정보를 찾을 수 없습니다." });
    }

    const shipment = rows[0];
    const slipNo = shipment.logen_slip_no || shipment.tracking_number;
    let tracking = shipment.tracking_data
      ? JSON.parse(shipment.tracking_data)
      : null;

    // 배달완료가 아니고 로젠 설정되어 있으면 실시간 조회
    if (slipNo && logen.isConfigured() && shipment.status !== "delivered") {
      try {
        tracking = await logen.trackPackage(slipNo);
        const newStatus = tracking.isDelivered
          ? "delivered"
          : logen.mapLogenStatus(tracking.lastStatus);
        await pool.query(
          `UPDATE shipments SET tracking_data = ?, tracking_last_status = ?, last_tracked_at = NOW(), status = ?,
           delivered_at = IF(? = 'delivered' AND delivered_at IS NULL, NOW(), delivered_at), updated_at = NOW()
           WHERE id = ?`,
          [
            JSON.stringify(tracking),
            tracking.lastStatus,
            newStatus,
            newStatus,
            shipment.id,
          ],
        );
        shipment.status = newStatus;
        shipment.tracking_last_status = tracking.lastStatus;
      } catch (e) {
        console.error("사용자 배송 추적 에러:", e.message);
        // 캐시 데이터 반환
      }
    }

    res.json({
      success: true,
      shipment: {
        id: shipment.id,
        bid_type: shipment.bid_type,
        bid_id: shipment.bid_id,
        courier_code: shipment.courier_code,
        tracking_number: shipment.tracking_number,
        receiver_name: shipment.receiver_name,
        item_name: shipment.item_name,
        status: shipment.status,
        status_label: STATUS_LABELS[shipment.status] || shipment.status,
        delivered_at: shipment.delivered_at,
        created_at: shipment.created_at,
      },
      tracking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =====================================================
// Cron: 배송 상태 자동 갱신 (30분마다)
// =====================================================

async function refreshShippingStatuses() {
  if (!logen.isConfigured())
    return { skipped: true, reason: "로젠 API 미설정" };

  try {
    await ensureTables();
    // 미배달완료 건 중 송장번호 있는 것
    const [pending] = await pool.query(
      `SELECT id, logen_slip_no, bid_type, bid_id, status
       FROM shipments
       WHERE status NOT IN ('delivered','failed','returned','ready')
         AND logen_slip_no IS NOT NULL
       ORDER BY last_tracked_at ASC
       LIMIT 100`,
    );

    if (pending.length === 0) return { updated: 0, message: "갱신 대상 없음" };

    // 최종 화물추적 일괄 조회
    const slipNos = pending.map((p) => p.logen_slip_no);
    const trackResults = await logen.trackPackageLast(slipNos);

    let updated = 0;
    for (const tr of trackResults) {
      const shipment = pending.find((p) => p.logen_slip_no === tr.slipNo);
      if (!shipment) continue;

      const newStatus = tr.isDelivered
        ? "delivered"
        : logen.mapLogenStatus(tr.statusName);

      if (newStatus !== shipment.status) {
        await pool.query(
          `UPDATE shipments SET
            status = ?, tracking_last_status = ?, last_tracked_at = NOW(),
            delivered_at = IF(? = 'delivered' AND delivered_at IS NULL, NOW(), delivered_at),
            updated_at = NOW()
           WHERE id = ?`,
          [newStatus, tr.statusName, newStatus, shipment.id],
        );

        // 배달완료 시 bid 동기화
        if (newStatus === "delivered") {
          const bt = bidTable(shipment.bid_type);
          await pool.query(
            `UPDATE ${bt} SET shipping_status = 'completed', updated_at = NOW() WHERE id = ?`,
            [shipment.bid_id],
          );
        }
        updated++;
      }
    }

    return { updated, total: pending.length };
  } catch (err) {
    console.error("배송 상태 갱신 에러:", err.message);
    return { error: err.message };
  }
}

// =====================================================
// PDF 출력
// =====================================================

/**
 * GET /api/shipping/invoice-pdf/:id
 * 송장 라벨 PDF 다운로드 (1장)
 */
router.get("/invoice-pdf/:id(\\d+)", isAdmin, async (req, res) => {
  await ensureTables();
  try {
    const [rows] = await pool.query("SELECT * FROM shipments WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "배송 정보 없음" });
    }
    const pdfBuffer = await generateShippingLabel(rows[0]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="shipping-label-${rows[0].logen_slip_no || rows[0].id}.pdf"`,
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("송장 PDF 생성 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/shipping/invoice-pdf-bulk
 * 송장 라벨 일괄 PDF (A4, 6장/페이지)
 * Body: { ids: [1, 2, 3, ...] }
 */
router.post("/invoice-pdf-bulk", isAdmin, async (req, res) => {
  await ensureTables();
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "ids 필요" });
  }
  try {
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT * FROM shipments WHERE id IN (${placeholders}) ORDER BY FIELD(id, ${placeholders})`,
      [...ids, ...ids],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "배송 정보 없음" });
    }
    const pdfBuffer = await generateShippingLabelsA4(rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="shipping-labels-bulk.pdf"`,
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("일괄 송장 PDF 생성 에러:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 30분마다 자동 갱신
cron.schedule("*/30 * * * *", async () => {
  console.log("[Cron] 배송 상태 자동 갱신 시작...");
  const result = await refreshShippingStatuses();
  console.log("[Cron] 배송 상태 갱신 결과:", result);
});

module.exports = router;
