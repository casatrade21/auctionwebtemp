/**
 * routes/deposits.js — 예치금 관리 API
 *
 * 잔액 조회, 충전/차감/환불, 거래 내역 조회,
 * 오픈뱅킹 연동(충전), cron 기반 자동 처리.
 * 마운트: /api/deposits
 */
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const cron = require("node-cron");
const { isAdminUser } = require("../utils/adminAuth");

// 미들웨어
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

/**
 * POST /api/deposits/charge
 * 예치금 충전 신청 (개인 회원) -> [변경] 즉시 반영 X, Pending 상태 기록
 */
router.post("/charge", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { amount, depositorName } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Invalid amount" });
  }

  if (!depositorName || depositorName.trim() === "") {
    return res.status(400).json({ message: "입금자명을 입력해주세요." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 개인 회원 여부 확인
    const [accounts] = await connection.query(
      `SELECT account_type FROM user_accounts WHERE user_id = ?`,
      [userId],
    );

    if (accounts.length === 0 || accounts[0].account_type !== "individual") {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Only individual accounts can charge deposits" });
    }

    // 2. 거래 내역에 'pending' 상태로 기록 (잔액 변경 없음)
    const [result] = await connection.query(
      `INSERT INTO deposit_transactions 
      (user_id, type, amount, status, related_type, description, depositor_name, created_at)
      VALUES (?, 'charge', ?, 'pending', 'charge_request', ?, ?, NOW())`,
      [
        userId,
        amount,
        `충전 요청: ₩${amount.toLocaleString()}`,
        depositorName.trim(),
      ],
    );

    await connection.commit();

    res.status(200).json({
      message:
        "충전 요청이 접수되었습니다. 관리자 확인 후 예치금이 반영됩니다.",
      transactionId: result.insertId,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Charge request error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/deposits/refund
 * 예치금 환불 신청 (개인 회원) -> [변경] 즉시 차감(Holding), Pending 상태 기록
 */
router.post("/refund", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { amount, depositorName } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Invalid amount" });
  }

  if (!depositorName || depositorName.trim() === "") {
    return res
      .status(400)
      .json({ message: "입금자명(예금주명)을 입력해주세요." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 잔액 확인
    const [accounts] = await connection.query(
      `SELECT deposit_balance, account_type FROM user_accounts WHERE user_id = ? FOR UPDATE`,
      [userId],
    );

    if (accounts.length === 0 || accounts[0].account_type !== "individual") {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid account" });
    }

    if (accounts[0].deposit_balance < amount) {
      await connection.rollback();
      return res.status(400).json({ message: "잔액이 부족합니다." });
    }

    // 2. 예치금 선차감 (Holding)
    await connection.query(
      `UPDATE user_accounts SET deposit_balance = deposit_balance - ? WHERE user_id = ?`,
      [amount, userId],
    );

    // 3. 차감 후 잔액 조회
    const [updatedAccount] = await connection.query(
      `SELECT deposit_balance FROM user_accounts WHERE user_id = ?`,
      [userId],
    );
    const balanceAfter = updatedAccount[0].deposit_balance;

    // 4. 거래 내역에 'pending' 상태로 기록
    await connection.query(
      `INSERT INTO deposit_transactions 
      (user_id, type, amount, balance_after, status, related_type, description, depositor_name, created_at)
      VALUES (?, 'refund', ?, ?, 'pending', 'refund_request', ?, ?, NOW())`,
      [
        userId,
        amount,
        balanceAfter,
        `환불 요청(대기): ₩${amount.toLocaleString()}`,
        depositorName.trim(),
      ],
    );

    await connection.commit();

    res.status(200).json({
      message: "환불 요청이 접수되었습니다. (금액 홀딩됨)",
      balanceAfter,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Refund request error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/deposits/admin/approve/:id
 * 관리자: 충전/환불 승인
 * - 충전 승인 시 현금영수증 자동 발행
 */
router.post("/admin/approve/:id", isAdmin, async (req, res) => {
  const transactionId = req.params.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 트랜잭션 및 사용자 정보 조회 (pending 또는 manual_review 상태)
    const [txs] = await connection.query(
      `SELECT dt.*, u.email, u.phone, u.company_name
       FROM deposit_transactions dt
       JOIN users u ON dt.user_id = u.id
       WHERE dt.id = ? AND dt.status IN ('pending', 'manual_review')
       FOR UPDATE`,
      [transactionId],
    );

    if (txs.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "대기 중인 요청을 찾을 수 없습니다." });
    }

    const tx = txs[0];

    // 2. 유형별 처리
    if (tx.type === "charge") {
      // 충전 승인: 잔액 증가
      await connection.query(
        `UPDATE user_accounts SET deposit_balance = deposit_balance + ? WHERE user_id = ?`,
        [tx.amount, tx.user_id],
      );
    }
    // 환불 승인: 이미 선차감했으므로 잔액 변경 없음 (상태만 변경)

    // 3. 현재 잔액 조회 및 트랜잭션 업데이트
    const [account] = await connection.query(
      `SELECT deposit_balance FROM user_accounts WHERE user_id = ?`,
      [tx.user_id],
    );

    await connection.query(
      `UPDATE deposit_transactions 
       SET status = 'confirmed', balance_after = ?, processed_at = NOW() 
       WHERE id = ?`,
      [account[0].deposit_balance, transactionId],
    );

    await connection.commit();

    // 4. 충전 승인 시 현금영수증 자동 발행 (별도 처리)
    let documentIssueResult = null;
    if (tx.type === "charge") {
      try {
        const popbillService = require("../utils/popbill");

        // 이미 발행된 문서가 있는지 확인
        const [existingDocs] = await pool.query(
          "SELECT * FROM popbill_documents WHERE related_type = 'deposit' AND related_id = ? AND status = 'issued'",
          [transactionId],
        );

        if (existingDocs.length === 0) {
          console.log(
            `[자동 발행] 현금영수증 발행 시작 (예치금 거래 ID: ${transactionId})`,
          );

          const cashResult = await popbillService.issueCashbill(
            tx,
            {
              email: tx.email,
              phone: tx.phone,
              company_name: tx.company_name,
            },
            "예치금 충전",
          );

          // DB 저장
          await pool.query(
            `INSERT INTO popbill_documents 
             (type, mgt_key, related_type, related_id, user_id, confirm_num, amount, status, created_at) 
             VALUES ('cashbill', ?, 'deposit', ?, ?, ?, ?, 'issued', NOW())`,
            [
              cashResult.mgtKey,
              transactionId,
              tx.user_id,
              cashResult.confirmNum,
              tx.amount,
            ],
          );

          documentIssueResult = {
            type: "cashbill",
            status: "issued",
            confirmNum: cashResult.confirmNum,
            mgtKey: cashResult.mgtKey,
          };

          console.log(
            `✅ 현금영수증 자동 발행 완료 (승인번호: ${cashResult.confirmNum})`,
          );
        } else {
          console.log(
            `[자동 발행] 이미 발행된 문서 존재 (예치금 거래 ID: ${transactionId})`,
          );
          documentIssueResult = {
            status: "already_issued",
            existing: existingDocs[0],
          };
        }
      } catch (error) {
        // 발행 실패 시 DB에 실패 상태 기록
        console.error(
          `❌ 현금영수증 자동 발행 실패 (예치금 거래 ID: ${transactionId}):`,
          error.message,
        );

        const mgtKey = `CASHBILL-FAILED-${transactionId}-${Date.now()}`;

        try {
          await pool.query(
            `INSERT INTO popbill_documents 
             (type, mgt_key, related_type, related_id, user_id, amount, status, error_message, created_at) 
             VALUES ('cashbill', ?, 'deposit', ?, ?, ?, 'failed', ?, NOW())`,
            [mgtKey, transactionId, tx.user_id, tx.amount, error.message],
          );
        } catch (dbError) {
          console.error(
            `❌ 발행 실패 기록 저장 오류 (예치금 거래 ID: ${transactionId}):`,
            dbError.message,
          );
        }

        documentIssueResult = {
          type: "cashbill",
          status: "failed",
          error: error.message,
        };
      }
    }

    res.json({
      message: "승인 처리되었습니다.",
      document_issue: documentIssueResult,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Approve error:", err);
    res.status(500).json({ message: "Error approving transaction" });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/deposits/admin/reject/:id
 * 관리자: 충전/환불 거절
 */
router.post("/admin/reject/:id", isAdmin, async (req, res) => {
  const transactionId = req.params.id;
  const { reason } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [txs] = await connection.query(
      `SELECT * FROM deposit_transactions WHERE id = ? AND status IN ('pending', 'manual_review') FOR UPDATE`,
      [transactionId],
    );

    if (txs.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "대기 중인 요청을 찾을 수 없습니다." });
    }

    const tx = txs[0];

    // 유형별 처리
    if (tx.type === "charge") {
      // 충전 거절: 아무것도 안 함 (잔액 변경 없었음)
    } else if (tx.type === "refund") {
      // 환불 거절: 선차감했던 금액 원복
      await connection.query(
        `UPDATE user_accounts SET deposit_balance = deposit_balance + ? WHERE user_id = ?`,
        [tx.amount, tx.user_id],
      );
    }

    // 트랜잭션 상태 업데이트
    await connection.query(
      `UPDATE deposit_transactions 
       SET status = 'rejected', admin_memo = ?, processed_at = NOW() 
       WHERE id = ?`,
      [reason || "관리자 거절", transactionId],
    );

    await connection.commit();
    res.json({ message: "거절 처리되었습니다." });
  } catch (err) {
    await connection.rollback();
    console.error("Reject error:", err);
    res.status(500).json({ message: "Error rejecting transaction" });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/deposits/admin/transactions
 * 관리자: 모든 유저의 예치금 거래 내역 조회
 */
router.get("/admin/transactions", isAdmin, async (req, res) => {
  const { page = 1, limit = 20, status, keyword } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereConditions = [];
    let queryParams = [];

    // 상태 필터
    if (status) {
      whereConditions.push("dt.status = ?");
      queryParams.push(status);
    }

    // 키워드 검색 (유저ID)
    if (keyword) {
      whereConditions.push("dt.user_id LIKE ?");
      queryParams.push(`%${keyword}%`);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // 대기 중인 건수 조회
    const [pendingCount] = await pool.query(
      `SELECT COUNT(*) as count FROM deposit_transactions WHERE status = 'pending'`,
    );

    // 총 개수 조회
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM deposit_transactions dt ${whereClause}`,
      queryParams,
    );

    const total = countResult[0].total;

    // 거래 내역 조회 + 발행 정보 포함
    const [transactions] = await pool.query(
      `SELECT dt.id, dt.user_id, u.login_id, u.company_name, dt.type, dt.amount, dt.balance_after, dt.status, dt.admin_memo, 
              dt.related_type, dt.related_id, dt.bank_tran_id, dt.description, dt.depositor_name, dt.created_at, dt.processed_at,
              pd.id as doc_id, pd.type as doc_type, pd.status as doc_status, pd.confirm_num, pd.error_message
      FROM deposit_transactions dt
      LEFT JOIN users u ON dt.user_id = u.id
      LEFT JOIN popbill_documents pd ON pd.related_type = 'deposit' AND pd.related_id = dt.id
      ${whereClause}
      ORDER BY dt.created_at DESC
      LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset],
    );

    res.json({
      transactions,
      pagination: {
        currentPage: parseInt(page),
        limit: parseInt(limit),
        totalItems: total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      pendingCount: pendingCount[0].count,
    });
  } catch (err) {
    console.error("Admin transactions inquiry error:", err);
    res.status(500).json({
      message: "Failed to fetch transactions",
      error: err.message,
    });
  }
});

/**
 * GET /api/deposits/admin/settlements
 * 관리자: 모든 유저의 정산 내역 조회
 */
router.get("/admin/settlements", isAdmin, async (req, res) => {
  const { page = 1, limit = 20, status, keyword } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereConditions = [];
    let queryParams = [];

    // 🔧 상태 필터 - payment_status로 변경
    if (status) {
      whereConditions.push("ds.payment_status = ?");
      queryParams.push(status);
    }

    // 키워드 검색 (유저ID 또는 날짜)
    if (keyword) {
      whereConditions.push("(ds.user_id LIKE ? OR ds.settlement_date LIKE ?)");
      queryParams.push(`%${keyword}%`, `%${keyword}%`);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // 🔧 대기 중인 건수 조회 - payment_status로 변경
    const [pendingCount] = await pool.query(
      `SELECT COUNT(*) as count FROM daily_settlements WHERE payment_status = 'pending'`,
    );

    // 총 개수 조회
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM daily_settlements ds ${whereClause}`,
      queryParams,
    );

    const total = countResult[0].total;

    // 🔧 정산 내역 조회 - payment_status 추가 + 발행 정보 포함
    const [settlements] = await pool.query(
      `SELECT ds.id, ds.user_id, u.login_id, u.company_name, u.business_number, ds.settlement_date, ds.final_amount, ds.completed_amount, 
              ds.payment_status, ds.admin_memo, ds.created_at, ds.paid_at, ds.depositor_name,
              pd.id as doc_id, pd.type as doc_type, pd.status as doc_status, pd.confirm_num, pd.error_message
       FROM daily_settlements ds
       LEFT JOIN users u ON ds.user_id = u.id
       LEFT JOIN popbill_documents pd ON pd.related_type = 'settlement' AND pd.related_id = ds.id
       ${whereClause}
       ORDER BY ds.settlement_date DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset],
    );

    res.json({
      settlements,
      pagination: {
        currentPage: parseInt(page),
        limit: parseInt(limit),
        totalItems: total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      pendingCount: pendingCount[0].count,
    });
  } catch (err) {
    console.error("Admin settlements inquiry error:", err);
    res.status(500).json({
      message: "Failed to fetch settlements",
      error: err.message,
    });
  }
});

/**
 * GET /api/deposits/balance
 * 예치금/한도 잔액 조회
 */
router.get("/balance", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [accounts] = await pool.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used, limit_reset_date
      FROM user_accounts 
      WHERE user_id = ?`,
      [userId],
    );

    if (accounts.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const account = accounts[0];

    // 기업 회원의 경우 남은 한도 계산
    const remaining_limit =
      account.account_type === "corporate"
        ? account.daily_limit - account.daily_used
        : null;

    res.json({
      account_type: account.account_type,
      deposit_balance:
        account.account_type === "individual" ? account.deposit_balance : null,
      daily_limit:
        account.account_type === "corporate" ? account.daily_limit : null,
      daily_used:
        account.account_type === "corporate" ? account.daily_used : null,
      remaining_limit,
      limit_reset_date:
        account.account_type === "corporate" ? account.limit_reset_date : null,
    });
  } catch (err) {
    console.error("Balance inquiry error:", err);
    res.status(500).json({
      message: "Balance inquiry failed",
      error: err.message,
    });
  }
});

/**
 * GET /api/deposits/transactions
 * 예치금 거래 내역 조회
 */
router.get("/transactions", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { page = 1, limit = 20 } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // 총 개수 조회
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM deposit_transactions WHERE user_id = ?`,
      [userId],
    );

    const total = countResult[0].total;

    // 거래 내역 조회 (개발 문서: type, balance_after, related_type, related_id, bank_tran_id, status)
    const [transactions] = await pool.query(
      `SELECT id, type, amount, balance_after, status, admin_memo, 
              related_type, related_id, bank_tran_id, description, created_at
      FROM deposit_transactions 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), offset],
    );

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("Transaction history inquiry error:", err);
    res.status(500).json({
      message: "Transaction history inquiry failed",
      error: err.message,
    });
  }
});

/** * GET /api/deposits/admin/user/:userId
 * 특정 유저의 예치금/한도 정보 조회
 */
router.get(
  "/admin/user/:userId",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { userId } = req.params;

    try {
      const [accounts] = await pool.query(
        `SELECT account_type, deposit_balance, daily_limit, daily_used, limit_reset_date
       FROM user_accounts
       WHERE user_id = ?`,
        [userId],
      );

      if (accounts.length === 0) {
        // 계정이 없으면 기본값 반환
        return res.status(200).json({
          account_type: "individual",
          deposit_balance: 0,
          daily_limit: 0,
          daily_used: 0,
          limit_reset_date: null,
        });
      }

      res.status(200).json(accounts[0]);
    } catch (err) {
      console.error("Get user account error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

/** * PUT /api/deposits/admin/user-settings (Admin only)
 * 관리자: 유저 계정 타입 및 한도 설정
 */
router.put(
  "/admin/user-settings",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { user_id, account_type, daily_limit } = req.body;

    if (!user_id || !account_type) {
      return res
        .status(400)
        .json({ message: "User ID and account type are required" });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. user_accounts가 있는지 확인하고 없으면 생성 (방어 코드)
      const [check] = await connection.query(
        "SELECT user_id FROM user_accounts WHERE user_id = ?",
        [user_id],
      );

      if (check.length === 0) {
        // 계정이 없으면 기본값으로 생성
        await connection.query(
          "INSERT INTO user_accounts (user_id, account_type) VALUES (?, ?)",
          [user_id, account_type],
        );
      }

      // 2. 정보 업데이트
      // account_type 변경 및 daily_limit 변경 (corporate일 때만 limit 적용)
      let limitToSet = 0;
      if (account_type === "corporate") {
        limitToSet = daily_limit || 0;
      }

      await connection.query(
        `UPDATE user_accounts 
       SET account_type = ?,
           daily_limit = ?,
           updated_at = NOW()
       WHERE user_id = ?`,
        [account_type, limitToSet, user_id],
      );

      await connection.commit();

      console.log(
        `[Admin] Updated user ${user_id}: ${account_type}, Limit: ${limitToSet}`,
      );

      res.json({
        message: "User settings updated successfully",
        user_id,
        account_type,
        daily_limit: limitToSet,
      });
    } catch (err) {
      await connection.rollback();
      console.error("User settings update error:", err);
      res.status(500).json({ message: "Failed to update user settings" });
    } finally {
      connection.release();
    }
  },
);

/**
 * 기업 회원의 daily_used를 0으로 초기화하고 limit_reset_date 갱신
 */
async function resetCorporateDailyLimits() {
  const connection = await pool.getConnection();

  try {
    const today = new Date().toISOString().split("T")[0];

    const [result] = await connection.query(
      `UPDATE user_accounts 
       SET daily_used = 0, 
           limit_reset_date = ? 
       WHERE account_type = 'corporate'`,
      [today],
    );

    console.log(
      `[CRON] 기업 회원 한도 초기화 완료: ${result.affectedRows}개 계정 (${today})`,
    );
  } catch (err) {
    console.error("[CRON] 기업 회원 한도 초기화 실패:", err);
  } finally {
    connection.release();
  }
}

/**
 * 스케줄러 초기화
 * - 매일 자정(00:00)에 실행
 * - development 환경에서는 실행 안 함
 */
function initializeDailyLimitResetScheduler() {
  // 매일 자정(00:00)에 실행
  cron.schedule(
    "0 0 * * *",
    () => {
      console.log(
        "[CRON] 기업 회원 한도 초기화 시작:",
        new Date().toISOString(),
      );
      resetCorporateDailyLimits();
    },
    {
      timezone: "Asia/Seoul",
    },
  );

  console.log("[CRON] 기업 회원 한도 초기화 스케줄러 활성화 (매일 00:00 KST)");
}

// 스케줄러 시작
if (process.env.ENV !== "development") {
  initializeDailyLimitResetScheduler();
}

module.exports = router;
