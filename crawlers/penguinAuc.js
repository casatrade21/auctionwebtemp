// crawlers/penguinAuc.js
const cheerio = require("cheerio");
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");
const translator = require("../utils/translator");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const LIMIT1 = 10;
const LIMIT2 = 10;

const penguinAucConfig = {
  name: "PenguinAuc",
  baseUrl: "https://penguin-auction.jp",
  loginCheckUrls: ["https://penguin-auction.jp/auction/"],
  loginPageUrl: "https://penguin-auction.jp/login/",
  loginPostUrl: "https://penguin-auction.jp/login/",
  searchUrl: "https://penguin-auction.jp/auction/",
  loginData: {
    mail: process.env.CRAWLER_EMAIL5,
    password: process.env.CRAWLER_PASSWORD5,
    m: "login",
  },
  useMultipleClients: true,
  categoryIds: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  categoryTable: {
    1: "가방",
    2: "시계",
    3: "귀금속",
    4: "의류",
    5: "주류",
    6: "기타",
    7: "기타",
    8: "기타",
    9: "기타",
  },
  crawlSelectors: {
    itemContainer: "ul.goods li",
    itemLink: ".goods-ttl a",
    title: ".goods-ttl a",
    rank: ".goods-img .rank",
    lotNo: ".goods-dl dd",
    image: ".goods-img img",
    bidCount: ".avatar-box a",
    scheduleText: ".countdown-time .text",
    priceTable: ".currency-tbl .tr",
    paginationContainer: ".pager-block ul.pager",
  },
  crawlDetailSelectors: {
    title: "h1.product_name",
    images: ".product_img_box .swiper-slide img",
    detailTable: ".product_detail_table table tr",
    comment: ".product_comment_box",
    price: ".price_area .price",
    brand:
      ".product_detail_table th:contains('ブランド') + td, .product_detail_table th:contains('Brand') + td",
    itemName:
      ".product_detail_table th:contains('商品名') + td, .product_detail_table th:contains('Item Name') + td",
    material:
      ".product_detail_table th:contains('素材') + td, .product_detail_table th:contains('Material') + td",
    color:
      ".product_detail_table th:contains('カラー') + td, .product_detail_table th:contains('Color') + td",
    size: ".product_detail_table th:contains('サイズ') + td, .product_detail_table th:contains('Size') + td",
    spec: ".product_detail_table th:contains('仕様') + td, .product_detail_table th:contains('Spec') + td",
    accessories:
      ".product_detail_table th:contains('付属品') + td, .product_detail_table th:contains('Accessories') + td",
    rank: ".product_detail_table th:contains('ランク') + td, .product_detail_table th:contains('Rank') + td",
  },
  searchParams: (categoryId, page) => {
    const params = new URLSearchParams();
    if (categoryId) params.append("category", categoryId);
    params.append("word", "");
    params.append("num1", "");
    params.append("num2", "");
    params.append("num3", "");
    params.append("num4", "");
    params.append("price_lower", "");
    params.append("price_upper", "");
    params.append("bid", "0");
    params.append("my_bid", "0");
    if (page > 1) params.append("page", page);
    return `?${params.toString()}`;
  },
  detailUrl: (itemId) => `https://penguin-auction.jp/product/detail/${itemId}/`,
};

class PenguinAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null;
  }

  // 로그인 구현
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} Penguin Auction 로그인 중...`);

      // 폼 데이터 준비
      const formData = new URLSearchParams();
      formData.append("mail", this.config.loginData.mail);
      formData.append("password", this.config.loginData.password);
      formData.append("m", this.config.loginData.m);

      // 로그인 요청
      const loginResponse = await clientInfo.client.post(
        this.config.loginPostUrl,
        formData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: this.config.loginPageUrl,
          },
          maxRedirects: 5,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        },
      );

      // 쿠키 설정
      await clientInfo.cookieJar.setCookie(
        "search-recode=150",
        "https://penguin-auction.jp",
      );
      await clientInfo.cookieJar.setCookie(
        "stt_lang=en",
        "https://penguin-auction.jp",
      );
      console.log("쿠키 설정 완료 (search-recode=150, stt_lang=en)");

      // 로그인 후 검증
      if (
        (loginResponse.status === 302 || loginResponse.status === 200) &&
        (await this.loginCheckWithClient(clientInfo))
      ) {
        console.log(`${clientInfo.name} 로그인 성공`);
        return true;
      } else {
        throw new Error("Login verification failed");
      }
    });
  }

  async performLogin() {
    const directClient = this.getDirectClient();
    return await this.performLoginWithClient(directClient);
  }

  // 전체 아이템 크롤링
  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(
        `Starting Penguin Auction crawl at ${new Date().toISOString()}`,
      );

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 카테고리 정보가 없으므로 전체 크롤링
      if (this.config.categoryIds.length === 0) {
        console.log("Crawling all items (no category filter)...");
        const items = await this.crawlCategory(null, existingIds, true);
        if (items && items.length > 0) {
          allCrawledItems.push(...items);
        }
      } else {
        // 각 카테고리별로 크롤링
        for (const categoryId of this.config.categoryIds) {
          console.log(`\n=== Crawling category: ${categoryId} ===`);
          this.config.currentCategoryId = categoryId;

          const categoryItems = await this.crawlCategory(
            categoryId,
            existingIds,
            true,
          );

          if (categoryItems && categoryItems.length > 0) {
            allCrawledItems.push(...categoryItems);
            console.log(
              `Completed crawl for category ${categoryId}. Items found: ${categoryItems.length}`,
            );
          }
        }
      }

      if (allCrawledItems.length === 0) {
        console.log("No items were crawled. Aborting save operation.");
        return [];
      }

      console.log(`Total items crawled: ${allCrawledItems.length}`);

      // 이미지 처리
      console.log(
        `Starting image processing for ${allCrawledItems.length} items...`,
      );
      const itemsWithImages = allCrawledItems.filter((item) => item.image);
      const finalProcessedItems = await processImagesInChunks(
        itemsWithImages,
        "products",
        3,
        null,
        {
          headers: {
            Referer: "https://penguin-auction.jp/",
          },
        },
      );

      // 이미지가 없는 아이템들도 포함
      const itemsWithoutImages = allCrawledItems.filter((item) => !item.image);
      const allFinalItems = [...finalProcessedItems, ...itemsWithoutImages];

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Operation completed in ${this.formatExecutionTime(executionTime)}`,
      );

      return allFinalItems;
    } catch (error) {
      console.error("Crawl failed:", error.message);
      return [];
    }
  }

  // 특정 카테고리 크롤링
  async crawlCategory(
    categoryId,
    existingIds = new Set(),
    skipImageProcessing = false,
  ) {
    try {
      const clientInfo = this.getClient();

      // 첫 페이지로 전체 페이지 수 확인
      const firstPageUrl =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);
      console.log(`Fetching first page: ${firstPageUrl}`);

      const firstPageResponse = await clientInfo.client.get(firstPageUrl, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
        },
      });

      const $first = cheerio.load(firstPageResponse.data, { xmlMode: false });

      // 페이지네이션에서 최대 페이지 수 추출
      const lastPageNumber = this.getLastPageNumber($first);
      console.log(`Found ${lastPageNumber} total pages`);
      // 첫 페이지 아이템 처리
      const allItems = [];
      const firstPageItems = await this.extractItemsFromPage(
        $first,
        existingIds,
      );
      allItems.push(...firstPageItems);
      console.log(`Processed ${firstPageItems.length} items from page 1`);

      // 나머지 페이지 병렬 처리
      if (lastPageNumber > 1) {
        const limit = pLimit(LIMIT2);
        const pagePromises = [];

        for (let page = 2; page <= lastPageNumber; page++) {
          pagePromises.push(
            limit(async () => {
              console.log(`Crawling page ${page} of ${lastPageNumber}`);
              return await this.crawlPage(categoryId, page, existingIds);
            }),
          );
        }

        const pageResults = await Promise.all(pagePromises);
        pageResults.forEach((pageItems) => {
          if (pageItems && pageItems.length > 0) {
            allItems.push(...pageItems);
          }
        });
      }

      console.log(`Completed category crawl. Total items: ${allItems.length}`);

      // 이미지 처리
      if (!skipImageProcessing) {
        const itemsWithImages = allItems.filter((item) => item.image);
        const processedItems = await processImagesInChunks(
          itemsWithImages,
          "products",
          3,
          null,
          {
            headers: {
              Referer: "https://penguin-auction.jp/",
            },
          },
        );
        const itemsWithoutImages = allItems.filter((item) => !item.image);
        return [...processedItems, ...itemsWithoutImages];
      }

      return allItems;
    } catch (error) {
      console.error(`Error crawling category ${categoryId}:`, error.message);
      return [];
    }
  }

  // 특정 페이지 크롤링
  async crawlPage(categoryId, page, existingIds = new Set()) {
    const clientInfo = this.getClient();

    return this.retryOperation(async () => {
      console.log(
        `Crawling page ${page} in category ${categoryId || "all"} with ${
          clientInfo.name
        }...`,
      );

      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await clientInfo.client.get(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
        },
      });
      const $ = cheerio.load(response.data, { xmlMode: false });

      const pageItems = await this.extractItemsFromPage($, existingIds);

      console.log(
        `Processed ${pageItems.length} items from page ${page} (${clientInfo.name})`,
      );

      return pageItems;
    });
  }

  // 페이지에서 아이템 추출
  async extractItemsFromPage($, existingIds) {
    const items = [];
    const itemElements = $(this.config.crawlSelectors.itemContainer);

    console.log(`Found ${itemElements.length} items on page`);

    if (itemElements.length === 0) {
      return [];
    }

    for (let i = 0; i < itemElements.length; i++) {
      const element = itemElements.eq(i);
      const item = await this.extractItemInfo($, element, existingIds);
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  // 아이템 정보 추출
  async extractItemInfo($, element, existingIds) {
    try {
      // 아이템 ID 추출 (URL에서)
      const $link = element.find(this.config.crawlSelectors.itemLink);
      const href = $link.attr("href") || "";
      const match = href.match(/\/detail\/(\d+)\//);
      const itemId = match ? match[1] : null;

      if (!itemId) {
        return null;
      }

      // 이미 처리된 아이템인지 확인
      if (existingIds.has(itemId)) {
        return { item_id: itemId, isExisting: true };
      }

      // 제목 추출
      const title = $link.text().trim();

      // lighter 필터링
      if (title.toLowerCase().includes("lighter")) {
        return null;
      }

      // 등급 추출
      const $rank = element.find(this.config.crawlSelectors.rank);
      let rank = $rank.text().trim().toUpperCase();
      if (!rank && $rank.length > 0) {
        // class에서 추출 시도: "rank ab" -> "AB"
        const className = $rank.attr("class") || "";
        const rankMatch = className.match(/rank\s+(\w+)/i);
        rank = rankMatch ? rankMatch[1].toUpperCase() : null;
      }

      // Lot 번호 추출
      const lotNo = element
        .find(this.config.crawlSelectors.lotNo)
        .text()
        .trim();

      // 이미지 URL 추출
      const $image = element.find(this.config.crawlSelectors.image);
      let image = $image.attr("src");
      // 쿼리 파라미터 제거
      if (image) {
        image = image.split("?")[0];
      }

      // 가격 정보 추출 (시작가와 현재가)
      // currency-tbl의 구조: 1번째 tr = 헤더, 2번째 tr = 시작가, 3번째 tr = 현재가
      let startingPrice = null;
      let currentPrice = null;
      const priceRows = element.find(this.config.crawlSelectors.priceTable);

      if (priceRows.length >= 3) {
        // 2번째 row (index 1) = 시작가
        const startPriceRow = priceRows.eq(1);
        const startPriceCells = startPriceRow.find(".td[data-stt-ignore]");
        if (startPriceCells.length > 0) {
          startingPrice = this.currencyToInt(startPriceCells.text().trim());
        }

        // 3번째 row (index 2) = 현재가
        const currentPriceRow = priceRows.eq(2);
        const currentPriceCells = currentPriceRow.find(".td[data-stt-ignore]");
        if (currentPriceCells.length > 0) {
          currentPrice = this.currencyToInt(currentPriceCells.text().trim());
        }
      }

      // 입찰 수 추출
      const $bidCount = element.find(this.config.crawlSelectors.bidCount);
      const bidCountText = $bidCount.text(); // "?ζ쑎(0)"
      const bidCountMatch = bidCountText.match(/\((\d+)\)/);
      const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : 0;

      // 스케줄 날짜 추출
      const scheduleText = element
        .find(this.config.crawlSelectors.scheduleText)
        .text()
        .trim();
      const scheduledDate = this.extractScheduleDate(scheduleText);

      // 브랜드는 제목의 첫 단어
      const brand = title.split(" ")[0];

      // 카테고리 추출
      const category = this.config.categoryTable[this.config.currentCategoryId];

      // 결과 객체 생성 (ecoAuc 구조와 동일하게)
      return {
        item_id: itemId,
        original_title: title,
        title: this.removeLeadingBrackets(title),
        brand: brand,
        rank: rank,
        starting_price: currentPrice || startingPrice, // 현재가 우선, 없으면 시작가
        image: image,
        category: category,
        bid_type: "direct",
        original_scheduled_date: scheduledDate,
        scheduled_date: scheduledDate,
        auc_num: "5",
        additional_info: {},
      };
    } catch (error) {
      console.error("아이템 정보 추출 실패:", error);
      return null;
    }
  }

  // 스케줄 날짜 추출 ("永귚틙?귡뼋 2/5 14:00(?" -> Date 객체)
  extractScheduleDate(scheduleText) {
    try {
      if (!scheduleText) return null;

      // "2/5 14:00" 형식 파싱
      const match = scheduleText.match(/(\d+)\/(\d+)\s+(\d+):(\d+)/);
      if (!match) return null;

      const month = parseInt(match[1]);
      const day = parseInt(match[2]);
      const hour = parseInt(match[3]);
      const minute = parseInt(match[4]);

      // 현재 년도 사용 (또는 다음 년도 처리)
      const now = new Date();
      let year = now.getFullYear();

      // 만약 월이 현재보다 이전이면 다음 년도로 추정
      if (month < now.getMonth() + 1) {
        year += 1;
      }

      const date = new Date(year, month - 1, day, hour, minute);
      return this.extractDate(this.convertToKST(date.toISOString()));
    } catch (error) {
      console.error("날짜 파싱 실패:", error);
      return null;
    }
  }

  // 상세 정보 크롤링
  async crawlItemDetails(itemId) {
    const clientInfo = this.getClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      console.log(
        `Crawling details for item ${itemId} with ${clientInfo.name}...`,
      );
      const url = this.config.detailUrl(itemId);

      const response = await clientInfo.client.get(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
        },
      });

      const $ = cheerio.load(response.data, { xmlMode: false });

      // 이미지 추출 - .swiper-slide img에서
      const images = [];
      $(".swiper-slide img").each((i, element) => {
        const src = $(element).attr("src");
        if (src && src.includes("penguin-auction.com/product/")) {
          // 쿼리 파라미터 제거
          const cleanSrc = src.split("?")[0];
          images.push(cleanSrc);
        }
      });

      // 제목 - h1.product-detail-title
      const title = $("h1.product-detail-title").text().trim();

      // 테이블에서 정보 추출
      let brand = "";
      let model = "";
      let material = "";
      let color = "";
      let accessories = "";
      let notes = "";

      $(".info table tr").each((i, row) => {
        const $row = $(row);
        const td = $row.find("td").text().trim();

        if (i === 3)
          brand = td; // Brand
        else if (i === 4)
          model = td; // Model
        else if (i === 7)
          material = td; // Material
        else if (i === 8)
          color = td; // Color
        else if (i === 9)
          accessories = td; // Accessories
        else if (i === 10) notes = td; // Other/Notes
      });
      // 여러 줄 정리
      notes = notes.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

      brand = await translator.translate(brand);
      model = await translator.translate(model);
      material = await translator.translate(material);
      color = await translator.translate(color);
      accessories = await translator.translate(accessories);
      notes = await translator.translate(notes);

      // 가격 추출 - .currency-tbl에서 현재가
      let price = null;
      $(".currency-tbl .tr").each((i, row) => {
        const $row = $(row);
        if (i === 2) {
          // 3번째 row = 현재가
          const priceText = $row.find(".td[data-stt-ignore]").text().trim();
          price = this.currencyToInt(priceText);
        }
      });

      // 상세 설명 생성 (요청된 형식)
      const descriptionParts = [];
      if (model) descriptionParts.push(`Model: ${model}`);
      if (material) descriptionParts.push(`Material: ${material}`);
      if (color) descriptionParts.push(`Color: ${color}`);
      if (accessories) descriptionParts.push(`Accessories: ${accessories}`);
      if (notes) {
        descriptionParts.push(notes);
      }

      const description = descriptionParts.join(", ");

      return {
        title: title || null,
        brand: brand || null,
        rank: null, // 필요하지 않음
        additional_images: JSON.stringify(images),
        description: description || "-",
        accessory_code: "",
        price: price || null,
        detail_info: {},
      };
    });
  }

  // 최대 페이지 번호 추출
  getLastPageNumber($) {
    try {
      const pagerContainer = $(this.config.crawlSelectors.paginationContainer);
      if (pagerContainer.length === 0) {
        return 1;
      }

      let maxPage = 1;
      // 모든 페이지 링크를 찾아서 최대값 추출
      pagerContainer.find("li a").each((i, element) => {
        const href = $(element).attr("href") || "";
        const match = href.match(/page=(\d+)/);
        if (match) {
          const pageNum = parseInt(match[1]);
          if (pageNum > maxPage) {
            maxPage = pageNum;
          }
        }
      });

      // "next" 링크도 확인
      pagerContainer.find("li.next a").each((i, element) => {
        const href = $(element).attr("href") || "";
        const match = href.match(/page=(\d+)/);
        if (match) {
          const pageNum = parseInt(match[1]);
          // next가 있으면 현재 페이지는 최소한 그 이전 페이지까지는 있음
          if (pageNum > maxPage) {
            maxPage = pageNum;
          }
        }
      });

      // pager-total에서도 확인 가능: "1-150竊?488餓뜸릎"
      const totalText = $(".pager-total").text();
      const totalMatch = totalText.match(/(\d+)餓/);
      if (totalMatch) {
        const totalItems = parseInt(totalMatch[1]);
        // 150개씩 보기로 설정되어 있으므로
        const calculatedMaxPage = Math.ceil(totalItems / 150);
        if (calculatedMaxPage > maxPage) {
          maxPage = calculatedMaxPage;
        }
      }

      console.log(`Extracted max page: ${maxPage}`);
      return maxPage;
    } catch (error) {
      console.error("Error getting last page number:", error);
      return 1;
    }
  }

  // 업데이트 크롤링 (전체 페이지 순회)
  async crawlUpdates() {
    try {
      const limit = pLimit(LIMIT1);

      const startTime = Date.now();
      console.log(
        `Starting Penguin Auction updates crawl at ${new Date().toISOString()}`,
      );

      // 로그인
      await this.login();

      console.log("Starting update crawl for all categories");

      // 첫 페이지로 전체 페이지 수 확인
      const clientInfo = this.getClient();
      const firstPageUrl =
        this.config.searchUrl + this.config.searchParams(null, 1);
      console.log(`Fetching first page: ${firstPageUrl}`);

      const firstPageResponse = await clientInfo.client.get(firstPageUrl, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
        },
      });

      const $first = cheerio.load(firstPageResponse.data, { xmlMode: false });
      const totalPages = this.getLastPageNumber($first);
      console.log(`Total pages for updates: ${totalPages}`);

      const allCrawledItems = [];

      // 첫 페이지 아이템 처리
      const firstPageItems = await this.extractUpdateItemsFromPage($first);
      allCrawledItems.push(...firstPageItems);
      console.log(`Processed ${firstPageItems.length} items from page 1`);

      // 나머지 페이지 병렬 처리
      if (totalPages > 1) {
        const pagePromises = [];
        for (let page = 2; page <= totalPages; page++) {
          pagePromises.push(
            limit(async () => {
              console.log(`Crawling update page ${page} of ${totalPages}`);
              return await this.crawlUpdatePage(null, page);
            }),
          );
        }

        const pageResults = await Promise.all(pagePromises);
        pageResults.forEach((pageItems) => {
          if (pageItems && pageItems.length > 0) {
            allCrawledItems.push(...pageItems);
          }
        });
      }

      if (allCrawledItems.length === 0) {
        console.log("No update items were crawled. Aborting operation.");
        return [];
      }

      console.log(
        `Update crawling completed. Total items: ${allCrawledItems.length}`,
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Update operation completed in ${this.formatExecutionTime(executionTime)}`,
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Update crawl failed:", error.message);
      return [];
    }
  }

  // 특정 페이지의 업데이트 정보 크롤링
  async crawlUpdatePage(categoryId, page) {
    const clientInfo = this.getClient();

    return this.retryOperation(async () => {
      console.log(`Crawling update page ${page} with ${clientInfo.name}...`);

      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await clientInfo.client.get(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
        },
        timeout: 5 * 1000,
      });

      const $ = cheerio.load(response.data, { xmlMode: false });
      const pageItems = await this.extractUpdateItemsFromPage($);

      console.log(
        `Processed ${pageItems.length} update items from page ${page} (${clientInfo.name})`,
      );

      return pageItems;
    });
  }

  // 페이지에서 업데이트 아이템 정보 추출
  async extractUpdateItemsFromPage($) {
    const items = [];
    const itemElements = $(this.config.crawlSelectors.itemContainer);

    console.log(`Found ${itemElements.length} items on update page`);

    if (itemElements.length === 0) {
      return [];
    }

    for (let i = 0; i < itemElements.length; i++) {
      const element = itemElements.eq(i);
      const item = this.extractUpdateItemInfo($, element);
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  // 업데이트용 아이템 정보 추출 (item_id와 starting_price만)
  extractUpdateItemInfo($, element) {
    try {
      // 아이템 ID 추출 (URL에서)
      const $link = element.find(this.config.crawlSelectors.itemLink);
      const href = $link.attr("href") || "";
      const match = href.match(/\/detail\/(\d+)\//);
      const itemId = match ? match[1] : null;

      if (!itemId) {
        return null;
      }

      // 가격 정보 추출 (현재가 우선)
      let startingPrice = null;
      let currentPrice = null;
      const priceRows = element.find(this.config.crawlSelectors.priceTable);

      if (priceRows.length >= 3) {
        // 2번째 row (index 1) = 시작가
        const startPriceRow = priceRows.eq(1);
        const startPriceCells = startPriceRow.find(".td[data-stt-ignore]");
        if (startPriceCells.length > 0) {
          startingPrice = this.currencyToInt(startPriceCells.text().trim());
        }

        // 3번째 row (index 2) = 현재가
        const currentPriceRow = priceRows.eq(2);
        const currentPriceCells = currentPriceRow.find(".td[data-stt-ignore]");
        if (currentPriceCells.length > 0) {
          currentPrice = this.currencyToInt(currentPriceCells.text().trim());
        }
      }

      // 스케줄 날짜 추출
      const scheduleText = element
        .find(this.config.crawlSelectors.scheduleText)
        .text()
        .trim();
      const scheduledDate = this.extractScheduleDate(scheduleText);

      return {
        item_id: itemId,
        starting_price: currentPrice || startingPrice, // 현재가 우선, 없으면 시작가
        scheduled_date: scheduledDate,
        original_scheduled_date: scheduledDate,
      };
    } catch (error) {
      console.error("Error extracting update item info:", error);
      return null;
    }
  }

  // 특정 아이템 ID의 업데이트 정보 크롤링
  async crawlUpdateWithId(itemId) {
    const clientInfo = this.getClient();

    return this.retryOperation(
      async () => {
        console.log(
          `Crawling update info for item ${itemId} with ${clientInfo.name}...`,
        );

        const url = this.config.detailUrl(itemId);

        const response = await clientInfo.client.get(url, {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,ja;q=0.7",
          },
          timeout: 5 * 1000,
        });

        const $ = cheerio.load(response.data, { xmlMode: false });

        // 가격 추출 - .currency-tbl에서 현재가
        let startingPrice = null;
        let currentPrice = null;

        $(".currency-tbl .tr").each((i, row) => {
          const $row = $(row);
          if (i === 1) {
            // 2번째 row = 시작가
            const priceText = $row.find(".td[data-stt-ignore]").text().trim();
            startingPrice = this.currencyToInt(priceText);
          } else if (i === 2) {
            // 3번째 row = 현재가
            const priceText = $row.find(".td[data-stt-ignore]").text().trim();
            currentPrice = this.currencyToInt(priceText);
          }
        });

        // 스케줄 날짜 추출
        const scheduleText = $(".countdown-time .text").text().trim();
        const scheduledDate = this.extractScheduleDate(scheduleText);

        return {
          item_id: itemId,
          starting_price: currentPrice || startingPrice,
          scheduled_date: scheduledDate,
          original_scheduled_date: scheduledDate,
        };
      },
      3,
      5 * 1000,
    );
  }

  // 여러 아이템 ID의 업데이트 정보 크롤링
  async crawlUpdateWithIds(itemIds) {
    try {
      console.log(`Starting update crawl for ${itemIds.length} items...`);

      const results = [];
      const limit = pLimit(LIMIT1); // 병렬 처리를 위한 제한 설정

      // 병렬 처리
      const promises = itemIds.map((itemId) =>
        limit(async () => {
          try {
            const result = await this.crawlUpdateWithId(itemId);
            if (result) {
              results.push(result);
            }
            return result;
          } catch (error) {
            console.error(`Error crawling update for item ${itemId}:`, error);
            return null;
          }
        }),
      );

      // 모든 결과 기다리기
      await Promise.all(promises);

      console.log(`Update crawl completed for ${results.length} items`);
      return results;
    } catch (error) {
      console.error("Update crawl with IDs failed:", error);
      return [];
    }
  }

  // Direct Bid 실행
  async directBid(item_id, price) {
    try {
      console.log(
        `Placing direct bid for item ${item_id} with price ${price}...`,
      );

      // 직접 연결 클라이언트 사용
      const clientInfo = this.getClient();

      // POST 요청 데이터 준비
      const bidData = new URLSearchParams();
      bidData.append("uid", item_id.toString());
      bidData.append("price", price.toString());

      console.log(`Bid data prepared: ${bidData.toString()}`);

      // 입찰 요청 전송
      const bidUrl = "https://penguin-auction.jp/auction/ajax_bid";
      console.log(`Sending bid request to: ${bidUrl}`);

      const bidResponse = await clientInfo.client.post(bidUrl, bidData, {
        timeout: 5000,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://penguin-auction.jp/auction/",
          Origin: "https://penguin-auction.jp",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
      });

      // 응답 확인
      if (bidResponse.status === 200 && bidResponse.data.status) {
        console.log(`Bid successful for item ${item_id} with price ${price}`);
        console.log(`Response message: ${bidResponse.data.message}`);
        return {
          success: true,
          message: bidResponse.data.message || "Bid placed successfully",
          data: bidResponse.data.data,
        };
      } else {
        const errorMessage =
          bidResponse.data.message || "Unknown error occurred";
        throw new Error(
          `Bid failed for item ${item_id} with price ${price}. Error: ${errorMessage}`,
        );
      }
    } catch (err) {
      console.error("Error placing bid:", err.message);
      return {
        success: false,
        message: "Bid failed",
        error: err.message,
      };
    }
  }
}

const penguinAucCrawler = new PenguinAucCrawler(penguinAucConfig);

module.exports = { penguinAucCrawler };
