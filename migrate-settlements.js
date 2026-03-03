// scripts/migrate-settlements.js
const { pool } = require("./utils/DB");
const { calculateFee, calculateTotalPrice } = require("./utils/calculate-fee");

// ??ê³ ì • ?˜ìœ¨ (ë§ˆì´ê·¸ë ˆ?´ì…˜??
const MIGRATION_EXCHANGE_RATE = 9.628;

/**
 * ?¬ìš©???˜ìˆ˜ë£Œìœ¨ ê°€?¸ì˜¤ê¸?
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

    return null; // ê¸°ë³¸ ?˜ìˆ˜ë£Œìœ¨ ?¬ìš©
  } catch (error) {
    console.error(`?¬ìš©???˜ìˆ˜ë£Œìœ¨ ì¡°íšŒ ?¤íŒ¨ (${userId}):`, error.message);
    return null;
  }
}

/**
 * ?¹ì • ? ì§œ???•ì‚° ?ì„± (ë§ˆì´ê·¸ë ˆ?´ì…˜??
 */
async function createSettlementForDate(connection, userId, date, exchangeRate) {
  try {
    // 1. ?¬ìš©???˜ìˆ˜ë£Œìœ¨ ê°€?¸ì˜¤ê¸?
    const userCommissionRate = await getUserCommissionRate(connection, userId);

    // 2. ?´ë‹¹ ? ì§œ???™ì°° ?±ê³µ ?„ì´??ì¡°íšŒ (live_bids)
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

    // 3. ?´ë‹¹ ? ì§œ???™ì°° ?±ê³µ ?„ì´??ì¡°íšŒ (direct_bids)
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
      console.log(`  ? ï¸  ${userId} - ${date}: ?™ì°° ?„ì´???†ìŒ (?¤í‚µ)`);
      return { skipped: true };
    }

    // 4. ì´ì•¡ ê³„ì‚°
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // ê´€ë¶€ê°€???¬í•¨ ?í™” ê°€ê²?ê³„ì‚°
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate
      );
      totalAmount += koreanPrice;

      // ê°ì •??ê°œìˆ˜
      if (item.appr_id) {
        appraisalCount++;
      }
    });

    // 5. ?˜ìˆ˜ë£?ê³„ì‚°
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. ê°ì •???˜ìˆ˜ë£?
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. ìµœì¢… ê¸ˆì•¡
    const finalAmount = totalAmount + feeAmount + appraisalFee;

    // 8. ?•ì‚° ?€??
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
    console.error(`  ??${userId} - ${date}: ?•ì‚° ?ì„± ?¤íŒ¨`, error.message);
    throw error;
  }
}

/**
 * ê¸°ì¡´ ?°ì´??ë§ˆì´ê·¸ë ˆ?´ì…˜
 */
async function migrateExistingData() {
  const connection = await pool.getConnection();

  try {
    console.log("=".repeat(60));
    console.log("?“¦ ê¸°ì¡´ ?™ì°° ?°ì´??ë§ˆì´ê·¸ë ˆ?´ì…˜ ?œì‘");
    console.log("=".repeat(60));
    console.log(`?˜ìœ¨: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("");

    // 1. ê¸°ì¡´ ?™ì°° ?°ì´?°ì—??? ì?ë³? ? ì§œë³?ì¡°íšŒ
    console.log("?“Š ë§ˆì´ê·¸ë ˆ?´ì…˜ ?€??ì¡°íšŒ ì¤?..");
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

    console.log(`??ì´?${settlements.length}ê°œì˜ ?•ì‚° ?ì„± ?ˆì •\n`);

    if (settlements.length === 0) {
      console.log("? ï¸  ë§ˆì´ê·¸ë ˆ?´ì…˜???°ì´?°ê? ?†ìŠµ?ˆë‹¤.");
      return;
    }

    // 2. ê°??•ì‚°???€??ì²˜ë¦¬
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let totalJapaneseYen = 0;
    let totalFinalAmount = 0;

    console.log("?”„ ë§ˆì´ê·¸ë ˆ?´ì…˜ ì§„í–‰ ì¤?..\n");

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
              `?„ì´?? ${result.itemCount}ê°?| ` +
              `Â¥${formatNumber(result.totalJapaneseYen)} ??` +
              `??{formatNumber(result.finalAmount)}`
          );
        }

        // ì§„í–‰ë¥??œì‹œ (10ê°œë§ˆ??
        if ((i + 1) % 10 === 0) {
          console.log(
            `\n?“ˆ ì§„í–‰ë¥? ${i + 1}/${settlements.length} (${Math.round(
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

    // 3. ê²°ê³¼ ?”ì•½
    console.log("\n" + "=".repeat(60));
    console.log("?“Š ë§ˆì´ê·¸ë ˆ?´ì…˜ ?„ë£Œ");
    console.log("=".repeat(60));
    console.log(`???±ê³µ: ${successCount}ê°?);
    console.log(`? ï¸  ?¤í‚µ: ${skipCount}ê°?(?™ì°° ?„ì´???†ìŒ)`);
    console.log(`???¤íŒ¨: ${errorCount}ê°?);
    console.log("");
    console.log(`?’´ ì´??¼ë³¸ ?”í™”: Â¥${formatNumber(totalJapaneseYen)}`);
    console.log(`?’° ì´?ìµœì¢… ê¸ˆì•¡: ??{formatNumber(totalFinalAmount)}`);
    console.log(`?“ˆ ?˜ìœ¨: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("=".repeat(60));

    // 4. ê²€ì¦?
    console.log("\n?” ê²€ì¦?ì¤?..");
    const [verifyResult] = await connection.query(`
      SELECT 
        COUNT(*) as count,
        SUM(item_count) as total_items,
        SUM(total_japanese_yen) as total_jpy,
        SUM(final_amount) as total_krw
      FROM daily_settlements
    `);

    console.log(`\n?“‹ DB ?€??ê²°ê³¼:`);
    console.log(`   ?•ì‚° ?ˆì½”?? ${verifyResult[0].count}ê°?);
    console.log(`   ì´??„ì´?? ${verifyResult[0].total_items}ê°?);
    console.log(`   ì´??¼ë³¸ ?”í™”: Â¥${formatNumber(verifyResult[0].total_jpy)}`);
    console.log(`   ì´?ìµœì¢… ê¸ˆì•¡: ??{formatNumber(verifyResult[0].total_krw)}`);
  } catch (error) {
    console.error("\n??ë§ˆì´ê·¸ë ˆ?´ì…˜ ì¤?ì¹˜ëª…???¤ë¥˜ ë°œìƒ:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * ?«ì ?¬ë§·??(ì²??¨ìœ„ ì½¤ë§ˆ)
 */
function formatNumber(num) {
  if (num === null || num === undefined) return "0";
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * ?¤í–‰
 */
async function main() {
  try {
    console.log("\n");
    await migrateExistingData();
    console.log("\n??ë§ˆì´ê·¸ë ˆ?´ì…˜ ?±ê³µ\n");
    process.exit(0);
  } catch (error) {
    console.error("\n??ë§ˆì´ê·¸ë ˆ?´ì…˜ ?¤íŒ¨:", error);
    process.exit(1);
  }
}

// ?¤í¬ë¦½íŠ¸ ì§ì ‘ ?¤í–‰ ??
if (require.main === module) {
  main();
}

module.exports = { migrateExistingData };
