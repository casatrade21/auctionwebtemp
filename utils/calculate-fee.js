// utils/calculate-fee.js
// UMD (Universal Module Definition) 패턴
// Node.js와 브라우저 모두에서 동작

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    // Node.js 환경
    module.exports = factory();
  } else {
    const exports = factory();

    // 각 함수를 전역으로 노출
    root.fetchExchangeRate = exports.fetchExchangeRate;
    root.fetchUserCommissionRate = exports.fetchUserCommissionRate;
    root.calculateLocalFee = exports.calculateLocalFee;
    root.calculateCustomsDuty = exports.calculateCustomsDuty;
    root.calculateComplexCustomsDuty = exports.calculateComplexCustomsDuty;
    root.calculateVAT = exports.calculateVAT;
    root.calculateTotalPrice = exports.calculateTotalPrice;
    root.calculateFee = exports.calculateFee;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ========================================
  // 브라우저 전용: 환율/수수료율 관리
  // ========================================
  let EXCHANGE_RATE = 9.5;
  let USER_COMMISSION_RATE = null;

  // 브라우저 환경에서만 환율 가져오기
  async function fetchExchangeRate() {
    if (typeof fetch === "undefined") return EXCHANGE_RATE;

    try {
      const response = await fetch("/api/data/exchange-rate");
      const data = await response.json();
      EXCHANGE_RATE = data.rate;
      return data.rate;
    } catch (error) {
      console.error("Error fetching exchange rate:", error);
      return EXCHANGE_RATE;
    }
  }

  // 브라우저 환경에서만 사용자 수수료율 가져오기
  async function fetchUserCommissionRate() {
    if (typeof fetch === "undefined") return null;

    try {
      const response = await fetch("/api/users/current");
      const userData = await response.json();

      if (userData && userData.commission_rate !== undefined) {
        console.log(`현재 사용자의 수수료율: ${userData.commission_rate}%`);
        USER_COMMISSION_RATE = userData.commission_rate;
        return userData.commission_rate;
      } else {
        console.log("사용자 수수료율이 설정되어 있지 않습니다.");
        return null;
      }
    } catch (error) {
      console.error("사용자 수수료율 조회 중 오류 발생:", error);
      return null;
    }
  }

  // ========================================
  // 공통: 계산 함수들
  // ========================================

  /**
   * 현지 수수료 계산
   */
  function calculateLocalFee(price, auctionId, category, exchangeRate = 9.5) {
    if (!price) return 0;
    price = Number(price);

    if (auctionId == 1) {
      if (price < 10000) return 2200;
      if (price < 50000) return 3300;
      if (price < 100000) return 5500;
      if (price < 1000000) return 11000;
      return 10800;
    }

    if (auctionId == 2) {
      if (price < 100000) {
        return Math.round(price * 0.11 + 1990);
      }
      return Math.round(price * 0.077 + 1990);
    }

    if (auctionId == 3) {
      const baseFee = price * 0.05;
      const vat = baseFee * 0.1;
      const insurance = (baseFee + vat) * 0.005;

      let categoryFee = 0;
      switch (category) {
        case "가방":
          categoryFee = 2900;
          break;
        case "시계":
          categoryFee = 2700;
          break;
        case "쥬얼리":
        case "보석":
          categoryFee = 500 + price * 0.05;
          break;
        case "악세서리":
        case "의류":
          categoryFee = 2000 + price * 0.05;
          break;
      }

      return Math.round((baseFee + vat + insurance + categoryFee) * 1.1);
    }

    if (auctionId == 4) {
      const feeInKRW = 10000; // 10,000원 고정 수수료
      const feeInYen = feeInKRW / exchangeRate; // 환율로 나눠서 엔화로 변환
      return Math.round(price * 0.055 + feeInYen);
    }

    if (auctionId == 5) {
      const feeInKRW = 5000; // 5,000원 고정 수수료
      const feeInYen = feeInKRW / exchangeRate; // 환율로 나눠서 엔화로 변환
      return Math.round(price * 0.077 + feeInYen);
    }

    return 0;
  }

  /**
   * 관세 계산 (부가세 제외)
   */
  function calculateCustomsDuty(amountKRW, category) {
    if (!amountKRW || !category) return 0;

    if (["의류", "신발"].includes(category)) {
      return Math.round(amountKRW * 0.13);
    }

    if (["가방", "시계"].includes(category)) {
      if (amountKRW <= 2000000) {
        return Math.round(amountKRW * 0.08);
      } else if (amountKRW < 1000000000) {
        return calculateComplexCustomsDuty(amountKRW, 2000000);
      }
    }

    if (["악세서리", "귀금속", "쥬얼리", "보석"].includes(category)) {
      if (amountKRW <= 5000000) {
        return Math.round(amountKRW * 0.08);
      } else if (amountKRW < 1000000000) {
        return calculateComplexCustomsDuty(amountKRW, 5000000);
      }
    }

    if (amountKRW <= 2000000) {
      return Math.round(amountKRW * 0.013);
    } else if (amountKRW < 1000000000) {
      return calculateComplexCustomsDuty(amountKRW, 2000000);
    }

    return 0;
  }

  /**
   * 복합관세 계산
   */
  function calculateComplexCustomsDuty(amountKRW, threshold) {
    const baseCustoms = amountKRW * 0.08;
    const amount = amountKRW;
    const excess = (baseCustoms + amount - threshold) * 0.2;
    const superExcess = excess * 0.3;

    return Math.round(baseCustoms + excess + superExcess);
  }

  /**
   * 부가세 계산
   */
  function calculateVAT(amountKRW, customsDuty, category) {
    if (!amountKRW || !category) return 0;
    return Math.round((amountKRW + customsDuty) * 0.1);
  }

  /**
   * 최종 가격 계산 (관부가세 포함)
   * @param {number} price - 상품 가격
   * @param {number} auctionId - 플랫폼 구분
   * @param {string} category - 상품 카테고리
   * @param {number|null} exchangeRate - 환율 (옵션)
   */
  function calculateTotalPrice(
    price,
    auctionId,
    category,
    exchangeRate = null,
  ) {
    price = parseFloat(price) || 0;

    // 환율 결정 우선순위:
    // 1. 명시적으로 전달된 환율 (백엔드 스냅샷용)
    // 2. 브라우저 환경의 전역 변수
    // 3. 기본값 9.5
    let rate;
    if (exchangeRate !== null) {
      rate = exchangeRate;
    } else if (typeof EXCHANGE_RATE !== "undefined") {
      rate = EXCHANGE_RATE;
    } else {
      rate = 9.5;
    }

    const localFee = calculateLocalFee(price, auctionId, category, rate);
    const totalAmountKRW = (price + localFee) * rate;
    const customsDuty = calculateCustomsDuty(totalAmountKRW, category);
    const vat = calculateVAT(totalAmountKRW, customsDuty, category);

    return Math.round(totalAmountKRW + customsDuty + vat);
  }

  /**
   * 입찰금액 기준 수수료 계산
   * @param {number} price - 입찰 금액
   * @param {number|null} userCommissionRate - 사용자별 수수료율 (옵션)
   */
  function calculateFee(price, userCommissionRate = null) {
    if (!price) return 0;
    price = Number(price);

    if (isNaN(price)) return 0;

    // 수수료율 결정 우선순위:
    // 1. 명시적으로 전달된 수수료율 (백엔드용)
    // 2. 브라우저 환경의 전역 변수
    // 3. 기본 계산식
    let rate;
    if (userCommissionRate !== null) {
      rate = userCommissionRate;
    } else if (
      typeof USER_COMMISSION_RATE !== "undefined" &&
      USER_COMMISSION_RATE !== null
    ) {
      rate = USER_COMMISSION_RATE;
    } else {
      rate = null; // 기본 계산식 사용
    }

    // 사용자별 수수료율이 있으면 사용
    if (rate !== null) {
      return Math.round(price * (rate / 100));
    }

    // 기본 수수료율 계산
    let fee = 0;

    if (price <= 5000000) {
      fee = price * 0.1;
    } else {
      fee = 5000000 * 0.1;
      price -= 5000000;

      if (price <= 5000000) {
        fee += price * 0.07;
      } else {
        fee += 5000000 * 0.07;
        price -= 5000000;

        if (price <= 40000000) {
          fee += price * 0.05;
        } else {
          fee += 40000000 * 0.05;
          return "별도 협의";
        }
      }
    }

    return Math.round(fee);
  }

  // ========================================
  // 브라우저 환경에서만: 자동 초기화
  // ========================================
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      fetchExchangeRate().then((rate) => {
        console.log("Exchange rate loaded:", rate);
      });

      fetchUserCommissionRate().then((rate) => {
        console.log(
          "User commission rate loaded:",
          rate !== null ? rate + "%" : "기본 수수료율 사용",
        );
      });
    });
  }

  // ========================================
  // 모듈 exports
  // ========================================
  return {
    // 브라우저 전용
    fetchExchangeRate,
    fetchUserCommissionRate,

    // 공통 계산 함수
    calculateLocalFee,
    calculateCustomsDuty,
    calculateComplexCustomsDuty,
    calculateVAT,
    calculateTotalPrice,
    calculateFee,
  };
});
