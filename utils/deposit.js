/**
 * deposit.js — 예치금 및 기업 한도 관리
 *
 * 개인 회원: deductDeposit / refundDeposit  (예치금 즐감)
 * 기업 회원: deductLimit / refundLimit      (일일 한도 즐감)
 * 모든 작업은 deposit_transactions에 기록된다.
 */
const { pool } = require("./DB");

/** 예치금 차감 (status: confirmed) */
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

/** 예치금 환불 (status: confirmed) */
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

/** 기업 한도 차감 — daily_used 증가 */
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

/** 기업 한도 복구 — daily_used 감소 */
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

/** 확정된 입찰 차감액 조회 */
async function getBidDeductAmount(connection, bidId, bidType) {
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
