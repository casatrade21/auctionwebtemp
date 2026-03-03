// utils/feeCalculator.js
// 임시 수수료 계산 유틸리티 (현재는 모든 수수료가 0으로 설정됨)

/**
 * 구매 가격에 대한 수수료를 계산하는 함수
 * @param {number} purchasePrice - 구매 가격
 * @param {string} category - 상품 카테고리 (옵션)
 * @param {string} brand - 상품 브랜드 (옵션)
 * @param {string} userId - 사용자 ID (옵션)
 * @returns {number} 계산된 수수료 금액
 */
function calculateFee(
  purchasePrice,
  category = null,
  brand = null,
  userId = null
) {
  // 현재는 모든 수수료가 0으로 설정됨
  // 추후 수수료 계산 로직이 구현될 예정
  return 0;
}

/**
 * 구매 가격에 대한 수수료율을 계산하는 함수
 * @param {number} purchasePrice - 구매 가격
 * @param {string} category - 상품 카테고리 (옵션)
 * @param {string} brand - 상품 브랜드 (옵션)
 * @param {string} userId - 사용자 ID (옵션)
 * @returns {number} 계산된 수수료율 (%)
 */
function calculateFeeRate(
  purchasePrice,
  category = null,
  brand = null,
  userId = null
) {
  // 현재는 모든 수수료율이 0%로 설정됨
  // 추후 수수료율 계산 로직이 구현될 예정
  return 0;
}

module.exports = {
  calculateFee,
  calculateFeeRate,
};
