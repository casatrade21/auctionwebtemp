/**
 * exchange-rate.js — JPY→KRW 환율 조회
 *
 * CurrencyFreaks API로 환율을 가져오고 1시간 캐싱한다.
 * API 실패 시 캐시 → 기본값(9.5) 순으로 폴백.
 */
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

const EXCHANGE_CACHE_DURATION = 60 * 60 * 1000; // 1시간

const exchangeCache = {
  rate: null,
  lastFetched: null,
};

function isCacheValid() {
  if (!exchangeCache.rate || !exchangeCache.lastFetched) {
    return false;
  }

  const currentTime = new Date().getTime();
  return currentTime - exchangeCache.lastFetched < EXCHANGE_CACHE_DURATION;
}

/** 환율 조회 (1시간 캐시) */
async function getExchangeRate() {
  if (isCacheValid()) {
    return exchangeCache.rate;
  }

  try {
    const response = await axios.get(apiUrl);
    const rate = response.data.rates.KRW / response.data.rates.JPY + 0.2;

    exchangeCache.rate = rate;
    exchangeCache.lastFetched = new Date().getTime();

    console.log(`환율 업데이트: ${rate}`);
    return rate;
  } catch (error) {
    console.error("환율 가져오기 실패:", error);

    if (exchangeCache.rate !== null) {
      console.warn("캐시된 환율 사용:", exchangeCache.rate);
      return exchangeCache.rate;
    }

    console.warn("기본 환율 사용: 9.5");
    return 9.5;
  }
}

/** 환율 수동 설정 (테스트용) */
function setExchangeRate(rate) {
  exchangeCache.rate = rate;
  exchangeCache.lastFetched = new Date().getTime();
}

/** 캐시된 환율 동기 반환 (기본값 9.5) */
function getCachedExchangeRate() {
  return exchangeCache.rate || 9.5;
}

module.exports = {
  getExchangeRate,
  setExchangeRate,
  getCachedExchangeRate,
};
