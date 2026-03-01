// crawlers/brandAuc.js
const cheerio = require("cheerio");
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const LIMIT1 = 10;
const LIMIT2 = 10;

const brandAucConfig = {
  name: "BrandAuc",
  baseUrl: "https://member.brand-auc.com",
  loginCheckUrls: [
    "https://u.brand-auc.com/api/v1/member/shop",
    "https://member.brand-auc.com/auth/success",
  ],
  loginPageUrl: "https://member.brand-auc.com/login",
  loginPostUrl: "https://member.brand-auc.com/login.php",
  previewItemsApiUrl:
    "https://u.brand-auc.com/api/v1/auction/previewItems/list",
  detailItemApiUrl:
    "https://u.brand-auc.com/api/v1/auction/auctionItems/bag/1/",
  loginData: {
    userId: process.env.CRAWLER_EMAIL2,
    password: process.env.CRAWLER_PASSWORD2,
  },
  useMultipleClients: true, // 추가
  categoryTable: {
    Watch: "시계",
    Bag: "가방",
    "Precious metal": "귀금속",
    Clothing: "의류",
    Accessories: "악세서리",
    Tableware: "식기",
    Variety: "기타",
    "Painting･Art": "회화·미술품",
    Coin: "코인",
  },
};

const brandAucValueConfig = {
  name: "BrandAucValue",
  baseUrl: "https://e-auc.brand-auc.com",
  loginCheckUrls: ["https://e-auc.brand-auc.com/main"],
  loginPageUrl: "https://member.brand-auc.com/loginEauc",
  loginPostUrl: "https://member.brand-auc.com/login",
  marketPriceApiUrl:
    "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/list",
  detailItemApiUrl:
    "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/detail",
  loginData: {
    userId: process.env.CRAWLER_EMAIL2,
    password: process.env.CRAWLER_PASSWORD2,
  },
  useMultipleClients: true, // 추가
  categoryTable: {
    Watch: "시계",
    Bag: "가방",
    "Precious metal": "귀금속",
    Clothing: "의류",
    Accessories: "악세서리",
    Tableware: "식기",
    Variety: "기타",
    "Painting･Art": "회화·미술품",
    Coin: "코인",
  },
};

class BrandAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.currentLocale = "en"; // 언어 설정(영어)
  }

  // performLoginWithClient 구현 (부모 클래스에서 호출)
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} Brand Auction 로그인 중...`);

      // 로그인 페이지 가져오기
      const response = await clientInfo.client.get(this.config.loginPageUrl);

      // CSRF 토큰 추출
      const $ = cheerio.load(response.data, { xmlMode: true });
      const csrfToken = $('input[name="_csrf"]').val();

      if (!csrfToken) {
        throw new Error("CSRF token not found");
      }

      // Form 데이터 준비
      const formData = new URLSearchParams();
      formData.append("username", this.config.loginData.userId);
      formData.append("password", this.config.loginData.password);
      formData.append("_csrf", csrfToken);
      formData.append("client_id", "brandMember");
      formData.append("loginType", "login");
      formData.append("asbLogin", "on");

      // 로그인 요청
      await clientInfo.client.post(this.config.loginPageUrl, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: this.config.loginPageUrl,
        },
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        },
      });

      // 2. bid 로그인
      console.log(`${clientInfo.name} bid.brand-auc.com 시스템 로그인 중...`);
      const bidLoginUrl = "https://bid.brand-auc.com/loginPage";
      const bidFormData = new URLSearchParams();
      bidFormData.append("username", this.config.loginData.userId);
      bidFormData.append("password", this.config.loginData.password);
      bidFormData.append("_csrf", csrfToken);
      bidFormData.append("client_id", "brandVpaMember");
      bidFormData.append("loginType", "vpaLogin");

      await clientInfo.client.post(
        "https://member.brand-auc.com/login",
        bidFormData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: bidLoginUrl,
          },
          maxRedirects: 10,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        },
      );

      // bid 로그인 페이지 가져오기
      await clientInfo.client.get("https://member.brand-auc.com/auth/success");

      // 로그인 후 검증
      const isValid = await this.loginCheckWithClient(clientInfo);
      if (!isValid) {
        throw new Error("Login verification failed");
      }

      return true;
    });
  }

  // 기존 performLogin 오버라이드 (부모 클래스 호환성)
  async performLogin() {
    // 직접 연결 클라이언트로 로그인
    const directClient = this.getDirectClient();
    return await this.performLoginWithClient(directClient);
  }

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];
      const size = 1000; // 한 페이지당 항목 수

      // Live 경매, Direct 경매, Instant(바로 구매) 모두 수집
      const bidTypes = [
        { type: "live", otherCds: "1" }, // Live 경매는 기존 방식 유지
        { type: "direct" }, // Direct 경매는 새로운 API 사용
        { type: "instant", otherCds: "3,5,6" }, // 바로 구매 (모아/즉매)
      ];

      for (const bidConfig of bidTypes) {
        try {
          console.log(`Starting crawl for bid type: ${bidConfig.type}`);

          // 현재 bid_type 설정
          this.currentBidType = bidConfig.type;

          if (bidConfig.type === "live") {
            // 기존 Live 경매 크롤링 방식
            const clientInfo = this.getClient();

            const firstPageResponse = await clientInfo.client.get(
              this.config.previewItemsApiUrl,
              {
                params: {
                  page: 0,
                  size: size,
                  gamenId: "B02-01",
                  otherCds: bidConfig.otherCds,
                },
                headers: {
                  Accept: "application/json",
                },
              },
            );

            const totalPages = firstPageResponse.data.totalPages;
            const totalItems = firstPageResponse.data.totalElements;

            console.log(
              `Found ${totalItems} items across ${totalPages} pages for bid type: ${bidConfig.type}`,
            );

            // 첫 페이지 아이템 처리
            const firstPageItems = await this.processItemsPage(
              firstPageResponse.data.content,
              existingIds,
              bidConfig.type,
              true,
            );
            allCrawledItems.push(...firstPageItems);
            // 나머지 페이지 병렬 처리
            const limit = pLimit(LIMIT2);
            const pagePromises = [];

            for (let page = 1; page < totalPages; page++) {
              pagePromises.push(
                limit(async () => {
                  console.log(
                    `Crawling page ${page + 1} of ${totalPages} for bid type: ${
                      bidConfig.type
                    }`,
                  );

                  const pageClientInfo = this.getClient();

                  const response = await pageClientInfo.client.get(
                    this.config.previewItemsApiUrl,
                    {
                      params: {
                        page: page,
                        size: size,
                        gamenId: "B02-01",
                        otherCds: bidConfig.otherCds,
                      },
                      headers: {
                        Accept: "application/json",
                      },
                    },
                  );

                  if (response.data && response.data.content) {
                    const pageItems = await this.processItemsPage(
                      response.data.content,
                      existingIds,
                      bidConfig.type,
                      true, // skipImageProcessing = true
                    );

                    console.log(
                      `Processed ${pageItems.length} items from page ${
                        page + 1
                      } with ${pageClientInfo.name}`,
                    );

                    return pageItems;
                  }
                  return [];
                }),
              );
            }

            const pageResults = await Promise.all(pagePromises);
            pageResults.forEach((pageItems) => {
              if (pageItems && pageItems.length > 0) {
                allCrawledItems.push(...pageItems);
              }
            });
          } else if (bidConfig.type === "direct") {
            // Direct 경매 크롤링
            const clientInfo = this.getClient();

            await clientInfo.cookieJar.setCookie(
              "brand_language=en",
              "https://bid.brand-auc.com",
            );

            // 경매 정보 가져오기
            const auctionInfoResponse = await clientInfo.client.get(
              "https://bid.brand-auc.com/api/v1/brand-bid/com/auction-info",
              {
                headers: {
                  Accept: "application/json",
                  Referer: "https://bid.brand-auc.com/",
                  "X-Requested-With": "XMLHttpRequest",
                },
              },
            );

            // 경매 날짜 정보 저장
            const auctionDates = auctionInfoResponse.data.nyuShimeYmdList;
            this.auctionKaisu = auctionInfoResponse.data.kaisaiKaisu;

            if (auctionDates.length === 0) {
              throw new Error("Failed to get auction dates");
            }

            this.auctionDate = auctionDates[0];

            // Direct 아이템 가져오기
            const firstPageResponse = await clientInfo.client.get(
              "https://bid.brand-auc.com/api/v1/brand-bid/items/list",
              {
                params: {
                  page: 0,
                  size: size,
                  viewType: 1,
                  status: 1, // 활성 상품만
                  gamenId: "B201-01",
                },
                headers: {
                  Accept: "application/json",
                  Referer: "https://bid.brand-auc.com/",
                  "X-Requested-With": "XMLHttpRequest",
                },
              },
            );

            const totalPages = firstPageResponse.data.totalPages;
            const totalItems = firstPageResponse.data.totalElements;

            console.log(
              `Found ${totalItems} items across ${totalPages} pages for bid type: ${bidConfig.type}`,
            );

            // 첫 페이지 아이템 처리
            const firstPageItems = await this.processItemsPage(
              firstPageResponse.data.content,
              existingIds,
              bidConfig.type,
              true,
            );
            allCrawledItems.push(...firstPageItems);

            // 나머지 페이지 병렬 처리
            const directLimit = pLimit(LIMIT2);
            const directPagePromises = [];

            for (let page = 1; page < totalPages; page++) {
              directPagePromises.push(
                directLimit(async () => {
                  console.log(
                    `Crawling direct page ${page + 1} of ${totalPages}`,
                  );

                  const pageClientInfo = this.getClient();

                  const response = await pageClientInfo.client.get(
                    "https://bid.brand-auc.com/api/v1/brand-bid/items/list",
                    {
                      params: {
                        page: page,
                        size: size,
                        viewType: 1,
                        status: 1,
                        gamenId: "B201-01",
                      },
                      headers: {
                        Accept: "application/json",
                        Referer: "https://bid.brand-auc.com/",
                        "X-Requested-With": "XMLHttpRequest",
                      },
                    },
                  );

                  if (response.data && response.data.content) {
                    const pageItems = await this.processItemsPage(
                      response.data.content,
                      existingIds,
                      bidConfig.type,
                      true, // skipImageProcessing = true
                    );

                    console.log(
                      `Processed ${pageItems.length} direct items from page ${
                        page + 1
                      } with ${pageClientInfo.name}`,
                    );

                    return pageItems;
                  }
                  return [];
                }),
              );
            }

            const directPageResults = await Promise.all(directPagePromises);
            directPageResults.forEach((pageItems) => {
              if (pageItems && pageItems.length > 0) {
                allCrawledItems.push(...pageItems);
              }
            });
          } else if (bidConfig.type === "instant") {
            // 바로 구매(Instant) 크롤링 - Live와 같은 previewItems API 사용
            const clientInfo = this.getClient();

            const firstPageResponse = await clientInfo.client.get(
              this.config.previewItemsApiUrl,
              {
                params: {
                  page: 0,
                  size: size,
                  gamenId: "B02-01",
                  otherCds: bidConfig.otherCds,
                },
                headers: {
                  Accept: "application/json",
                },
              },
            );

            const totalPages = firstPageResponse.data.totalPages;
            const totalItems = firstPageResponse.data.totalElements;

            console.log(
              `Found ${totalItems} items across ${totalPages} pages for bid type: ${bidConfig.type}`,
            );

            // 첫 페이지 아이템 처리
            const firstPageItems = await this.processItemsPage(
              firstPageResponse.data.content,
              existingIds,
              bidConfig.type,
              true,
            );
            allCrawledItems.push(...firstPageItems);

            // 나머지 페이지 병렬 처리
            const instantLimit = pLimit(LIMIT2);
            const instantPagePromises = [];

            for (let page = 1; page < totalPages; page++) {
              instantPagePromises.push(
                instantLimit(async () => {
                  console.log(
                    `Crawling instant page ${page + 1} of ${totalPages}`,
                  );

                  const pageClientInfo = this.getClient();

                  const response = await pageClientInfo.client.get(
                    this.config.previewItemsApiUrl,
                    {
                      params: {
                        page: page,
                        size: size,
                        gamenId: "B02-01",
                        otherCds: bidConfig.otherCds,
                      },
                      headers: {
                        Accept: "application/json",
                      },
                    },
                  );

                  if (response.data && response.data.content) {
                    const pageItems = await this.processItemsPage(
                      response.data.content,
                      existingIds,
                      bidConfig.type,
                      true,
                    );

                    console.log(
                      `Processed ${pageItems.length} instant items from page ${
                        page + 1
                      } with ${pageClientInfo.name}`,
                    );

                    return pageItems;
                  }
                  return [];
                }),
              );
            }

            const instantPageResults = await Promise.all(instantPagePromises);
            instantPageResults.forEach((pageItems) => {
              if (pageItems && pageItems.length > 0) {
                allCrawledItems.push(...pageItems);
              }
            });
          }
        } catch (error) {
          console.error(
            `Failed to crawl bid type ${bidConfig.type}:`,
            error.message,
          );
          // 해당 bid type 실패해도 다음 bid type 계속 진행
          continue;
        }
      }

      // 전체 이미지 일괄 처리
      console.log(
        `Starting image processing for ${allCrawledItems.length} items...`,
      );
      const itemsWithImages = allCrawledItems.filter((item) => item.image);
      const finalProcessedItems = await processImagesInChunks(
        itemsWithImages,
        "products",
        3,
        "brand",
      );

      // 이미지가 없는 아이템들도 포함
      const itemsWithoutImages = allCrawledItems.filter((item) => !item.image);
      const allFinalItems = [...finalProcessedItems, ...itemsWithoutImages];

      console.log(`Total items processed: ${allFinalItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Crawl operation completed in ${this.formatExecutionTime(
          executionTime,
        )}`,
      );

      return allFinalItems;
    } catch (error) {
      console.error("Crawl failed:", error.message);
      return [];
    }
  }

  async processItemsPage(
    items,
    existingIds,
    bidType = "live",
    skipImageProcessing = false,
  ) {
    // 아이템 필터링
    const filteredItems = [];

    for (const item of items) {
      // Live 경매일 경우 상태 확인
      if (
        bidType === "live" &&
        (item.jotaiEn === "SOLD BY HOLD" || item.jotaiEn === "SOLD")
      ) {
        continue;
      }

      // Instant(바로 구매)일 경우 Available 상태만 허용
      if (bidType === "instant" && item.jotaiEn !== "Available") {
        continue;
      }

      // 이미 처리된 아이템 제외
      if (item.kekkaKbn && item.kekkaKbn == 5) {
        continue;
      } else if (existingIds.has(item.uketsukeBng)) {
        filteredItems.push({
          item_id: item.uketsukeBng,
          starting_price: item.genzaiKng || item.startKng || 0,
        });
        continue;
      }

      // 필터 통과한 아이템 기본 정보 추출
      const processedItem = this.extractItemInfo(item, bidType);
      if (processedItem) filteredItems.push(processedItem);
    }

    // 필터링된 아이템에 대해 추가 처리 (이미지 처리 등)
    let finalItems;
    if (skipImageProcessing) {
      finalItems = filteredItems;
    } else {
      finalItems = await processImagesInChunks(
        filteredItems,
        "products",
        3,
        "brand",
      );
    }

    return finalItems;
  }

  extractItemInfo(item, bidType = "live") {
    // 공통 필드 및 타입별 다른 필드 설정
    const genreField = bidType === "direct" ? "genre" : "genreEn";
    const titleField = bidType === "direct" ? "shohin" : "shohinEn";
    const category =
      this.config.categoryTable[item[genreField]] || item[genreField];

    // Coin 카테고리 필터링
    if (item[genreField] === "Coin") {
      return null;
    }

    // lighter 포함된 아이템 필터링
    const title = item[titleField] || "";
    if (title.toLowerCase().includes("lighter")) {
      return null;
    }

    // 날짜 처리 개선
    let original_scheduled_date;
    let scheduled_date;

    if (bidType === "direct") {
      // direct 타입은 미리 저장된 auctionDate 사용
      if (item.seriEndHm && this.auctionDate) {
        // seriEndHm이 있는 경우: auctionDate의 날짜 + seriEndHm의 시간 결합
        try {
          const kstAuctionDate = this.convertToKST(this.auctionDate);
          const dateOnly = kstAuctionDate.split("T")[0]; // YYYY-MM-DD 추출

          // seriEndHm ("16:10") + ":00" = "16:10:00"
          const timeWithSeconds = item.seriEndHm + ":00";

          // 날짜와 시간 결합 후 extractDate로 형식 통일
          const combinedDateTime = `${dateOnly} ${timeWithSeconds}`;
          original_scheduled_date = this.extractDate(combinedDateTime);
        } catch (error) {
          console.warn(
            `Error creating scheduled_date with seriEndHm for item ${item.uketsukeBng}:`,
            error.message,
          );
          // seriEndHm 처리 실패시 기존 방식 사용
          original_scheduled_date = this.extractDate(
            this.convertToKST(this.auctionDate),
          );
        }
      } else {
        // seriEndHm이 없는 경우: 기존 방식 그대로
        original_scheduled_date = this.extractDate(
          this.convertToKST(this.auctionDate),
        );
      }
      scheduled_date = original_scheduled_date;
    } else if (bidType === "instant") {
      // instant 타입은 아이템별 kaisaiYmd 사용 (시간 필터링 없음)
      original_scheduled_date = this.extractDate(
        this.convertToKST(item.kaisaiYmd),
      );
      scheduled_date = original_scheduled_date;
    } else {
      // live 타입은 아이템별 값 사용
      original_scheduled_date = this.extractDate(
        this.convertToKST(item.kaisaiYmd),
      );
      scheduled_date = this.getPreviousDayAt18(original_scheduled_date);

      // 이미 지난 경매는 필터링
      if (!this.isAuctionTimeValid(scheduled_date)) {
        return null;
      }
    }

    const original_title = this.convertFullWidthToAscii(item[titleField] || "");

    let image =
      item?.photoUrl || item?.photoAlbumUrl || item?.photoZoomUrl || null;
    image = image ? image.replace(/(brand_img\/)(\d+)/, "$17") : null;

    return {
      item_id: item.uketsukeBng,
      original_title: original_title,
      title: this.removeLeadingBrackets(original_title),
      brand: this.convertFullWidthToAscii(item.maker || ""),
      rank: this.convertFullWidthToAscii(item.hyoka || ""),
      starting_price:
        bidType === "instant"
          ? item.kakaku || 0
          : item.genzaiKng || item.startKng || 0,
      image: image,
      category: category,
      original_scheduled_date: original_scheduled_date,
      scheduled_date: scheduled_date,
      bid_type: bidType,
      auc_num: "2",

      // 상세 정보 요청 시 필요한 데이터 - additional_info에 저장
      additional_info:
        bidType === "instant"
          ? {
              kaijoCd: item.kaijoCd,
              kaisaiKaisu: item.kaisaiKaisu,
              invTorokuBng: item.invTorokuBng,
              lockVersion: item.lockVersion || 0,
              genreCd: item.genreCd,
              toriatsukaiKeitai: item.toriatsukaiKeitai,
            }
          : bidType === "direct"
            ? {
                kaisaiKaisu: this.auctionKaisu,
                kaijoKbn: item.kaijoKbn || 1,
              }
            : {
                kaijoCd: item.kaijoCd,
                kaisaiKaisu: item.kaisaiKaisu,
              },
    };
  }

  async crawlItemDetails(itemId, item) {
    try {
      const clientInfo = this.getClient();
      await this.loginWithClient(clientInfo);

      // additional_info에서 데이터 가져오기
      const additionalInfo =
        typeof item.additional_info === "string"
          ? JSON.parse(item.additional_info)
          : item.additional_info || {};
      const kaisaiKaisu = additionalInfo.kaisaiKaisu;
      const kaijoCd = additionalInfo.kaijoCd || 1;

      // 상세 정보 URL 구성 (올바른 kaisaiKaisu 사용)
      const detailUrl = `https://u.brand-auc.com/api/v1/auction/auctionItems/bag/${kaijoCd}/${kaisaiKaisu}/${itemId}/B02-01`;

      // 상세 정보 요청
      const response = await clientInfo.client.get(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://u.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.data) {
        throw new Error(`Failed to get details for item ${itemId}`);
      }

      const detail = response.data;

      // 이미지 URL 목록 처리
      const images = [...detail.fileList, ...detail.fileListAdmin] || [];
      const formattedImages = images.map((url) =>
        url.replace(/(brand_img\/)(\d+)/, "$17"),
      );

      // 상품 상태 메모 처리
      const bikoList = detail.bikoList || [];
      let description = bikoList.join("\n") || "-";

      // 부속품 정보 처리
      const accessoryParts = [];
      if (detail.hosho && detail.hosho !== "なし")
        accessoryParts.push(`보증서: ${detail.hosho}`);
      if (detail.hako && detail.hako !== "なし")
        accessoryParts.push(`상자: ${detail.hako}`);
      if (detail.hozon && detail.hozon !== "なし")
        accessoryParts.push(`보존 케이스: ${detail.hozon}`);
      if (detail.strap && detail.strap !== "なし")
        accessoryParts.push(`스트랩: ${detail.strap}`);
      if (detail.kanadeKey && detail.kanadeKey !== "なし")
        accessoryParts.push(`열쇠: ${detail.kanadeKey}`);
      if (detail.seal && detail.seal !== "なし")
        accessoryParts.push(`태그: ${detail.seal}`);
      if (detail.shuppinBiko2List && detail.shuppinBiko2List.length > 0)
        accessoryParts.push(`기타: ${detail.shuppinBiko2List.join(", ")}`);

      const accessoryCode = accessoryParts.join(", ") || "";

      return {
        additional_images:
          formattedImages.length > 0 ? JSON.stringify(formattedImages) : null,
        description: description + accessoryCode,
        accessory_code: "",
      };
    } catch (error) {
      console.error(
        `Error fetching details for item ${itemId}:`,
        error.message,
      );
      return {
        additional_images: null,
        description: "-",
        accessory_code: "",
      };
    }
  }

  async crawlUpdates() {
    try {
      const limit = pLimit(LIMIT1);
      const startTime = Date.now();
      console.log(`Starting updates crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      // auctionDate 설정 (기존 crawlAllItems에서 가져온 로직)
      const clientInfo = this.getClient();

      await clientInfo.cookieJar.setCookie(
        "brand_language=en",
        "https://bid.brand-auc.com",
      );

      // 경매 정보 가져오기
      const auctionInfoResponse = await clientInfo.client.get(
        "https://bid.brand-auc.com/api/v1/brand-bid/com/auction-info",
        {
          headers: {
            Accept: "application/json",
            Referer: "https://bid.brand-auc.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
      );

      // 경매 날짜 정보 저장
      const auctionDates = auctionInfoResponse?.data?.nyuShimeYmdList;
      this.auctionKaisu = auctionInfoResponse?.data?.kaisaiKaisu;

      // 경매가 열리지 않은 경우
      if (!auctionDates?.length) {
        return [];
      }

      this.auctionDate = auctionDates[0];

      const allCrawledItems = [];
      const size = 1000; // 한 페이지당 항목 수

      console.log(`Starting update crawl for direct auctions`);

      // 첫 페이지 요청
      const firstPageResponse = await clientInfo.client.get(
        "https://bid.brand-auc.com/api/v1/brand-bid/items/list",
        {
          params: {
            page: 0,
            size: size,
            viewType: 1,
            gamenId: "B201-01",
          },
          headers: {
            Accept: "application/json",
            Referer: "https://bid.brand-auc.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
      );

      const totalPages = firstPageResponse.data.totalPages;
      const totalItems = firstPageResponse.data.totalElements;

      console.log(
        `Found ${totalItems} items across ${totalPages} pages for update crawl`,
      );

      // 현재 bid_type 설정
      this.currentBidType = "direct";

      // 첫 페이지 아이템 처리
      const firstPageItems = await this.processUpdateItemsPage(
        firstPageResponse.data.content,
        "direct",
      );
      allCrawledItems.push(...firstPageItems);

      // 나머지 페이지를 5개씩 그룹으로 병렬 처리
      const pageGroups = [];
      for (let page = 1; page < totalPages; page++) {
        pageGroups.push(page);
      }

      const results = await Promise.all(
        pageGroups.map((page) =>
          limit(async () => {
            console.log(`Crawling update page ${page + 1} of ${totalPages}`);

            const pageClientInfo = this.getClient();

            const response = await pageClientInfo.client.get(
              "https://bid.brand-auc.com/api/v1/brand-bid/items/list",
              {
                params: {
                  page: page,
                  size: size,
                  viewType: 1,
                  gamenId: "B201-01",
                },
                headers: {
                  Accept: "application/json",
                  Referer: "https://bid.brand-auc.com/",
                  "X-Requested-With": "XMLHttpRequest",
                },
              },
            );

            if (response.data && response.data.content) {
              const pageItems = await this.processUpdateItemsPage(
                response.data.content,
                "direct",
              );

              console.log(
                `Processed ${pageItems.length} update items from page ${
                  page + 1
                } with ${pageClientInfo.name}`,
              );

              return pageItems;
            }
            return [];
          }),
        ),
      );

      // 결과를 모두 allCrawledItems에 추가
      results.forEach((pageItems) => {
        allCrawledItems.push(...pageItems);
      });

      console.log(`Total update items processed: ${allCrawledItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Update crawl operation completed in ${this.formatExecutionTime(
          executionTime,
        )}`,
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Update crawl failed:", error);
      return [];
    }
  }

  async processUpdateItemsPage(items, bidType = "live") {
    // 필요한 정보만 추출
    const updateItems = [];

    for (const item of items) {
      // Live 경매일 경우 상태 확인
      if (
        bidType === "live" &&
        (item.jotaiEn === "SOLD BY HOLD" || item.jotaiEn === "SOLD")
      ) {
        continue;
      }

      // 필터링된 아이템들에 대해 간소화된 정보 추출
      const processedItem = this.extractUpdateItemInfo(item);
      if (processedItem) updateItems.push(processedItem);
    }

    return updateItems;
  }

  extractUpdateItemInfo(item) {
    let scheduled_date = null;

    try {
      if (this.auctionDate) {
        if (item.seriEndHm) {
          // seriEndHm이 있는 경우: auctionDate의 날짜 + seriEndHm의 시간 결합
          const kstAuctionDate = this.convertToKST(this.auctionDate);
          const dateOnly = kstAuctionDate.split("T")[0]; // YYYY-MM-DD 추출

          // seriEndHm ("16:10") + ":00" = "16:10:00"
          const timeWithSeconds = item.seriEndHm + ":00";

          // 날짜와 시간 결합 후 extractDate로 형식 통일
          const combinedDateTime = `${dateOnly} ${timeWithSeconds}`;
          scheduled_date = this.extractDate(combinedDateTime);
        } else {
          // seriEndHm이 없는 경우: 기존 방식 그대로
          scheduled_date = this.extractDate(
            this.convertToKST(this.auctionDate),
          );
        }
      }
    } catch (error) {
      console.warn(
        `Error creating scheduled_date for item ${item.uketsukeBng}:`,
        error.message,
      );
      scheduled_date = null;
    }

    return {
      item_id: item.uketsukeBng,
      starting_price: item.genzaiKng || item.startKng || 0,
      scheduled_date: scheduled_date,
      original_scheduled_date: scheduled_date,
    };
  }

  async directBid(item_id, price) {
    try {
      // 직접 연결 클라이언트 사용
      const clientInfo = this.getClient();

      // XSRF 토큰 추출 (쿠키에서)
      const cookies = await clientInfo.cookieJar.getCookies(
        "https://bid.brand-auc.com",
      );
      const xsrfToken = cookies.find(
        (cookie) => cookie.key === "XSRF-TOKEN",
      )?.value;

      if (!xsrfToken) {
        throw new Error("XSRF token not found in cookies");
      }

      try {
        // 첫 번째 API 호출 시도 (기존 방식)
        const response = await clientInfo.client.post(
          "https://bid.brand-auc.com/api/v1/brand-bid/jizen-nyusatsu/",
          {
            uketsukeBng: item_id,
            kaijoKbn: 1,
            nyusatsuKng: price,
          },
          {
            timeout: 5000,
            headers: {
              "Content-Type": "application/json",
              Referer: "https://bid.brand-auc.com/",
              "X-Requested-With": "XMLHttpRequest",
              "X-XSRF-TOKEN": xsrfToken,
            },
          },
        );

        // 첫 번째 API 성공
        if (response.status === 201) {
          return {
            success: true,
            message: "Bid successful",
            data: response.data,
          };
        }

        // 첫 번째 API 실패 (201이 아닌 응답)
        throw new Error("First API endpoint failed");
      } catch (firstApiError) {
        console.log("First API failed, trying alternative endpoint...");

        // 두 번째 API 호출 시도 (대체 API)
        const altResponse = await clientInfo.client.post(
          "https://bid.brand-auc.com/api/v1/brand-bid/com/bid?gamenId=B201-01&viewType=1",
          {
            uketsukeBng: item_id,
            nyusatsuKng: price,
            startKng: 0,
            kaijoKbn: 1,
          },
          {
            timeout: 5000,
            headers: {
              "Content-Type": "application/json",
              Referer: "https://bid.brand-auc.com/",
              "X-Requested-With": "XMLHttpRequest",
              "X-XSRF-TOKEN": xsrfToken,
            },
          },
        );

        // 두 번째 API 응답 확인
        if (altResponse.status === 200 || altResponse.status === 201) {
          return {
            success: true,
            message: "Bid successful (alternative method)",
            data: altResponse.data,
          };
        } else {
          throw new Error("Bid failed with alternative endpoint");
        }
      }
    } catch (error) {
      console.error(
        `Error placing direct bid for item ${item_id}:`,
        error.message,
      );
      return {
        success: false,
        message: "Bid failed",
        error: error.message,
      };
    }
  }

  async liveBid(item_id, price) {
    return await this.retryOperation(
      async () => {
        // 로그인 상태 확인
        await this.login();

        // 직접 연결 클라이언트 사용
        const clientInfo = this.getClient();

        // XSRF 토큰 추출 (쿠키에서)
        const cookies = await clientInfo.cookieJar.getCookies(
          "https://u.brand-auc.com/",
        );
        const xsrfToken = cookies.find(
          (cookie) => cookie.key === "XSRF-TOKEN",
        )?.value;

        if (!xsrfToken) {
          throw new Error("XSRF token not found in cookies");
        }

        const response = await clientInfo.client.post(
          "https://u.brand-auc.com/api/v1/auction/nyusatsu/create",
          {
            uketsukeBng: item_id,
            nyuKng: price,
            nyuLockVersion: null,
          },
          {
            timeout: 5000,
            params: {
              gamenId: "B02-03",
            },
            headers: {
              "Content-Type": "application/json",
              "accept-encoding": "gzip, deflate, br, zstd",
              Referer: "hhttps://u.brand-auc.com/",
              "X-XSRF-TOKEN": xsrfToken,
            },
          },
        );

        // 첫 번째 API 성공
        if (response.status === 201) {
          return {
            success: true,
            message: "Bid successful",
            data: response.data,
          };
        } else {
          throw new Error("Bid failed with status " + response.status);
        }
      },
      3,
      10 * 1000,
    ).catch((error) => {
      console.error(`Error placing bid for item ${item_id}:`, error.message);
      return {
        success: false,
        message: "Bid failed",
        error: error.message,
      };
    });
  }

  /**
   * 바로 구매 (Instant Buy) - BrandAuc 모아/즉매 구매
   * @param {number} invTorokuBng - 등록번호 (invTorokuBng from crawl data)
   * @param {number} comLockVersion - comLockVersion (from crawl data, default 0)
   * @param {string} genreCd - 장르 코드 (from crawl data)
   * @returns {Object} { success, message, data }
   */
  async instantBuy(invTorokuBng, comLockVersion = 0, genreCd) {
    return await this.retryOperation(
      async () => {
        // 로그인 상태 확인
        await this.login();

        // 직접 연결 클라이언트 사용
        const clientInfo = this.getClient();

        // XSRF 토큰 추출 (쿠키에서)
        const cookies = await clientInfo.cookieJar.getCookies(
          "https://u.brand-auc.com/",
        );
        const xsrfToken = cookies.find(
          (cookie) => cookie.key === "XSRF-TOKEN",
        )?.value;

        if (!xsrfToken) {
          throw new Error("XSRF token not found in cookies");
        }

        const itemUrl = `https://u.brand-auc.com/previewDetailItem?genreCd=${genreCd}&torokuBng=${invTorokuBng}`;

        const response = await clientInfo.client.post(
          "https://u.brand-auc.com/api/v1/negotiations/tempOrder",
          {
            torokuBng: invTorokuBng,
            comLockVersion: comLockVersion,
            shodanLockVersion: null,
            url: itemUrl,
          },
          {
            timeout: 10000,
            headers: {
              "Content-Type": "application/json",
              "accept-encoding": "gzip, deflate, br, zstd",
              Referer: "https://u.brand-auc.com/",
              "X-XSRF-TOKEN": xsrfToken,
            },
          },
        );

        if (response.status === 200 || response.status === 201) {
          return {
            success: true,
            message: "Instant purchase successful",
            data: response.data,
          };
        } else {
          throw new Error(
            "Instant purchase failed with status " + response.status,
          );
        }
      },
      3,
      10 * 1000,
    ).catch((error) => {
      console.error(
        `Error instant buying item ${invTorokuBng}:`,
        error.message,
      );
      return {
        success: false,
        message: "Instant purchase failed",
        error: error.message,
      };
    });
  }

  async addWishlist(item_id, favorite_number = "A", kaisaiKaisu = 0) {
    try {
      // 로그인 상태 확인
      await this.login();

      // 직접 연결 클라이언트 사용
      const clientInfo = this.getClient();

      // XSRF 토큰 추출 (쿠키에서)
      const cookies = await clientInfo.cookieJar.getCookies(
        "https://u.brand-auc.com/",
      );
      const xsrfToken = cookies.find(
        (cookie) => cookie.key === "XSRF-TOKEN",
      )?.value;

      if (!xsrfToken) {
        throw new Error("XSRF token not found in cookies");
      }

      const response = await clientInfo.client.post(
        "https://u.brand-auc.com/api/v1/auction/mylists/create",
        {
          kaijoCd: 1,
          kaisaiKaisu: kaisaiKaisu,
          uketsukeBng: item_id,
          favoriteAorB: favorite_number,
          favoriteOnOrOff: true,
          lockVersion: null,
        },
        {
          params: {
            gamenId: "B02-03",
          },
          headers: {
            "Content-Type": "application/json",
            "accept-encoding": "gzip, deflate, br, zstd",
            Referer: "hhttps://u.brand-auc.com/",
            "X-XSRF-TOKEN": xsrfToken,
          },
        },
      );

      // 첫 번째 API 성공
      if (response.status === 201) {
        return {
          success: true,
          message: "Wishlist successful",
          data: response.data,
        };
      } else {
        throw new Error("Wishlist failed with status " + response.status);
      }
    } catch (error) {
      console.error(
        `Error adding wishlist for item ${item_id}:`,
        error.message,
      );
      return {
        success: false,
        message: "Wishlist failed",
        error: error.message,
      };
    }
  }

  async crawlInvoices() {
    try {
      console.log("Starting to crawl brand auction invoices...");

      // 로그인 확인
      await this.login();

      // 직접 연결 클라이언트 사용
      const clientInfo = this.getClient();

      // 청구서 페이지 요청
      const url = "https://u.brand-auc.com/api/v1/auction/cal/calList";
      const response = await clientInfo.client.get(url, {
        params: {
          sort: "",
          pageNumber: 0,
          page: 0,
          size: 20,
          kaisaiYmdFrom: "",
          kaisaiYmdTo: "",
          pdfKbn: "",
        },
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://u.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      // 응답 데이터 확인
      if (!response.data || !response.data.content) {
        console.log("No invoice data found");
        return [];
      }

      console.log(`Found ${response.data.content.length} invoice records`);

      const invoices = [];

      // 각 항목에서 필요한 정보 추출
      for (const item of response.data.content) {
        // 날짜 추출
        const date = this.extractDate(item.kaisaiYmd);

        // 경매 번호는 2로 고정 (BrandAuc의 식별자)
        const auc_num = "2";

        // 상태 추출
        let status = "unpaid";
        if (item.nyukinJyokyoKbn === 9 || item.nyukinJyokyoEn === "Paid") {
          status = "paid";
        } else if (
          item.nyukinJyokyoKbn === 1 ||
          item.nyukinJyokyoEn === "Partialy Paid"
        ) {
          status = "partial";
        }

        // 파일 이름에서 경매 회차 추출 (참고용)
        let auctionRound = null;
        if (item.fileName) {
          const roundMatch = item.fileName.match(
            /(\d+)(?:st|nd|rd|th)_Invoice/,
          );
          if (roundMatch) {
            auctionRound = roundMatch[1];
          }
        }

        // amount는 응답에 없으므로 비워둠
        invoices.push({
          date,
          auc_num,
          status,
          amount: null,
          auction_round: auctionRound,
        });
      }

      console.log(`Successfully processed ${invoices.length} invoices`);
      return invoices;
    } catch (error) {
      console.error("Error crawling brand auction invoices:", error.message);
      return [];
    }
  }

  async crawlUpdateWithId(itemId) {
    return this.retryOperation(async () => {
      console.log(`Crawling update info for item ${itemId}...`);

      const clientInfo = this.getClient();

      // 상세 정보 URL 구성 (원본 아이템의 정보 사용)
      const detailUrl = `https://bid.brand-auc.com/api/v1/brand-bid/items/detail?uketsukeBng=${itemId}`;

      const response = await clientInfo.client.get(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://bid.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      // 응답 데이터 파싱
      const detailDatas = response.data?.content;
      if (!detailDatas || detailDatas.length === 0) {
        console.warn(`No detail data found for item ${itemId}`);
        return null;
      }
      const detailData = detailDatas[0];

      // 필요한 정보 추출 (id와 가격만)
      const price = detailData.genzaiKng || detailData.startKng || 0;

      return {
        item_id: itemId,
        starting_price: price,
      };
    });
  }

  async crawlUpdateWithIds(itemIds) {
    try {
      console.log(`Starting update crawl for ${itemIds.length} items...`);

      // 로그인
      // await this.login();

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
            console.error(
              `Error crawling update for item ${itemId}:`,
              error.message,
            );
            return [];
          }
        }),
      );

      // 모든 결과 기다리기
      await Promise.all(promises);

      console.log(`Update crawl completed for ${results.length} items`);
      return results;
    } catch (error) {
      console.error("Update crawl with IDs failed:", error.message);
      return [];
    }
  }
}

class BrandAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.currentLocale = "en"; // 언어 설정(영어)
  }

  // performLoginWithClient 구현 (부모 클래스에서 호출)
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} Brand Auction Value 로그인 중...`);

      // 로그인 페이지 가져오기
      const response = await clientInfo.client.get(this.config.loginPageUrl);

      // CSRF 토큰 추출
      const $ = cheerio.load(response.data, { xmlMode: true });
      const csrfToken = $('input[name="_csrf"]').val();

      if (!csrfToken) {
        throw new Error("CSRF token not found");
      }

      // Form 데이터 준비
      const formData = new URLSearchParams();
      formData.append("username", this.config.loginData.userId);
      formData.append("password", this.config.loginData.password);
      formData.append("_csrf", csrfToken);
      formData.append("client_id", "brandEaucMember");
      formData.append("loginType", "eaucLogin");

      // 로그인 요청
      await clientInfo.client.post(this.config.loginPostUrl, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: this.config.loginPostUrl,
        },
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        },
      });

      // 로그인 후 검증
      const isValid = await this.loginCheckWithClient(clientInfo);
      if (!isValid) {
        throw new Error("Login verification failed");
      }

      return true;
    });
  }

  // 기존 performLogin 오버라이드 (부모 클래스 호환성)
  async performLogin() {
    // 직접 연결 클라이언트로 로그인
    const directClient = this.getDirectClient();
    return await this.performLoginWithClient(directClient);
  }

  async getStreamingMetadata(months = 3) {
    const chunks = [];

    // 최근 경매 회차 정보 가져오기
    const clientInfo = this.getClient();

    const auctionInfoResponse = await clientInfo.client.get(
      "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/searchHeaders/kakoKaisaiInfo",
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://e-auc.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    const auctionInfoList = auctionInfoResponse.data || [];

    if (auctionInfoList.length === 0) {
      throw new Error("Failed to get auction info");
    }

    // 최신 회차
    const latestAuction = auctionInfoList[0];
    const latestKaisaiKaisu = latestAuction.kaisaiKaisu;

    // months를 회차로 변환 (1달 = 약 4회차)
    const kaisaiCountForMonths = Math.ceil(months * 4);

    // months 개월 전의 회차 계산
    const kaisaiKaisuFrom = Math.max(
      latestKaisaiKaisu - kaisaiCountForMonths,
      0,
    );
    const kaisaiKaisuTo = latestKaisaiKaisu;

    console.log(
      `Crawling auction rounds from ${kaisaiKaisuFrom} to ${kaisaiKaisuTo}`,
    );

    // 첫 페이지로 총 페이지 수 확인
    const firstPageResponse = await clientInfo.client.get(
      this.config.marketPriceApiUrl,
      {
        params: {
          kaisaiKaisuFrom: kaisaiKaisuFrom,
          kaisaiKaisuTo: kaisaiKaisuTo,
          pageNumber: 0,
          page: 0,
          size: 1000,
          getKbn: 3,
          kaijoKbn: 0,
        },
      },
    );

    const totalPages = firstPageResponse.data.totalPages;

    // 10페이지씩 청크 생성
    for (let start = 0; start < totalPages; start += 10) {
      chunks.push({
        type: "api",
        startPage: start,
        endPage: Math.min(start + 9, totalPages - 1),
        kaisaiKaisuFrom: kaisaiKaisuFrom,
        kaisaiKaisuTo: kaisaiKaisuTo,
        size: 1000,
      });
    }

    return {
      chunks,
      totalChunks: chunks.length,
    };
  }

  async crawlChunkPages(chunk, existingIds) {
    const limit = pLimit(LIMIT2);
    const pagePromises = [];

    for (let page = chunk.startPage; page <= chunk.endPage; page++) {
      pagePromises.push(
        limit(() =>
          this.crawlPage(
            page,
            existingIds,
            chunk.kaisaiKaisuFrom,
            chunk.kaisaiKaisuTo,
            chunk.size,
            true, // skipImageProcessing
          ),
        ),
      );
    }

    const results = await Promise.all(pagePromises);

    // 결과 병합 및 existing 아이템 필터링
    return results.flat().filter((item) => !item.isExisting);
  }

  async crawlAllItems(existingIds = new Set(), months = 3) {
    try {
      const startTime = Date.now();
      console.log(`Starting value crawl at ${new Date().toISOString()}`);
      console.log(`Crawling data for the last ${months} months`);

      // 로그인
      await this.login();

      const allCrawledItems = [];
      const size = 1000; // 한 페이지당 항목 수 (API 제한에 따라 조정)

      // 최근 경매 회차 정보 가져오기
      const clientInfo = this.getClient();

      const auctionInfoResponse = await clientInfo.client.get(
        "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/searchHeaders/kakoKaisaiInfo",
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: "https://e-auc.brand-auc.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
      );

      const auctionInfoList = auctionInfoResponse.data || [];

      if (auctionInfoList.length === 0) {
        throw new Error("Failed to get auction info");
      }

      // 최신 회차 (맨 위에 있는 항목)
      const latestAuction = auctionInfoList[0];
      const latestKaisaiKaisu = latestAuction.kaisaiKaisu;

      // month를 회차로 변환 (1달 = 약 4회차, 7일 * 4 = 28일)
      const kaisaiCountForMonths = Math.ceil(months * 4);

      // months 개월 전의 회차 계산
      const kaisaiKaisuFrom = Math.max(
        latestKaisaiKaisu - kaisaiCountForMonths,
        0,
      );
      const kaisaiKaisuTo = latestKaisaiKaisu;

      console.log(
        `Crawling auction rounds from ${kaisaiKaisuFrom} to ${kaisaiKaisuTo}`,
      );

      // 첫 페이지 요청으로 총 페이지 수 확인
      const firstPageResponse = await clientInfo.client.get(
        this.config.marketPriceApiUrl,
        {
          params: {
            kaisaiKaisuFrom: kaisaiKaisuFrom,
            kaisaiKaisuTo: kaisaiKaisuTo,
            pageNumber: 0,
            page: 0,
            size: size,
            getKbn: 3, // 완료된 경매 결과
            kaijoKbn: 0, // 모든 경매장
          },
        },
      );

      const totalPages = firstPageResponse.data.totalPages;
      const totalItems = firstPageResponse.data.totalElements;

      console.log(
        `Found ${totalItems} market price items across ${totalPages} pages`,
      );

      // 페이지 병렬 처리 (이미지 없이)
      const limit = pLimit(LIMIT2);
      const pagePromises = [];

      for (let page = 0; page < totalPages; page++) {
        pagePromises.push(
          limit(() =>
            this.crawlPage(
              page,
              existingIds,
              kaisaiKaisuFrom,
              kaisaiKaisuTo,
              size,
              true,
            ),
          ),
        );
      }

      const pageResults = await Promise.all(pagePromises);

      pageResults.forEach((pageItems) => {
        if (pageItems && pageItems.length > 0) {
          // 기존 아이템 제외하고 추가
          allCrawledItems.push(...pageItems.filter((item) => !item.isExisting));
        }
      });

      if (allCrawledItems.length === 0) {
        console.log("No items were crawled. Aborting save operation.");
        return [];
      }

      // 전체 이미지 일괄 처리
      console.log(
        `Starting image processing for ${allCrawledItems.length} items...`,
      );
      const itemsWithImages = allCrawledItems.filter((item) => item.image);
      const finalProcessedItems = await processImagesInChunks(
        itemsWithImages,
        "values",
        3,
        "brand",
      );

      // 이미지가 없는 아이템들도 포함
      const itemsWithoutImages = allCrawledItems.filter((item) => !item.image);
      const allFinalItems = [...finalProcessedItems, ...itemsWithoutImages];

      console.log(`Total value items processed: ${allFinalItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Value crawl operation completed in ${this.formatExecutionTime(
          executionTime,
        )}`,
      );

      return allFinalItems;
    } catch (error) {
      console.error("Value crawl failed:", error.message);
      return [];
    }
  }

  async crawlPage(
    page,
    existingIds,
    kaisaiKaisuFrom,
    kaisaiKaisuTo,
    size,
    skipImageProcessing = false,
  ) {
    const clientInfo = this.getClient();

    return this.retryOperation(async () => {
      console.log(`Crawling value page ${page + 1}...`);

      const response = await clientInfo.client.get(
        this.config.marketPriceApiUrl,
        {
          params: {
            kaisaiKaisuFrom: kaisaiKaisuFrom,
            kaisaiKaisuTo: kaisaiKaisuTo,
            page: page,
            size: size,
            getKbn: 3,
            kaijoKbn: 0,
          },
          headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://e-auc.brand-auc.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
      );

      if (!response.data || !response.data.content) {
        return [];
      }

      const pageItems = [];
      for (const item of response.data.content) {
        // 이미 처리된 아이템 제외
        if (existingIds.has(item.uketsukeBng)) {
          pageItems.push({ item_id: item.uketsukeBng, isExisting: true });
          continue;
        }

        // 기본 정보 추출하여 아이템 생성
        const processedItem = this.extractBasicItemInfo(item);
        if (processedItem) pageItems.push(processedItem);
      }

      let finalItems;
      if (skipImageProcessing) {
        finalItems = pageItems;
      } else {
        finalItems = await processImagesInChunks(
          pageItems,
          "values",
          3,
          "brand",
        );
      }

      console.log(
        `Processed ${finalItems.length} value items from page ${
          page + 1
        } with ${clientInfo.name}`,
      );
      return finalItems;
    });
  }

  async processItemsPage(items, existingIds) {
    const filteredItems = [];

    for (const item of items) {
      // 이미 처리된 아이템 제외
      if (existingIds.has(item.uketsukeBng)) {
        filteredItems.push({ item_id: item.uketsukeBng, isExisting: true });
        continue;
      }

      // 기본 정보 추출하여 아이템 생성
      const processedItem = this.extractBasicItemInfo(item);
      if (processedItem) filteredItems.push(processedItem);
    }

    // 이미지 처리 등 추가 로직
    const processedItems = await processImagesInChunks(
      filteredItems,
      "values",
      3,
      "brand",
    );

    return processedItems;
  }

  extractBasicItemInfo(item) {
    // API 응답에서 필요한 정보 추출
    const category = this.config.categoryTable[item.genreEn] || item.genreEn;
    const scheduledDate =
      this.extractDate(this.convertToKST(item.kaisaiYmd)) || null;

    // Coin 카테고리 필터링
    if (item.genreEn === "Coin") {
      return null;
    }

    const original_title = this.convertFullWidthToAscii(item.shohinEn || "");

    // lighter 포함된 아이템 필터링
    if (original_title.toLowerCase().includes("lighter")) {
      return null;
    }

    let image =
      item?.photoUrl || item?.photoAlbumUrl || item?.photoZoomUrl || null;
    image = image ? image.replace(/(brand_img\/)(\d+)/, "$17") : null;

    return {
      item_id: item.uketsukeBng,
      original_title: original_title,
      title: this.removeLeadingBrackets(original_title),
      brand: this.convertFullWidthToAscii(item.maker || ""),
      rank: this.convertFullWidthToAscii(item.hyoka || ""),
      final_price: item.kekkaKng || 0,
      image: image,
      category: category,
      scheduled_date: scheduledDate,
      auc_num: "2", // 고정값으로 보임

      // 상세 정보 요청 시 필요한 데이터 - additional_info에 저장
      additional_info: {
        kaijoCd: item.kaijoCd,
        kaisaiKaisu: item.kaisaiKaisu,
      },
    };
  }

  async crawlItemDetails(itemId, item) {
    try {
      const clientInfo = this.getClient();
      await this.loginWithClient(clientInfo);

      // additional_info에서 데이터 가져오기
      const additionalInfo =
        typeof item.additional_info === "string"
          ? JSON.parse(item.additional_info)
          : item.additional_info || {};
      const kaisaiKaisu = additionalInfo.kaisaiKaisu;
      const kaijoCd = additionalInfo.kaijoCd || 1;

      // 상세 정보 URL 구성 (올바른 kaisaiKaisu 사용)
      const detailUrl = `https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/detail/${kaijoCd}/${kaisaiKaisu}/${itemId}`;

      // 상세 정보 요청
      const response = await clientInfo.client.get(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://e-auc.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.data) {
        throw new Error(`Failed to get value details for item ${itemId}`);
      }

      const detail = response.data;

      // 이미지 URL 목록 처리
      const images = [...detail.fileList, ...detail.fileListAdmin] || [];
      const formattedImages = images.map((url) =>
        url.replace(/(brand_img\/)(\d+)/, "$17"),
      );

      // 상품 상태 메모 처리
      const bikoList = detail.bikoList || [];
      let description = bikoList.join("\n") || "-";

      // 부속품 정보 처리
      const accessoryParts = [];
      if (detail.hosho && detail.hosho !== "なし")
        accessoryParts.push(`보증서: ${detail.hosho}`);
      if (detail.hako && detail.hako !== "なし")
        accessoryParts.push(`상자: ${detail.hako}`);
      if (detail.hozon && detail.hozon !== "なし")
        accessoryParts.push(`보존 케이스: ${detail.hozon}`);
      if (detail.strap && detail.strap !== "なし")
        accessoryParts.push(`스트랩: ${detail.strap}`);
      if (detail.kanadeKey && detail.kanadeKey !== "なし")
        accessoryParts.push(`열쇠: ${detail.kanadeKey}`);
      if (detail.seal && detail.seal !== "なし")
        accessoryParts.push(`태그: ${detail.seal}`);
      if (detail.shuppinBiko2List && detail.shuppinBiko2List.length > 0)
        accessoryParts.push(`기타: ${detail.shuppinBiko2List.join(", ")}`);

      const accessoryCode = accessoryParts.join(", ") || "";

      return {
        additional_images:
          formattedImages.length > 0 ? JSON.stringify(formattedImages) : null,
        description: description + accessoryCode,
        accessory_code: "",
      };
    } catch (error) {
      console.error(
        `Error fetching value details for item ${itemId}:`,
        error.message,
      );
      return {
        additional_images: null,
        description: "-",
        accessory_code: "",
      };
    }
  }
}

const brandAucCrawler = new BrandAucCrawler(brandAucConfig);
const brandAucValueCrawler = new BrandAucValueCrawler(brandAucValueConfig);

module.exports = { brandAucCrawler, brandAucValueCrawler };
