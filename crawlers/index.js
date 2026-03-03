// crawlers/index.js
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
