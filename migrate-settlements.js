/**
 * migrate-settlements.js — 정산 데이터 마이그레이션
 *
 * 고정 환율(9.628)로 기존 낙찰 데이터의 정산을 일괄 생성/재계산.
 * 실행: node migrate-settlements.js
 */
const { pool } = require("./utils/DB");
const { calculateFee, calculateTotalPrice } = require("./utils/calculate-fee");

// ??고정 ?�율 (마이그레?�션??
const MIGRATION_EXCHANGE_RATE = 9.628;

/**
 * ?�용???�수료율 가?�오�?
 */
async function getUserCommissionRate(connection, userId) {
  try {
    const [users] = await connection.query(
      "SELECT commission_rate FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0 && users[0].commission_rate !== null) {
      return users[0].commission_rate;
    }

    return null; // 기본 ?�수료율 ?�용
  } catch (error) {
    console.error(`?�용???�수료율 조회 ?�패 (${userId}):`, error.message);
    return null;
  }
}

/**
 * ?�정 ?�짜???�산 ?�성 (마이그레?�션??
 */
async function createSettlementForDate(connection, userId, date, exchangeRate) {
  try {
    // 1. ?�용???�수료율 가?�오�?
    const userCommissionRate = await getUserCommissionRate(connection, userId);

    // 2. ?�당 ?�짜???�찰 ?�공 ?�이??조회 (live_bids)
    const [liveBids] = await connection.query(
      `SELECT l.winning_price, l.appr_id, i.auc_num, i.category
       FROM live_bids l
       LEFT JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND l.status = 'completed'
         AND l.winning_price > 0
         AND l.final_price >= l.winning_price`,
      [userId, date]
    );

    // 3. ?�당 ?�짜???�찰 ?�공 ?�이??조회 (direct_bids)
    const [directBids] = await connection.query(
      `SELECT d.winning_price, d.appr_id, i.auc_num, i.category
       FROM direct_bids d
       LEFT JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND d.status = 'completed'
         AND d.winning_price > 0
         AND d.current_price >= d.winning_price`,
      [userId, date]
    );

    const items = [...liveBids, ...directBids];

    if (items.length === 0) {
      console.log(`  ?�️  ${userId} - ${date}: ?�찰 ?�이???�음 (?�킵)`);
      return { skipped: true };
    }

    // 4. 총액 계산
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // 관부가???�함 ?�화 가�?계산
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate
      );
      totalAmount += koreanPrice;

      // 감정??개수
      if (item.appr_id) {
        appraisalCount++;
      }
    });

    // 5. ?�수�?계산
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. 감정???�수�?
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. 최종 금액
    const finalAmount = totalAmount + feeAmount + appraisalFee;

    // 8. ?�산 ?�??
    await connection.query(
      `INSERT INTO daily_settlements 
       (user_id, settlement_date, item_count, total_japanese_yen, 
        total_amount, fee_amount, vat_amount, 
        appraisal_fee, appraisal_vat, appraisal_count,
        final_amount, exchange_rate, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         item_count = VALUES(item_count),
         total_japanese_yen = VALUES(total_japanese_yen),
         total_amount = VALUES(total_amount),
         fee_amount = VALUES(fee_amount),
         vat_amount = VALUES(vat_amount),
         appraisal_fee = VALUES(appraisal_fee),
         appraisal_vat = VALUES(appraisal_vat),
         appraisal_count = VALUES(appraisal_count),
         final_amount = VALUES(final_amount),
         exchange_rate = VALUES(exchange_rate)`,
      [
        userId,
        date,
        items.length,
        totalJapaneseYen,
        totalAmount,
        feeAmount,
        vatAmount,
        appraisalFee,
        appraisalVat,
        appraisalCount,
        finalAmount,
        exchangeRate,
      ]
    );

    return {
      success: true,
      itemCount: items.length,
      totalJapaneseYen,
      finalAmount,
    };
  } catch (error) {
    console.error(`  ??${userId} - ${date}: ?�산 ?�성 ?�패`, error.message);
    throw error;
  }
}

/**
 * 기존 ?�이??마이그레?�션
 */
