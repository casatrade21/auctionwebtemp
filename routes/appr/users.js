// routes/appr/users.js
const express = require("express");
const router = express.Router();
const { pool } = require("../../utils/DB");
const { isAuthenticated } = require("../../utils/middleware");

// 회원 프로필 및 멤버십 정보 조회 - GET /api/appr/users/profile
router.get("/profile", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;

    conn = await pool.getConnection();

    // 사용자 기본 정보 조회
    const [userRows] = await conn.query(
      "SELECT id, email, company_name, phone, address, created_at FROM users WHERE id = ?",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
      });
    }

    // 멤버십 정보 조회
    const [membershipRows] = await conn.query(
      `SELECT 
        tier, quick_link_credits_remaining, quick_link_monthly_limit,
        quick_link_subscription_type, quick_link_subscription_expires_at,
        offline_appraisal_fee, last_reset_date
      FROM appr_users WHERE user_id = ?`,
      [user_id]
    );

    // 사용자가 멤버십 정보가 없는 경우 기본값 설정
    const membership =
      membershipRows.length > 0
        ? membershipRows[0]
        : {
            tier: "일반회원",
            quick_link_credits_remaining: 0,
            quick_link_monthly_limit: 0,
            quick_link_subscription_type: "free",
            quick_link_subscription_expires_at: null,
            offline_appraisal_fee: 38000,
            last_reset_date: null,
          };

    res.json({
      success: true,
      user_profile: userRows[0],
      membership,
    });
  } catch (err) {
    console.error("회원 프로필 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "회원 프로필 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 구독 정보 조회 - GET /api/appr/users/subscription
router.get("/subscription", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT 
        tier, quick_link_credits_remaining as credits_remaining,
        quick_link_monthly_limit as monthly_limit,
        quick_link_subscription_type as type,
        quick_link_subscription_expires_at as expires_at
      FROM appr_users WHERE user_id = ?`,
      [user_id]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        subscription: {
          is_subscribed: false,
          type: "free",
          tier: "일반회원",
          credits_remaining: 0,
          monthly_limit: 0,
          expires_at: null,
          auto_renew: false,
        },
      });
    }

    const subscription = rows[0];
    const is_subscribed =
      subscription.type === "paid" &&
      subscription.expires_at &&
      new Date(subscription.expires_at) > new Date();

    res.json({
      success: true,
      subscription: {
        is_subscribed,
        type: subscription.type,
        tier: subscription.tier,
        credits_remaining: subscription.credits_remaining,
        monthly_limit: subscription.monthly_limit,
        expires_at: subscription.expires_at,
        auto_renew: false, // 자동 갱신 기능은 추가 구현 필요
      },
    });
  } catch (err) {
    console.error("구독 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "구독 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 구독 신청/갱신 - POST /api/appr/users/subscription
router.post("/subscription", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const { subscription_type } = req.body;

    if (!subscription_type || !["monthly"].includes(subscription_type)) {
      return res.status(400).json({
        success: false,
        message: "유효하지 않은 구독 유형입니다.",
      });
    }

    // 가격 설정 (상수 또는 설정 파일에서 관리하는 것이 좋음)
    const productPrice = 29000; // 월간 구독 가격 (원)

    res.json({
      success: true,
      payment_required: true,
      payment_info: {
        product_type: "quicklink_subscription",
        product_name: "퀵링크 월간 구독 (10회)",
        amount: productPrice,
        redirect_url: "/api/appr/payments/prepare",
      },
    });
  } catch (err) {
    console.error("구독 신청 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "구독 신청 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
