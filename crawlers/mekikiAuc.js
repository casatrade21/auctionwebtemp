// crawlers/mekikiAuc.js
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");
const translator = require("../utils/translator");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const LIMIT1 = 1;
const LIMIT2 = 1;

const API_DELAY = 10 * 1000; // 10초
const PER_PAGE = 100;

const mekikiAucConfig = {
  name: "MekikiAuc",
  baseUrl: "https://api-prod-auction.mekiki.ai",
  loginCheckUrls: ["https://api-prod-auction.mekiki.ai/api/users/me"],
  loginPageUrl: null, // API 기반이라 불필요
  loginPostUrl: "https://api-prod-auction.mekiki.ai/api/login",
  eventsUrl: "https://api-prod-auction.mekiki.ai/api/recommended_items/events",
  itemsUrl: "https://api-prod-auction.mekiki.ai/api/events",
  loginData: {
    login_id: process.env.CRAWLER_EMAIL4,
    password: process.env.CRAWLER_PASSWORD4,
    remember_me: true,
  },
  useMultipleClients: false,
  categoryTable: {
    1: "가방",
    2: "악세서리",
    3: "시계",
    4: "귀금속",
    6: "의류",
    8: "귀금속",
    19: "기타",
  },
};

const mekikiAucValueConfig = {
  name: "MekikiAucValue",
  baseUrl: "https://api-prod-auction.mekiki.ai",
  loginCheckUrls: ["https://api-prod-auction.mekiki.ai/api/users/me"],
  loginPageUrl: null,
  loginPostUrl: "https://api-prod-auction.mekiki.ai/api/login",
  eventsUrl: "https://api-prod-auction.mekiki.ai/api/events/finished_events",
  itemsUrl: "https://api-prod-auction.mekiki.ai/api/events",
  loginData: {
    login_id: process.env.CRAWLER_EMAIL4,
    password: process.env.CRAWLER_PASSWORD4,
    remember_me: true,
  },
  useMultipleClients: false,
  categoryTable: {
    1: "가방",
    2: "악세서리",
    3: "시계",
    4: "귀금속",
    6: "의류",
    8: "귀금속",
    19: "기타",
  },
};

class MekikiAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.userId = null;
    this.authToken = null;
  }

  // 로그인 구현
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} Mekiki Auction 로그인 중...`);

      // 로그인 요청
      const loginResponse = await clientInfo.client.post(
        this.config.loginPostUrl,
        this.config.loginData,
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (loginResponse.status !== 200) {
        throw new Error("Login request failed");
      }

      // API 토큰 저장
      const authToken = loginResponse.data.api_token;
      console.log(`API Token received: ${authToken.substring(0, 20)}...`);

      // 클라이언트의 기본 헤더에 Bearer 토큰 추가
      clientInfo.client.defaults.headers.common["Authorization"] =
        `Bearer ${authToken}`;
      console.log(`Bearer token set for ${clientInfo.name}`);

      // 로그인 확인 및 user_id 추출
      const meResponse = await clientInfo.client.get(
        this.config.loginCheckUrls[0],
      );

      if (meResponse.status === 200 && meResponse.data?.id) {
        this.userId = meResponse.data.id;
        console.log(`User ID: ${this.userId}`);
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

  // 활성 이벤트 목록 가져오기
  async getActiveEvents() {
    const clientInfo = this.getClient();

    return this.retryOperation(async () => {
      console.log("Fetching active events...");

      const response = await clientInfo.client.get(this.config.eventsUrl, {
        params: {
          user_id: this.userId,
        },
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.data?.collection) {
        throw new Error("Failed to get events");
      }

      const now = new Date();
      const activeEvents = response.data.collection.filter((event) => {
        const startDate = new Date(event.start_datetime);
        const endDate = new Date(event.end_datetime);
        return startDate <= now && now <= endDate;
      });

      console.log(
        `Found ${activeEvents.length} active events out of ${response.data.collection.length} total events`,
      );

      return activeEvents;
    });
  }

  // 전체 아이템 크롤링
  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting Mekiki crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      // 활성 이벤트 가져오기
      const activeEvents = await this.getActiveEvents();

      if (activeEvents.length === 0) {
        console.log("No active events found");
        return [];
      }

      const allCrawledItems = [];

      // 각 이벤트별로 크롤링
      for (const event of activeEvents) {
        console.log(
          `\n=== Crawling event: ${event.title} (ID: ${event.id}) ===`,
        );
        console.log(
          `Event period: ${event.start_datetime} ~ ${event.end_datetime}`,
        );

        const eventItems = await this.crawlEvent(event.id, existingIds, true);

        if (eventItems && eventItems.length > 0) {
          allCrawledItems.push(...eventItems);
          console.log(
            `Completed crawl for event ${event.id}. Items found: ${eventItems.length}`,
          );
        }
      }

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
        "products",
        3,
      );

      // 이미지가 없는 아이템들도 포함
      const itemsWithoutImages = allCrawledItems.filter((item) => !item.image);
      const allFinalItems = [...finalProcessedItems, ...itemsWithoutImages];

      console.log(`Total items processed: ${allFinalItems.length}`);

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

  // 특정 이벤트의 아이템 크롤링
  async crawlEvent(
    eventId,
    existingIds = new Set(),
    skipImageProcessing = false,
  ) {
    try {
      const clientInfo = this.getClient();

      // 첫 페이지로 전체 페이지 수 확인
      const firstPageResponse = await clientInfo.client.get(
        `${this.config.itemsUrl}/${eventId}/items`,
        {
          params: {
            sort: 8,
            per_page: PER_PAGE,
            page: 1,
            "kind[]": 1,
            group_flag: false,
            user_id: this.userId,
          },
          headers: {
            Accept: "application/json",
          },
        },
      );
      await this.sleep(API_DELAY);

      const totalPages = firstPageResponse.data.meta?.pages || 1;
      const totalItems = firstPageResponse.data.meta?.total || 0;

      console.log(
        `Event ${eventId}: Found ${totalItems} items across ${totalPages} pages`,
      );

      // 첫 페이지 아이템 처리
      const allItems = [];
      const firstPageItems = await this.processItemsPage(
        firstPageResponse.data.collection || [],
        existingIds,
        eventId,
      );
      allItems.push(...firstPageItems);

      // 나머지 페이지 병렬 처리
      if (totalPages > 1) {
        const limit = pLimit(LIMIT2);
        const pagePromises = [];

        for (let page = 2; page <= totalPages; page++) {
          pagePromises.push(
            limit(async () => {
              console.log(
                `Crawling event ${eventId}, page ${page} of ${totalPages}`,
              );

              const pageClientInfo = this.getClient();
              const response = await pageClientInfo.client.get(
                `${this.config.itemsUrl}/${eventId}/items`,
                {
                  params: {
                    sort: 8,
                    per_page: PER_PAGE,
                    page: page,
                    "kind[]": 1,
                    group_flag: false,
                    user_id: this.userId,
                  },
                  headers: {
                    Accept: "application/json",
                  },
                },
              );

              await this.sleep(API_DELAY);

              const pageItems = await this.processItemsPage(
                response.data.collection || [],
                existingIds,
                eventId,
              );

              console.log(
                `Processed ${pageItems.length} items from page ${page}`,
              );

              return pageItems;
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

      let finalItems;
      if (skipImageProcessing) {
        finalItems = allItems;
      } else {
        finalItems = await processImagesInChunks(allItems, "products", 3);
      }

      return finalItems;
    } catch (error) {
      console.error(`Error crawling event ${eventId}:`, error.message);
      return [];
    }
  }

  // 페이지 아이템 처리
  async processItemsPage(items, existingIds, eventId) {
    const processedItems = [];

    for (const item of items) {
      // 이미 처리된 아이템 제외
      if (existingIds.has(item.id.toString())) {
        processedItems.push({
          item_id: item.id.toString(),
          starting_price: item.current_price || 0,
        });
        continue;
      }

      const processedItem = await this.extractItemInfo(item, eventId);
      if (processedItem) {
        processedItems.push(processedItem);
      }
    }

    return processedItems;
  }

  // 아이템 정보 추출
  async extractItemInfo(item, eventId) {
    try {
      // 카테고리에 없으면 제외
      if (!this.config.categoryTable[item.category?.id]) {
        return null;
      }

      // subcategory에 lighter 포함 시 제외
      const subcategoryName = item.subcategory?.name?.en || "";
      if (subcategoryName.toLowerCase().includes("lighter")) {
        return null;
      }

      const itemId = item.id.toString();
      const boxId = item.box_id || "";
      const boxNo = item.box_no || "";
      const brandName = await translator.translate(item.brand?.name || "");
      item.brandTrans = brandName; // 번역된 브랜드명 저장
      const original_scheduled_date = this.extractDate(
        this.convertToKST(this.extractDate(item.end_datetime)),
      );
      const scheduled_date = this.getPreviousDayAt18(original_scheduled_date);
      const category = this.config.categoryTable[item.category?.id] || "기타";
      const rank = item.grade || "N";
      const startingPrice = item.current_price || 0;
      const image = item.thumbnails?.[0] || item.images?.[0] || null;
      const additionalImages = item.images || [];
      const { description, title } = await this.buildDescriptionTitle(item);
      const originalTitle = `${boxId}-${boxNo} ${title}`;
      const accessoryCode = subcategoryName;

      return {
        item_id: itemId,
        title: title,
        original_title: originalTitle,
        scheduled_date: scheduled_date,
        original_scheduled_date: original_scheduled_date,
        auc_num: "4",
        category: category,
        brand: brandName,
        rank: rank,
        starting_price: startingPrice,
        image: image,
        additional_images: JSON.stringify(additionalImages),
        description: description,
        accessory_code: accessoryCode,
        additional_info: { event_id: eventId },
        bid_type: "live",
      };
    } catch (error) {
      console.error(`Error extracting item info for item ${item.id}:`, error);
      return null;
    }
  }

  // Description 생성
  async buildDescriptionTitle(item) {
    const getValue = (val) => val || "-";
    const comment = await translator.translate(item.comment || "-");
    const model = await translator.translate(item.model1 || "-");
    const model2 = await translator.translate(item.model2 || "-");
    const line = await translator.translate(item.line || "-");
    const material = await translator.translate(item.material || "-");
    const color = await translator.translate(item.color || "-");
    const serialNumber = await translator.translate(item.serial_number || "-");
    const accessoryNote = await translator.translate(
      item.accessory_note || "-",
    );
    const size = await translator.translate(item.size || "-");
    const detail = await translator.translate(item.detail || "-");

    const title = `${getValue(item.category?.name?.en)} ${getValue(
      item.brandTrans,
    )} ${model} ${model2} ${serialNumber} ${size}`
      .replace(" -", "")
      .replace("-", "")
      .trim();

    const parts = [
      `Comment: ${comment}`,
      `Category: ${getValue(item.category?.name?.en)}`,
      `Subcategory: ${getValue(item.subcategory?.name?.en)}`,
      `Brand: ${getValue(item.brandTrans)}`,
      `Grade: ${getValue(item.grade)}`,
      `Outer Grade: ${getValue(item.grade_outside)}`,
      `Inner Grade: ${getValue(item.grade_inside)}`,
      `Retail Price: ${getValue(item.retail_price)}`,
      `Model: ${model}`,
      `Model Number: ${getValue(item.model_number)}`,
      `Line: ${line}`,
      `Material: ${material}`,
      `Color: ${color}`,
      `Serial Number: ${serialNumber}`,
      `Accessory Note: ${accessoryNote}`,
      `Size: ${size}`,
      `Quantity: ${getValue(item.quantity)}`,
      `Detail: ${detail}`,
    ];

    return { description: parts.join(", "), title: title };
  }

  // Live Bid
  async liveBid(item_id, price, event_id) {
    return await this.retryOperation(
      async () => {
        console.log(
          `Placing live bid for item ${item_id} with price ${price}...`,
        );

        // 직접 연결 클라이언트 사용
        const clientInfo = this.getClient();

        // 입찰 요청
        const bidResponse = await clientInfo.client.post(
          `${this.config.itemsUrl}/${event_id}/items/${item_id}/auto_bid`,
          { price: price },
          {
            timeout: 5000,
            params: {
              user_id: this.userId,
            },
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          },
        );

        // 응답 확인
        if (bidResponse.status === 200 && bidResponse.data?.item) {
          console.log(`Bid successful for item ${item_id} with price ${price}`);
          return {
            success: true,
            message: "Bid placed successfully",
            data: bidResponse.data,
          };
        } else {
          throw new Error(`Bid failed for item ${item_id} with price ${price}`);
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

  // Add Wishlist (Like)
  async addWishlist(item_id, event_id) {
    try {
      console.log(`Adding item ${item_id} to wishlist (like)...`);

      // 직접 연결 클라이언트 사용
      const clientInfo = this.getClient();

      // 위시리스트(좋아요) 요청
      const likeResponse = await clientInfo.client.post(
        `${this.config.itemsUrl}/${event_id}/items/${item_id}/like`,
        {},
        {
          params: {
            user_id: this.userId,
          },
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      // 응답 확인
      if (likeResponse.status === 200 || likeResponse.status === 201) {
        console.log(`Wishlist successful for item ${item_id}`);
        return {
          success: true,
          message: "Wishlist added successfully",
          data: likeResponse.data,
        };
      } else {
        throw new Error(`Wishlist failed for item ${item_id}`);
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

  // 상세 정보 크롤링 (fallback용)
  async crawlItemDetails(itemId, item) {
    // API 응답에 이미 모든 정보가 포함되어 있으므로
    // 별도의 상세 API 호출 불필요
    console.log(
      `Item ${itemId} details already included in list response (fallback not needed)`,
    );
    return {
      additional_images: item.additional_images || null,
      description: item.description || "-",
      accessory_code: item.accessory_code || "",
    };
  }
}

class MekikiAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.userId = null;
    this.authToken = null;
  }

  // 로그인 구현
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} Mekiki Auction Value 로그인 중...`);

      // 로그인 요청
      const loginResponse = await clientInfo.client.post(
        this.config.loginPostUrl,
        this.config.loginData,
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (loginResponse.status !== 200) {
        throw new Error("Login request failed");
      }

      // API 토큰 저장
      const authToken = loginResponse.data.api_token;
      console.log(`API Token received: ${authToken.substring(0, 20)}...`);

      // 클라이언트의 기본 헤더에 Bearer 토큰 추가
      clientInfo.client.defaults.headers.common["Authorization"] =
        `Bearer ${authToken}`;
      console.log(`Bearer token set for ${clientInfo.name}`);

      // 로그인 확인 및 user_id 추출
      const meResponse = await clientInfo.client.get(
        this.config.loginCheckUrls[0],
      );

      if (meResponse.status === 200 && meResponse.data?.id) {
        this.userId = meResponse.data.id;
        console.log(`User ID: ${this.userId}`);
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

  // 종료된 이벤트 목록 가져오기
  async getFinishedEvents(months = 3) {
    const clientInfo = this.getClient();

    return this.retryOperation(async () => {
      console.log("Fetching finished events...");

      let allEvents = [];
      let page = 1;
      let hasMore = true;

      // 모든 종료된 이벤트 가져오기
      while (hasMore) {
        console.log(`Fetching finished events page ${page}...`);

        const response = await clientInfo.client.get(this.config.eventsUrl, {
          params: {
            per_page: 20,
            page: page,
            user_id: this.userId,
          },
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.data?.collection) {
          throw new Error("Failed to get finished events");
        }

        allEvents.push(...response.data.collection);

        // 페이지네이션 체크
        if (page >= response.data.meta.pages) {
          hasMore = false;
        }
        page++;

        await this.sleep(API_DELAY);
      }

      // months 개월 이내 이벤트만 필터링
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - months);

      const recentEvents = allEvents.filter((event) => {
        const endDate = new Date(event.end_datetime);
        return endDate >= cutoffDate;
      });

      console.log(
        `Found ${recentEvents.length} finished events in last ${months} months (out of ${allEvents.length} total)`,
      );

      return recentEvents;
    });
  }

  async getStreamingMetadata(months = 3) {
    const chunks = [];

    // 종료된 이벤트 가져오기
    const finishedEvents = await this.getFinishedEvents(months);

    if (finishedEvents.length === 0) {
      console.log("No finished events found");
      return { chunks: [], totalChunks: 0 };
    }

    // 각 이벤트별로 청크 생성
    for (const event of finishedEvents) {
      const clientInfo = this.getClient();

      // 첫 페이지로 총 페이지 수 확인
      const firstPageResponse = await clientInfo.client.get(
        `${this.config.itemsUrl}/${event.id}/items`,
        {
          params: {
            sort: 8,
            per_page: PER_PAGE,
            page: 1,
            "kind[]": [1, 2],
            group_flag: false,
            user_id: this.userId,
          },
          headers: {
            Accept: "application/json",
          },
        },
      );
      await this.sleep(API_DELAY);

      const totalPages = firstPageResponse.data.meta?.pages || 1;

      // 10페이지씩 청크 생성
      for (let start = 1; start <= totalPages; start += 10) {
        chunks.push({
          type: "event",
          eventId: event.id,
          eventTitle: event.title,
          eventEndDate: event.end_datetime,
          startPage: start,
          endPage: Math.min(start + 9, totalPages),
        });
      }
    }

    return {
      chunks,
      totalChunks: chunks.length,
    };
  }

  async crawlChunkPages(chunk, existingIds) {
    const limit = pLimit(LIMIT2);
    const pagePromises = [];

    // 이벤트 객체 재구성
    const event = {
      id: chunk.eventId,
      title: chunk.eventTitle,
      end_datetime: chunk.eventEndDate,
    };

    for (let page = chunk.startPage; page <= chunk.endPage; page++) {
      pagePromises.push(
        limit(async () => {
          const clientInfo = this.getClient();

          const response = await clientInfo.client.get(
            `${this.config.itemsUrl}/${event.id}/items`,
            {
              params: {
                sort: 8,
                per_page: PER_PAGE,
                page: page,
                "kind[]": [1, 2],
                group_flag: false,
                user_id: this.userId,
              },
              headers: {
                Accept: "application/json",
              },
            },
          );

          await this.sleep(API_DELAY);

          return await this.processItemsPage(
            response.data.collection || [],
            existingIds,
            event,
          );
        }),
      );
    }

    const results = await Promise.all(pagePromises);

    // 결과 병합 및 existing 아이템 필터링
    return results.flat().filter((item) => !item.isExisting);
  }

  // 전체 아이템 크롤링
  async crawlAllItems(existingIds = new Set(), months = 3) {
    try {
      const startTime = Date.now();
      console.log(`Starting Mekiki Value crawl at ${new Date().toISOString()}`);
      console.log(`Crawling data for the last ${months} months`);

      // 로그인
      await this.login();

      // 종료된 이벤트 가져오기
      const finishedEvents = await this.getFinishedEvents(months);

      if (finishedEvents.length === 0) {
        console.log("No finished events found");
        return [];
      }

      const allCrawledItems = [];

      // 각 이벤트별로 크롤링
      for (const event of finishedEvents) {
        console.log(
          `\n=== Crawling finished event: ${event.title} (ID: ${event.id}) ===`,
        );
        console.log(
          `Event period: ${event.start_datetime} ~ ${event.end_datetime}`,
        );

        const eventItems = await this.crawlEvent(event, existingIds, true);

        if (eventItems && eventItems.length > 0) {
          allCrawledItems.push(...eventItems);
          console.log(
            `Completed crawl for event ${event.id}. Items found: ${eventItems.length}`,
          );
        }
      }

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

  // 특정 이벤트의 아이템 크롤링
  async crawlEvent(
    event,
    existingIds = new Set(),
    skipImageProcessing = false,
  ) {
    try {
      const eventId = event.id;
      const clientInfo = this.getClient();

      // 첫 페이지로 전체 페이지 수 확인
      const firstPageResponse = await clientInfo.client.get(
        `${this.config.itemsUrl}/${eventId}/items`,
        {
          params: {
            sort: 8,
            per_page: PER_PAGE,
            page: 1,
            "kind[]": [1, 2],
            group_flag: false,
            user_id: this.userId,
          },
          headers: {
            Accept: "application/json",
          },
        },
      );
      await this.sleep(API_DELAY);

      const totalPages = firstPageResponse.data.meta?.pages || 1;
      const totalItems = firstPageResponse.data.meta?.total || 0;

      console.log(
        `Event ${eventId}: Found ${totalItems} items across ${totalPages} pages`,
      );

      // 첫 페이지 아이템 처리
      const allItems = [];
      const firstPageItems = await this.processItemsPage(
        firstPageResponse.data.collection || [],
        existingIds,
        event,
      );
      allItems.push(...firstPageItems);

      // 나머지 페이지 병렬 처리
      if (totalPages > 1) {
        const limit = pLimit(LIMIT2);
        const pagePromises = [];

        for (let page = 2; page <= totalPages; page++) {
          pagePromises.push(
            limit(async () => {
              console.log(
                `Crawling event ${eventId}, page ${page} of ${totalPages}`,
              );

              const pageClientInfo = this.getClient();
              const response = await pageClientInfo.client.get(
                `${this.config.itemsUrl}/${eventId}/items`,
                {
                  params: {
                    sort: 8,
                    per_page: PER_PAGE,
                    page: page,
                    "kind[]": [1, 2],
                    group_flag: false,
                    user_id: this.userId,
                  },
                  headers: {
                    Accept: "application/json",
                  },
                },
              );

              await this.sleep(API_DELAY);

              const pageItems = await this.processItemsPage(
                response.data.collection || [],
                existingIds,
                event,
              );

              console.log(
                `Processed ${pageItems.length} items from page ${page}`,
              );

              return pageItems;
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

      let finalItems;
      if (skipImageProcessing) {
        finalItems = allItems;
      } else {
        finalItems = await processImagesInChunks(allItems, "values", 3);
      }

      return finalItems;
    } catch (error) {
      console.error(`Error crawling event ${event.id}:`, error.message);
      return [];
    }
  }

  // 페이지 아이템 처리
  async processItemsPage(items, existingIds, event) {
    const processedItems = [];

    for (const item of items) {
      // 이미 처리된 아이템 제외
      if (existingIds.has(item.id.toString())) {
        processedItems.push({
          item_id: item.id.toString(),
          isExisting: true,
        });
        continue;
      }

      const processedItem = await this.extractItemInfo(item, event);
      if (processedItem) {
        processedItems.push(processedItem);
      }
    }

    return processedItems;
  }

  // 아이템 정보 추출
  async extractItemInfo(item, event) {
    try {
      // 카테고리에 없으면 제외
      if (!this.config.categoryTable[item.category?.id]) {
        return null;
      }

      // subcategory에 lighter 포함 시 제외
      const subcategoryName = item.subcategory?.name?.en || "";
      if (subcategoryName.toLowerCase().includes("lighter")) {
        return null;
      }

      const itemId = item.id.toString();
      const boxId = item.box_id || "";
      const boxNo = item.box_no || "";
      const brandName = await translator.translate(item.brand?.name || "");
      item.brandTrans = brandName;

      const scheduledDate = this.extractDate(
        this.convertToKST(this.extractDate(event.end_datetime)),
      );
      const category = this.config.categoryTable[item.category?.id] || "기타";
      const rank = item.grade || "N";
      const finalPrice = item.current_price || 0; // 종료된 경매의 최종 가격
      const image = item.thumbnails?.[0] || item.images?.[0] || null;
      const additionalImages = item.images || [];
      const { description, title } = await this.buildDescriptionTitle(item);
      const originalTitle = `${boxId}-${boxNo} ${title}`;
      const accessoryCode = subcategoryName;

      return {
        item_id: itemId,
        title: title,
        original_title: originalTitle,
        scheduled_date: scheduledDate,
        auc_num: "4",
        category: category,
        brand: brandName,
        rank: rank,
        final_price: finalPrice,
        image: image,
        additional_images: JSON.stringify(additionalImages),
        description: description,
        accessory_code: accessoryCode,
        additional_info: { event_id: event.id },
      };
    } catch (error) {
      console.error(`Error extracting item info for item ${item.id}:`, error);
      return null;
    }
  }

  // Description 생성
  async buildDescriptionTitle(item) {
    const getValue = (val) => val || "-";
    const comment = await translator.translate(item.comment || "-");
    const model = await translator.translate(item.model1 || "-");
    const model2 = await translator.translate(item.model2 || "-");
    const line = await translator.translate(item.line || "-");
    const material = await translator.translate(item.material || "-");
    const color = await translator.translate(item.color || "-");
    const serialNumber = await translator.translate(item.serial_number || "-");
    const accessoryNote = await translator.translate(
      item.accessory_note || "-",
    );
    const size = await translator.translate(item.size || "-");
    const detail = await translator.translate(item.detail || "-");

    const title = `${getValue(item.category?.name?.en)} ${getValue(
      item.brandTrans,
    )} ${model} ${model2} ${serialNumber} ${size}`
      .replace(" -", "")
      .replace("-", "")
      .trim();

    const parts = [
      `Comment: ${comment}`,
      `Category: ${getValue(item.category?.name?.en)}`,
      `Subcategory: ${getValue(item.subcategory?.name?.en)}`,
      `Brand: ${getValue(item.brandTrans)}`,
      `Grade: ${getValue(item.grade)}`,
      `Outer Grade: ${getValue(item.grade_outside)}`,
      `Inner Grade: ${getValue(item.grade_inside)}`,
      `Retail Price: ${getValue(item.retail_price)}`,
      `Model: ${model}`,
      `Model Number: ${getValue(item.model_number)}`,
      `Line: ${line}`,
      `Material: ${material}`,
      `Color: ${color}`,
      `Serial Number: ${serialNumber}`,
      `Accessory Note: ${accessoryNote}`,
      `Size: ${size}`,
      `Quantity: ${getValue(item.quantity)}`,
      `Detail: ${detail}`,
    ];

    return { description: parts.join(", "), title: title };
  }

  // 상세 정보 크롤링 (fallback용)
  async crawlItemDetails(itemId, item) {
    // API 응답에 이미 모든 정보가 포함되어 있으므로
    // 별도의 상세 API 호출 불필요
    console.log(
      `Item ${itemId} details already included in list response (fallback not needed)`,
    );
    return {
      additional_images: item.additional_images || null,
      description: item.description || "-",
      accessory_code: item.accessory_code || "",
    };
  }
}

const mekikiAucCrawler = new MekikiAucCrawler(mekikiAucConfig);
const mekikiAucValueCrawler = new MekikiAucValueCrawler(mekikiAucValueConfig);

module.exports = { mekikiAucCrawler, mekikiAucValueCrawler };