async function migrateExistingData() {
  const connection = await pool.getConnection();

  try {
    console.log("=".repeat(60));
    console.log("?�� 기존 ?�찰 ?�이??마이그레?�션 ?�작");
    console.log("=".repeat(60));
    console.log(`?�율: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("");

    // 1. 기존 ?�찰 ?�이?�에???��?�? ?�짜�?조회
    console.log("?�� 마이그레?�션 ?�??조회 �?..");
    const [settlements] = await connection.query(`
      SELECT DISTINCT 
        user_id, 
        DATE(i.scheduled_date) as settlement_date
      FROM (
        SELECT user_id, item_id, status, winning_price, final_price
        FROM live_bids 
        WHERE status = 'completed' 
          AND winning_price > 0
        UNION
        SELECT user_id, item_id, status, winning_price, current_price as final_price
        FROM direct_bids 
        WHERE status = 'completed' 
          AND winning_price > 0
      ) as bids
      LEFT JOIN crawled_items i ON bids.item_id = i.item_id
      WHERE i.scheduled_date IS NOT NULL
        AND (
          (bids.final_price >= bids.winning_price) OR
          (bids.final_price IS NULL AND bids.winning_price > 0)
        )
      ORDER BY settlement_date ASC, user_id ASC
    `);

    console.log(`??�?${settlements.length}개의 ?�산 ?�성 ?�정\n`);

    if (settlements.length === 0) {
      console.log("?�️  마이그레?�션???�이?��? ?�습?�다.");
      return;
    }

    // 2. �??�산???�??처리
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let totalJapaneseYen = 0;
    let totalFinalAmount = 0;

    console.log("?�� 마이그레?�션 진행 �?..\n");

    for (let i = 0; i < settlements.length; i++) {
      const settlement = settlements[i];
      const progress = `[${i + 1}/${settlements.length}]`;

      try {
        const result = await createSettlementForDate(
          connection,
          settlement.user_id,
          settlement.settlement_date,
          MIGRATION_EXCHANGE_RATE
        );

        if (result.skipped) {
          skipCount++;
        } else if (result.success) {
          successCount++;
          totalJapaneseYen += result.totalJapaneseYen;
          totalFinalAmount += result.finalAmount;

          console.log(
            `${progress} ??${settlement.user_id} - ${settlement.settlement_date} | ` +
              `?�이?? ${result.itemCount}�?| ` +
              `¥${formatNumber(result.totalJapaneseYen)} ??` +
              `??{formatNumber(result.finalAmount)}`
          );
        }

        // 진행�??�시 (10개마??
        if ((i + 1) % 10 === 0) {
          console.log(
            `\n?�� 진행�? ${i + 1}/${settlements.length} (${Math.round(
              ((i + 1) / settlements.length) * 100
            )}%)\n`
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `${progress} ??${settlement.user_id} - ${settlement.settlement_date}: ${error.message}`
        );
      }
    }

    // 3. 결과 ?�약
    console.log("\n" + "=".repeat(60));
    console.log("?�� 마이그레?�션 ?�료");
    console.log("=".repeat(60));
    console.log(`???�공: ${successCount}�?);
    console.log(`?�️  ?�킵: ${skipCount}�?(?�찰 ?�이???�음)`);
    console.log(`???�패: ${errorCount}�?);
    console.log("");
    console.log(`?�� �??�본 ?�화: ¥${formatNumber(totalJapaneseYen)}`);
    console.log(`?�� �?최종 금액: ??{formatNumber(totalFinalAmount)}`);
    console.log(`?�� ?�율: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("=".repeat(60));

    // 4. 검�?
    console.log("\n?�� 검�?�?..");
    const [verifyResult] = await connection.query(`
      SELECT 
        COUNT(*) as count,
        SUM(item_count) as total_items,
        SUM(total_japanese_yen) as total_jpy,
        SUM(final_amount) as total_krw
      FROM daily_settlements
    `);

    console.log(`\n?�� DB ?�??결과:`);
    console.log(`   ?�산 ?�코?? ${verifyResult[0].count}�?);
    console.log(`   �??�이?? ${verifyResult[0].total_items}�?);
    console.log(`   �??�본 ?�화: ¥${formatNumber(verifyResult[0].total_jpy)}`);
    console.log(`   �?최종 금액: ??{formatNumber(verifyResult[0].total_krw)}`);
  } catch (error) {
    console.error("\n??마이그레?�션 �?치명???�류 발생:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * ?�자 ?�맷??(�??�위 콤마)
 */
function formatNumber(num) {
  if (num === null || num === undefined) return "0";
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * ?�행
 */
async function main() {
  try {
    console.log("\n");
    await migrateExistingData();
    console.log("\n??마이그레?�션 ?�공\n");
    process.exit(0);
  } catch (error) {
    console.error("\n??마이그레?�션 ?�패:", error);
    process.exit(1);
  }
}

// ?�크립트 직접 ?�행 ??
if (require.main === module) {
  main();
}

module.exports = { migrateExistingData };
