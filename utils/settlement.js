// utils/settlement.js
const { pool } = require("./DB");
const { calculateFee, calculateTotalPrice } = require("./calculate-fee");
const { getExchangeRate } = require("./exchange-rate");
const {
  deductDeposit,
  refundDeposit,
  getBidDeductAmount,
} = require("./deposit");

/**
 * 사용자 수수료율 가져오기
 */
async function getUserCommissionRate(userId) {
  try {
    const [users] = await pool.query(
      "SELECT commission_rate FROM users WHERE id = ?",
      [userId],
    );

    if (users.length > 0 && users[0].commission_rate !== null) {
      return users[0].commission_rate;
    }

    return null; // 기본 수수료율 사용
  } catch (error) {
    console.error("사용자 수수료율 조회 실패:", error);
    return null;
  }
}

/**
 * 일별 정산 생성/업데이트
 */
async function createOrUpdateSettlement(userId, date) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 0. 계정 타입 확인 (추가됨)
    const [accounts] = await connection.query(
      "SELECT account_type FROM user_accounts WHERE user_id = ?",
      [userId],
    );
    const accountType = accounts[0]?.account_type || "individual";

    // [수정] 1. 환율 결정 로직 (스냅샷 환율 유지)
    // 정산 데이터가 이미 존재한다면, 최초 생성 시점의 환율을 그대로 사용해야 함
    let exchangeRate;
    const [existingSettlementData] = await connection.query(
      "SELECT exchange_rate FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, date],
    );

    if (existingSettlementData.length > 0) {
      exchangeRate = existingSettlementData[0].exchange_rate;
    } else {
      exchangeRate = await getExchangeRate();
    }

    // 2. 사용자 수수료율 가져오기
    const userCommissionRate = await getUserCommissionRate(userId);

    // 3. 해당 날짜의 낙찰 성공 아이템 조회
    const [liveBids] = await connection.query(
      `SELECT l.winning_price, l.appr_id, l.repair_requested_at, l.repair_fee, i.auc_num, i.category
       FROM live_bids l
       LEFT JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND l.status = 'completed'`,
      [userId, date],
    );

    const [directBids] = await connection.query(
      `SELECT d.winning_price, d.appr_id, d.repair_requested_at, d.repair_fee, i.auc_num, i.category
       FROM direct_bids d
       LEFT JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND d.status = 'completed'`,
      [userId, date],
    );

    const [instantPurchases] = await connection.query(
      `SELECT p.purchase_price as winning_price, p.appr_id, p.repair_requested_at, p.repair_fee, i.auc_num, i.category
       FROM instant_purchases p
       LEFT JOIN crawled_items i ON p.item_id = i.item_id
       WHERE p.user_id = ? 
         AND DATE(p.completed_at) = ?
         AND p.status = 'completed'`,
      [userId, date],
    );

    const items = [...liveBids, ...directBids, ...instantPurchases];

    if (items.length === 0) {
      // 낙찰 성공 없으면 정산 삭제
      await connection.query(
        "DELETE FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
        [userId, date],
      );
      await connection.commit();
      return null;
    }

    // 4. 총액 계산 (스냅샷 환율 사용)
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;
    let repairCount = 0;
    let totalRepairFee = 0; // 수선 비용 합계

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // calculateTotalPrice에 환율 전달
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate, // 스냅샷 환율
      );
      totalAmount += koreanPrice;

      // 감정서 개수
      if (item.appr_id) {
        appraisalCount++;
      }

      // 수선 개수 및 비용
      if (item.repair_requested_at) {
        repairCount++;
        // 개별 수선 비용이 있으면 합산, 없으면 0
        totalRepairFee += Number(item.repair_fee) || 0;
      }
    });

    // 5. 수수료 계산 (사용자별 수수료율 적용)
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000,
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. 감정서 수수료
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. 수선 수수료 (개별 금액 합산)
    const repairFee = totalRepairFee; // 각 수선의 repair_fee 합계
    const repairVat = repairFee > 0 ? Math.round(repairFee / 11) : 0;

    // 8. 최종 금액
    const finalAmount = totalAmount + feeAmount + appraisalFee + repairFee;

    // [로직 변경] Payment Status 및 Completed Amount 결정
    let initialPaymentStatus = "pending";
    let paymentMethod = null;
    let completedAmount = 0; // 신규 생성 시 기본 0

    // 기존 데이터 조회
    const [existing] = await connection.query(
      "SELECT id, payment_status, completed_amount FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, date],
    );

    if (accountType === "individual") {
      // 개인 회원은 자동 결제이므로 항상 완납 처리
      initialPaymentStatus = "paid";
      paymentMethod = "deposit";
      completedAmount = finalAmount; // 즉시 전액 결제됨
    } else {
      // 기업 회원 (Corporate)
      initialPaymentStatus = "unpaid";
      paymentMethod = "manual";

      if (existing.length > 0) {
        // 기존 데이터가 있는 경우, 기 결제액 유지
        completedAmount = Number(existing[0].completed_amount || 0);

        // [핵심] 차액 발생 여부 확인
        if (completedAmount === 0) {
          // 아직 결제 안됨 -> 미결제(Unpaid) 유지
          initialPaymentStatus = "unpaid";
        } else if (finalAmount > completedAmount) {
          // 부분 결제 상태 (총액이 기 결제액보다 큼) -> 부분 결제(Pending) 유지
          initialPaymentStatus = "pending";
        } else if (finalAmount <= completedAmount) {
          // 총액이 같거나 줄어들면 -> 결제 완료(Paid) 유지
          // (환불 로직은 별도 고려 필요하나, 여기서는 완료 상태 유지)
          initialPaymentStatus = "paid";
        }
      }
    }

    if (existing.length > 0) {
      // 기존 정산 업데이트
      await connection.query(
        `UPDATE daily_settlements 
         SET item_count = ?,
             total_japanese_yen = ?,
             total_amount = ?, 
             fee_amount = ?, 
             vat_amount = ?,
             appraisal_fee = ?,
             appraisal_vat = ?,
             appraisal_count = ?,
             repair_fee = ?,
             repair_vat = ?,
             repair_count = ?,
             final_amount = ?, 
             completed_amount = ?,
             exchange_rate = ?,
             payment_status = ?
         WHERE id = ?`,
        [
          items.length,
          totalJapaneseYen,
          totalAmount,
          feeAmount,
          vatAmount,
          appraisalFee,
          appraisalVat,
          appraisalCount,
          repairFee,
          repairVat,
          repairCount,
          finalAmount,
          completedAmount,
          exchangeRate,
          initialPaymentStatus,
          existing[0].id,
        ],
      );
    } else {
      // 신규 삽입
      await connection.query(
        `INSERT INTO daily_settlements 
         (user_id, settlement_date, item_count, total_japanese_yen, 
          total_amount, fee_amount, vat_amount, 
          appraisal_fee, appraisal_vat, appraisal_count,
          repair_fee, repair_vat, repair_count,
          final_amount, completed_amount, exchange_rate, payment_status, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          repairFee,
          repairVat,
          repairCount,
          finalAmount,
          completedAmount,
          exchangeRate,
          initialPaymentStatus,
          paymentMethod,
        ],
      );
    }

    await connection.commit();
    console.log(`정산 생성/업데이트 완료: ${userId} - ${date}`);
    return true;
  } catch (err) {
    await connection.rollback();
    console.error("Error creating settlement:", err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * 정산 금액과 실제 차감 금액 비교 후 차액 조정
 * [수정] 기업 회원(corporate)은 예치금 차감 로직을 타면 안 되므로 스킵
 */
async function adjustDepositBalance(connection, userId, settlementDate) {
  try {
    // 0. 기업 회원 체크 (추가)
    const [accounts] = await connection.query(
      "SELECT account_type FROM user_accounts WHERE user_id = ?",
      [userId],
    );
    if (accounts.length > 0 && accounts[0].account_type === "corporate") {
      return; // 기업 회원은 예치금 자동 조정 스킵 (정산서 금액만 확정되면 됨)
    }

    // 1. 정산 금액 조회 (감정료/수선료 제외)
    const [settlements] = await connection.query(
      "SELECT total_amount, fee_amount FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, settlementDate],
    );

    if (settlements.length === 0) return;

    const settlement = settlements[0];
    const settlementAmount =
      Number(settlement.total_amount) + Number(settlement.fee_amount);

    // 2. 실제 차감 금액 조회 (deposit_transactions에서)
    const [bids] = await connection.query(
      `SELECT d.id, 'direct_bid' as bid_type
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.user_id = ? AND DATE(i.scheduled_date) = ? AND d.status = 'completed'
       UNION
       SELECT l.id, 'live_bid' as bid_type
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.user_id = ? AND DATE(i.scheduled_date) = ? AND l.status = 'completed'
       UNION
       SELECT p.id, 'instant_purchase' as bid_type
       FROM instant_purchases p 
       WHERE p.user_id = ? AND DATE(p.completed_at) = ? AND p.status = 'completed'`,
      [userId, settlementDate, userId, settlementDate, userId, settlementDate],
    );

    // 3. 각 입찰의 차감액 합계
    let totalDeducted = 0;
    for (const bid of bids) {
      const deductAmount = await getBidDeductAmount(
        connection,
        bid.id,
        bid.bid_type,
      );
      totalDeducted += deductAmount;
    }

    // 4. 차액 계산
    const diff = settlementAmount - totalDeducted;

    if (Math.abs(diff) < 1) {
      return; // 차이 1원 미만 무시
    }

    // 5. 차액 조정
    if (diff > 0) {
      // 추가 차감
      await deductDeposit(
        connection,
        userId,
        diff,
        "settlement_adjust",
        null,
        `정산 확정 차액 조정 (${settlementDate}, 환율 변동)`,
      );
    } else {
      // 환불
      const refundAmount = Math.abs(diff);
      await refundDeposit(
        connection,
        userId,
        refundAmount,
        "settlement_adjust",
        null,
        `정산 확정 차액 환불 (${settlementDate}, 환율 변동)`,
      );
    }
  } catch (error) {
    console.error("차액 조정 실패:", error);
    throw error;
  }
}

module.exports = {
  createOrUpdateSettlement,
  getUserCommissionRate,
  adjustDepositBalance,
};
