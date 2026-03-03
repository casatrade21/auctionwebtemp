// cron/reset-daily-limit.js
const { pool } = require("../utils/DB");

/**
 * 매일 자정에 법인 회원의 일일 한도를 초기화하는 함수 (개발 문서 기준)
 *
 * 사용법:
 * 1. node-cron 패키지 설치: npm install node-cron
 * 2. server.js에 다음 코드 추가:
 *    const cron = require('node-cron');
 *    const { resetDailyLimits } = require('./cron/reset-daily-limit');
 *    cron.schedule('0 0 * * *', resetDailyLimits);
 */
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
