// utils/deposit.js
const { pool } = require("./DB");

/**
 * 예치금 차감 (시스템에 의한 즉시 차감)
 * Status: 'confirmed' (즉시 반영이므로)
 */
async function deductDeposit(
  connection,
  userId,
  amount,
  relatedType,
  relatedId,
  description,
) {
  // 1. 예치금 차감
  await connection.query(
    "UPDATE user_accounts SET deposit_balance = deposit_balance - ? WHERE user_id = ?",
    [amount, userId],
  );

  // 2. 잔액 조회
  const [account] = await connection.query(
    "SELECT deposit_balance FROM user_accounts WHERE user_id = ?",
    [userId],
  );
  const balanceAfter = account[0]?.deposit_balance || 0;

  // 3. 거래 내역 기록 (status = 'confirmed' 추가)
  await connection.query(
    `INSERT INTO deposit_transactions 
     (user_id, type, amount, balance_after, status, related_type, related_id, description, created_at) 
     VALUES (?, 'deduct', ?, ?, 'confirmed', ?, ?, ?, NOW())`,
    [userId, amount, balanceAfter, relatedType, relatedId, description],
  );

  return balanceAfter;
}

/**
 * 예치금 환불 (시스템/관리자에 의한 즉시 환불/지급)
 * Status: 'confirmed'
 */
async function refundDeposit(
  connection,
  userId,
  amount,
  relatedType,
  relatedId,
  description,
) {
  // 1. 예치금 증가
  await connection.query(
    "UPDATE user_accounts SET deposit_balance = deposit_balance + ? WHERE user_id = ?",
    [amount, userId],
  );

  // 2. 잔액 조회
  const [account] = await connection.query(
    "SELECT deposit_balance FROM user_accounts WHERE user_id = ?",
    [userId],
  );
  const balanceAfter = account[0]?.deposit_balance || 0;

  // 3. 거래 내역 기록 (status = 'confirmed' 추가)
  await connection.query(
    `INSERT INTO deposit_transactions 
     (user_id, type, amount, balance_after, status, related_type, related_id, description, created_at) 
     VALUES (?, 'refund', ?, ?, 'confirmed', ?, ?, ?, NOW())`,
    [userId, amount, balanceAfter, relatedType, relatedId, description],
  );

  return balanceAfter;
}

/**
 * 한도 차감 (기업 회원)
 * deposit_transactions에 기록하여 추적 가능하도록 함
 */
async function deductLimit(
  connection,
  userId,
  amount,
  relatedType,
  relatedId,
  description,
) {
  // 1. 한도 사용량 증가
  await connection.query(
    "UPDATE user_accounts SET daily_used = daily_used + ? WHERE user_id = ?",
    [amount, userId],
  );

  // 2. 잔액 조회
  const [account] = await connection.query(
    "SELECT daily_limit, daily_used FROM user_accounts WHERE user_id = ?",
    [userId],
  );
  const dailyLimit = account[0]?.daily_limit || 0;
  const dailyUsed = account[0]?.daily_used || 0;
  const remainingLimit = dailyLimit - dailyUsed;

  // 3. 거래 내역 기록 (status = 'confirmed' 추가)
  await connection.query(
    `INSERT INTO deposit_transactions 
     (user_id, type, amount, balance_after, status, related_type, related_id, description, created_at) 
     VALUES (?, 'deduct', ?, ?, 'confirmed', ?, ?, ?, NOW())`,
    [userId, amount, remainingLimit, relatedType, relatedId, description],
  );

  return remainingLimit;
}

/**
 * 한도 복구 (기업 회원)
 * deposit_transactions에 기록하여 추적 가능하도록 함
 */
async function refundLimit(
  connection,
  userId,
  amount,
  relatedType,
  relatedId,
  description,
) {
  // 1. 한도 사용량 감소
  await connection.query(
    "UPDATE user_accounts SET daily_used = daily_used - ? WHERE user_id = ?",
    [amount, userId],
  );

  // 2. 잔액 조회
  const [account] = await connection.query(
    "SELECT daily_limit, daily_used FROM user_accounts WHERE user_id = ?",
    [userId],
  );
  const dailyLimit = account[0]?.daily_limit || 0;
  const dailyUsed = account[0]?.daily_used || 0;
  const remainingLimit = dailyLimit - dailyUsed;

  // 3. 거래 내역 기록 (status = 'confirmed' 추가)
  await connection.query(
    `INSERT INTO deposit_transactions 
     (user_id, type, amount, balance_after, status, related_type, related_id, description, created_at) 
     VALUES (?, 'refund', ?, ?, 'confirmed', ?, ?, ?, NOW())`,
    [userId, amount, remainingLimit, relatedType, relatedId, description],
  );

  return remainingLimit;
}

/**
 * 입찰 차감액 조회
 */
async function getBidDeductAmount(connection, bidId, bidType) {
  // status='confirmed' 조건 추가하여 확정된 차감액만 조회
  const [transactions] = await connection.query(
    `SELECT amount FROM deposit_transactions 
     WHERE related_type = ? AND related_id = ? AND type = 'deduct' AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 1`,
    [bidType, bidId],
  );

  return transactions[0]?.amount || 0;
}

module.exports = {
  deductDeposit,
  refundDeposit,
  deductLimit,
  refundLimit,
  getBidDeductAmount,
};
