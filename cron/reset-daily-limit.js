/**
 * cron/reset-daily-limit.js — 기업 회원 일일 한도 초기화
 *
 * 매일 자정 cron으로 corporate 계정의 daily_used를 0으로 리셋.
 * server.js에서 cron.schedule('0 0 * * *', resetDailyLimits) 로 등록.
 */
const { pool } = require("../utils/DB");

async function resetDailyLimits() {
  console.log("[Cron] Starting daily limit reset job...");

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 법인 회원의 daily_used를 0으로 리셋 (개발 문서 기준)
    const [result] = await connection.query(
      `UPDATE user_accounts 
      SET daily_used = 0,
          limit_reset_date = CURDATE(),
          updated_at = NOW()
      WHERE account_type = 'corporate'`,
    );

    await connection.commit();

    console.log(
      `[Cron] Daily limits reset completed. ${result.affectedRows} corporate accounts updated.`,
    );
  } catch (err) {
    await connection.rollback();
    console.error("[Cron] Error resetting daily limits:", err);
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  resetDailyLimits().then(() => {
    console.log("Daily limit reset job finished.");
    process.exit(0);
  });
}

module.exports = { resetDailyLimits };
