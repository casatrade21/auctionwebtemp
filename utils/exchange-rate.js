// utils/exchange-rate.js
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

// 환율 캐시 (1시간)
const EXCHANGE_CACHE_DURATION = 60 * 60 * 1000;

const exchangeCache = {
  rate: null,
  lastFetched: null,
};

/**
 * 환율 캐시 유효성 검사
 */
function isCacheValid() {
  if (!exchangeCache.rate || !exchangeCache.lastFetched) {
    return false;
  }

  const currentTime = new Date().getTime();
  return currentTime - exchangeCache.lastFetched < EXCHANGE_CACHE_DURATION;
}

/**
 * 환율 가져오기 (캐싱 적용)
 * @returns {Promise<number>} 환율
 */
async function getExchangeRate() {
  // 캐시가 유효하면 캐시된 환율 반환
  if (isCacheValid()) {
    return exchangeCache.rate;
  }

  try {
    // API에서 최신 환율 가져오기
    const response = await axios.get(apiUrl);
    const rate = response.data.rates.KRW / response.data.rates.JPY + 0.2;

    // 캐시 업데이트
    exchangeCache.rate = rate;
    exchangeCache.lastFetched = new Date().getTime();

    console.log(`환율 업데이트: ${rate}`);
    return rate;
  } catch (error) {
    console.error("환율 가져오기 실패:", error);

    // API 실패 시 캐시된 환율 반환 (있으면)
    if (exchangeCache.rate !== null) {
      console.warn("캐시된 환율 사용:", exchangeCache.rate);
      return exchangeCache.rate;
    }

    // 캐시도 없으면 기본값 반환
    console.warn("기본 환율 사용: 9.5");
    return 9.5;
  }
}

/**
 * 환율 수동 설정 (테스트용)
 */
function setExchangeRate(rate) {
  exchangeCache.rate = rate;
  exchangeCache.lastFetched = new Date().getTime();
}

/**
 * 캐시된 환율 반환 (동기)
 */
function getCachedExchangeRate() {
  return exchangeCache.rate || 9.5;
}

module.exports = {
  getExchangeRate,
  setExchangeRate,
  getCachedExchangeRate,
};
