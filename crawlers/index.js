/**
 * crawlers/index.js — 크롤러 인스턴스 통합 익스포트
 *
 * 각 경매 사이트의 일반/시세(Value) 크롤러를 단일 진입점으로 내보낸다.
 */
const { ecoAucCrawler, ecoAucValueCrawler } = require("./ecoAuc");
const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");
const { starAucCrawler, starAucValueCrawler } = require("./starAuc");
const { mekikiAucCrawler, mekikiAucValueCrawler } = require("./mekikiAuc");
const { penguinAucCrawler } = require("./penguinAuc");

module.exports = {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
  mekikiAucCrawler,
  mekikiAucValueCrawler,
  penguinAucCrawler,
};
