// routes/appr/payments.js
const express = require("express");
const router = express.Router();
const { pool } = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const axios = require("axios"); // axios 추가 필요
const Buffer = require("buffer").Buffer;

// 나이스페이 설정
const NICEPAY_CLIENT_KEY = process.env.NICEPAY_CLIENT_KEY;
const NICEPAY_SECRET_KEY = process.env.NICEPAY_SECRET_KEY;
const NICEPAY_API_URL =
  process.env.NODE_ENV === "production"
    ? "https://api.nicepay.co.kr/v1/payments"
    : "https://sandbox-api.nicepay.co.kr/v1/payments";

// Basic 인증 헤더 생성 함수
function generateBasicAuthHeader() {
  const credentials = `${NICEPAY_CLIENT_KEY}:${NICEPAY_SECRET_KEY}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

// 결제 준비 - POST /api/appr/payments/prepare
router.post("/prepare", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const { product_type, product_name, amount, related_resource_id } =
      req.body;

    // 필수 필드 검증
    if (!product_type || !product_name || !amount) {
      return res.status(400).json({
        success: false,
        message: "필수 입력 항목이 누락되었습니다.",
      });
    }

    const user_id = req.session.user.id;
    // 주문 ID 생성 (나이스페이 가이드에 맞게 포맷 변경)
    const order_id = `ORDER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    conn = await pool.getConnection();

    // 결제 정보 저장
    const [insertResult] = await conn.query(
      `INSERT INTO payments (
        id, user_id, order_id, product_type, product_name, 
        amount, status, related_resource_id, related_resource_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        user_id,
        order_id,
        product_type,
        product_name,
        amount,
        "pending",
        related_resource_id || null,
        related_resource_id
          ? product_type === "restoration_service"
            ? "restoration"
            : "appraisal"
          : null,
      ]
    );

    // 나이스페이 SDK 파라미터 생성
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac("sha256", NICEPAY_SECRET_KEY)
      .update(order_id + amount + timestamp)
      .digest("hex");

    // 프론트엔드에서 사용할 반환 URL 설정
    const returnUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/appr/payment-callback`;

    const paramsForNicePaySDK = {
      clientId: NICEPAY_CLIENT_KEY,
      method: "card", // 기본 결제 수단
      orderId: order_id,
      amount: parseInt(amount),
      goodsName: product_name,
      returnUrl: returnUrl,
      timestamp: timestamp,
      signature: signature,
      // 필요에 따라 추가 파라미터 설정
    };

    res.json({
      success: true,
      order_id,
      paramsForNicePaySDK,
    });
  } catch (err) {
    console.error("결제 준비 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 준비 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 결제 승인 요청 - POST /api/appr/payments/approve
router.post("/approve", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const { orderId, authToken, amount } = req.body;

    if (!orderId || !authToken) {
      return res.status(400).json({
        success: false,
        message: "주문 번호와 인증 토큰이 누락되었습니다.",
      });
    }

    conn = await pool.getConnection();

    // 결제 정보 조회
    const [paymentRows] = await conn.query(
      "SELECT * FROM payments WHERE order_id = ? AND user_id = ?",
      [orderId, req.session.user.id]
    );

    if (paymentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 결제 정보를 찾을 수 없습니다.",
      });
    }

    const payment = paymentRows[0];

    if (payment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "이미 처리된 결제입니다.",
      });
    }

    // 나이스페이 결제 승인 API 호출
    try {
      const response = await axios.post(
        `${NICEPAY_API_URL}/${authToken}`,
        {
          amount: parseInt(payment.amount),
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: generateBasicAuthHeader(),
          },
        }
      );

      // 나이스페이 응답 처리
      if (response.data.resultCode === "0000") {
        // 결제 성공 처리
        const payMethod = response.data.payMethod || "CARD";
        const approveNo = response.data.approveNo || "";
        const tid = response.data.tid || "";
        const cardInfo = response.data.card
          ? JSON.stringify(response.data.card)
          : null;

        // 결제 상태 업데이트
        await conn.query(
          `UPDATE payments SET 
            status = ?, 
            payment_method = ?, 
            payment_gateway_transaction_id = ?,
            raw_response_data = ?,
            paid_at = NOW() 
          WHERE id = ?`,
          [
            "completed",
            payMethod,
            tid,
            JSON.stringify(response.data),
            payment.id,
          ]
        );

        // 관련 리소스 처리
        if (payment.product_type === "quicklink_subscription") {
          // 퀵링크 구독 처리
          await handleQuickLinkSubscription(conn, req.session.user.id);
        } else if (payment.related_resource_id) {
          if (payment.product_type === "certificate_issue") {
            // 감정서 발급 처리
            await handleCertificateIssue(conn, payment.related_resource_id);
          } else if (payment.product_type === "restoration_service") {
            // 복원 서비스 처리
            await handleRestorationService(conn, payment.related_resource_id);
          }
        }

        res.json({
          success: true,
          message: "결제가 성공적으로 처리되었습니다.",
          payment: {
            id: payment.id,
            order_id: payment.order_id,
            status: "completed",
            amount: payment.amount,
            paid_at: new Date(),
            receipt_url: response.data.receiptUrl || null,
            card_info: response.data.card || null,
          },
        });
      } else {
        // 결제 실패 처리
        await conn.query(
          "UPDATE payments SET status = ?, raw_response_data = ? WHERE id = ?",
          ["failed", JSON.stringify(response.data), payment.id]
        );

        res.status(400).json({
          success: false,
          message: `결제 승인 실패: ${
            response.data.resultMsg || "알 수 없는 오류"
          }`,
          errorCode: response.data.resultCode,
        });
      }
    } catch (error) {
      console.error("나이스페이 API 호출 중 오류:", error);

      // API 호출 실패 처리
      await conn.query(
        "UPDATE payments SET status = ?, raw_response_data = ? WHERE id = ?",
        [
          "approval_api_failed",
          JSON.stringify(error.response?.data || error.message),
          payment.id,
        ]
      );

      res.status(500).json({
        success: false,
        message: "결제 승인 API 호출 중 오류가 발생했습니다.",
      });
    }
  } catch (err) {
    console.error("결제 승인 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 승인 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 퀵링크 구독 처리 함수
async function handleQuickLinkSubscription(conn, userId) {
  // 사용자 크레딧 정보 조회
  const [userRows] = await conn.query(
    "SELECT * FROM appr_users WHERE user_id = ?",
    [userId]
  );

  if (userRows.length === 0) {
    // 새 사용자인 경우 등록
    await conn.query(
      `INSERT INTO appr_users (
        user_id, tier, quick_link_credits_remaining, quick_link_monthly_limit,
        quick_link_subscription_type, quick_link_subscription_expires_at, last_reset_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        "일반회원",
        10, // 기본 크레딧
        10, // 월 제한
        "paid",
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후
        new Date(),
      ]
    );
  } else {
    // 기존 사용자인 경우 업데이트
    const user = userRows[0];
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30일 후

    await conn.query(
      `UPDATE appr_users SET 
        quick_link_credits_remaining = ?,
        quick_link_monthly_limit = ?,
        quick_link_subscription_type = ?,
        quick_link_subscription_expires_at = ?,
        last_reset_date = ?
      WHERE user_id = ?`,
      [
        10, // 기본 크레딧으로 리셋
        10, // 월 제한
        "paid",
        newExpiry,
        new Date(),
        userId,
      ]
    );
  }
}

// 감정서 발급 처리 함수
async function handleCertificateIssue(conn, appraisalId) {
  // 감정 상태 업데이트
  await conn.query(
    "UPDATE appraisals SET credit_deducted = true WHERE id = ?",
    [appraisalId]
  );
}

// 복원 서비스 처리 함수
async function handleRestorationService(conn, restorationId) {
  // 복원 상태 업데이트
  await conn.query(
    "UPDATE restoration_requests SET status = 'in_progress' WHERE id = ?",
    [restorationId]
  );
}

// 결제 정보 조회 - GET /api/appr/payments/:orderId
router.get("/:orderId", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const orderId = req.params.orderId;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      "SELECT * FROM payments WHERE order_id = ? AND user_id = ?",
      [orderId, req.session.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 결제 정보를 찾을 수 없습니다.",
      });
    }

    // raw_response_data가 있으면 JSON 파싱
    const payment = rows[0];
    if (payment.raw_response_data) {
      try {
        payment.raw_response_data = JSON.parse(payment.raw_response_data);
      } catch (error) {
        console.error("결제 응답 데이터 파싱 오류:", error);
      }
    }

    res.json({
      success: true,
      payment: payment,
    });
  } catch (err) {
    console.error("결제 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 결제 웹훅 처리 - POST /api/appr/payments/webhook
router.post("/webhook", async (req, res) => {
  let conn;
  try {
    // 나이스페이 웹훅 데이터
    const {
      resultCode,
      resultMsg,
      tid,
      orderId,
      ediDate,
      signature,
      status,
      paidAt,
      payMethod,
      amount,
      goodsName,
      receiptUrl,
      card,
    } = req.body;

    if (!orderId || !tid || !resultCode) {
      return res.status(400).send("Bad Request: Missing required parameters");
    }

    conn = await pool.getConnection();

    // 결제 정보 조회
    const [rows] = await conn.query(
      "SELECT * FROM payments WHERE order_id = ?",
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).send("Not Found: Order not found");
    }

    const payment = rows[0];

    // 웹훅 서명 검증 (필요 시)
    // Note: 실제 구현 시 나이스페이 문서에 따라 signature 검증 로직 추가 필요

    // 금액 검증
    if (parseFloat(payment.amount) !== parseFloat(amount)) {
      await conn.query(
        "UPDATE payments SET status = ?, raw_response_data = ? WHERE id = ?",
        ["auth_signature_mismatch", JSON.stringify(req.body), payment.id]
      );
      return res.status(400).send("Amount Mismatch");
    }

    // 결제 상태 업데이트
    let newStatus;
    if (status === "paid" && resultCode === "0000") {
      newStatus = "completed";
    } else if (status === "ready" && resultCode === "0000") {
      newStatus = "ready"; // 가상계좌 발급 상태
    } else if (status === "vbankReady") {
      newStatus = "vbank_ready";
    } else if (status === "vbankExpired") {
      newStatus = "vbank_expired";
    } else if (status === "canceled") {
      newStatus = "cancelled";
    } else {
      newStatus = "failed";
    }

    // 웹훅 데이터 저장
    await conn.query(
      `UPDATE payments SET 
        status = ?, 
        payment_gateway_transaction_id = ?, 
        raw_response_data = ?,
        payment_method = ?,
        card_info = ?,
        receipt_url = ?,
        paid_at = ?
      WHERE id = ?`,
      [
        newStatus,
        tid,
        JSON.stringify(req.body),
        payMethod || payment.payment_method,
        card ? JSON.stringify(card) : null,
        receiptUrl || null,
        paidAt || null,
        payment.id,
      ]
    );

    // 관련 리소스 처리 (성공인 경우)
    if (newStatus === "completed") {
      if (payment.product_type === "quicklink_subscription") {
        await handleQuickLinkSubscription(conn, payment.user_id);
      } else if (payment.related_resource_id) {
        if (payment.product_type === "certificate_issue") {
          await handleCertificateIssue(conn, payment.related_resource_id);
        } else if (payment.product_type === "restoration_service") {
          await handleRestorationService(conn, payment.related_resource_id);
        }
      }
    }

    // 200 응답 (나이스페이 웹훅은 200 OK 응답을 기대)
    res.status(200).send("OK");
  } catch (err) {
    console.error("결제 웹훅 처리 중 오류 발생:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (conn) conn.release();
  }
});

// 결제 내역 조회 - GET /api/appr/payments/history
router.get("/history", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const type = req.query.type;

    conn = await pool.getConnection();

    // 기본 쿼리
    let query = `
      SELECT 
        id, order_id, product_type, product_name, amount, 
        status, payment_method, paid_at, receipt_url
      FROM payments 
      WHERE user_id = ?
    `;

    const queryParams = [user_id];

    // 상품 유형 필터 적용
    if (type) {
      query += " AND product_type = ?";
      queryParams.push(type);
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(limit, offset);

    // 쿼리 실행
    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = "SELECT COUNT(*) as total FROM payments WHERE user_id = ?";
    const countParams = [user_id];

    if (type) {
      countQuery += " AND product_type = ?";
      countParams.push(type);
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    // 결과 반환
    res.json({
      success: true,
      payments: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        limit,
      },
    });
  } catch (err) {
    console.error("결제 내역 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 내역 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
