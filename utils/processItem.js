// utils/processItem.js
const { pool } = require("./DB"); // Assuming DB.js exports the pool
const { processImagesInChunks } = require("./processImage");
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
  mekikiAucCrawler,
  penguinAucCrawler,
} = require("../crawlers/index");
const DBManager = require("./DBManager");

/**
 * Fetches and potentially updates details for a single item.
 * Can optionally include user-specific bid data.
 *
 * @param {string} itemId - The ID of the item to process.
 * @param {boolean} isValue - Flag indicating if it's a 'values_items' table item.
 * @param {object|null} res - Express response object (used if not returning data).
 * @param {boolean} returnData - If true, returns the item data instead of sending response.
 * @param {number|string|null} userId - The ID of the user to fetch bid data for (optional).
 * @param {number} priority - Processing priority (1-3, default: 2).
 * @param {string|null} aucNum - The auction number to filter by (optional).
 * @returns {Promise<object|null>} - Item data if returnData is true, otherwise null.
 */
async function processItem(
  itemId,
  isValue,
  res,
  returnData = false,
  userId = null,
  priority = 2,
  aucNum = null,
) {
  try {
    const tableName = isValue ? "values_items" : "crawled_items";
    // 테이블에 따라 이미지 저장 폴더 결정
    const imageFolder = isValue ? "values" : "products";

    // aucNum이 제공된 경우 WHERE 조건에 추가
    let query;
    let params;
    if (aucNum !== null) {
      query = `SELECT * FROM ${tableName} WHERE item_id = ? AND auc_num = ?`;
      params = [itemId, aucNum];
    } else {
      query = `SELECT * FROM ${tableName} WHERE item_id = ?`;
      params = [itemId];
    }

    const [items] = await pool.query(query, params);

    if (items.length === 0) {
      if (returnData) return null;
      return res.status(404).json({ message: "Item not found" });
    }

    // 여러 개의 item이 반환되는 경우 (같은 item_id, 다른 auc_num)
    if (items.length > 1) {
      console.warn(
        `Multiple items found for item_id ${itemId}, using first one`,
      );
    }

    let item = items[0];

    let cropType = null;
    if (item.auc_num == 2) {
      cropType = "brand"; // BrandAuc items use brand crop
    }

    // --- Fetch User Bid Data ---
    let userBids = { live: null, direct: null, instant: null };
    if (userId) {
      try {
        // Fetch live bid for this specific item and user
        const [liveBids] = await pool.query(
          `
          SELECT
            'live' as bid_type, id, item_id, first_price,
            second_price, final_price, status
          FROM live_bids
          WHERE user_id = ? AND item_id = ?
          LIMIT 1
          `,
          [userId, itemId],
        );
        if (liveBids.length > 0) {
          userBids.live = liveBids[0];
        }

        // Fetch direct bid for this specific item and user
        const [directBids] = await pool.query(
          `
          SELECT
            'direct' as bid_type, id, item_id, current_price, status
          FROM direct_bids
          WHERE user_id = ? AND item_id = ?
          LIMIT 1
          `,
          [userId, itemId],
        );
        if (directBids.length > 0) {
          userBids.direct = directBids[0];
        }

        // Fetch instant purchase for this specific item and user
        const [instantPurchases] = await pool.query(
          `
          SELECT
            'instant' as bid_type, id, item_id, purchase_price, status
          FROM instant_purchases
          WHERE user_id = ? AND item_id = ?
          LIMIT 1
          `,
          [userId, itemId],
        );
        if (instantPurchases.length > 0) {
          userBids.instant = instantPurchases[0];
        }
      } catch (bidError) {
        console.error(
          `Error fetching bids for user ${userId}, item ${itemId}:`,
          bidError,
        );
        // Continue without bid data if fetching fails
      }
    }
    // Attach bids to the item object
    item.bids = userBids;
    // --- End Fetch User Bid Data ---

    // If description exists, no need to crawl, return item with bids
    if (item.description) {
      if (returnData) return item;
      return res.json(item);
    }

    // Determine crawler based on auc_num and isValue
    let crawler;
    if (item.auc_num == 1) {
      crawler = isValue ? ecoAucValueCrawler : ecoAucCrawler;
    } else if (item.auc_num == 2) {
      crawler = isValue ? brandAucValueCrawler : brandAucCrawler;
    } else if (item.auc_num == 3) {
      crawler = isValue ? starAucValueCrawler : starAucCrawler;
    } else if (item.auc_num == 4) {
      crawler = isValue ? null : mekikiAucCrawler;
    } else if (item.auc_num == 5) {
      crawler = isValue ? null : penguinAucCrawler;
    }

    // If no suitable crawler, return current item data with bids
    if (!crawler) {
      console.warn(
        `No crawler found for item ${itemId}, auc_num ${item.auc_num}, isValue ${isValue}`,
      );
      if (returnData) return item;
      return res.json(item);
    }

    // Proceed with crawling
    try {
      const crawledDetails = await crawler.crawlItemDetails(itemId, item); // Pass original item for context if needed

      // Check if crawling returned anything meaningful before processing images/updating DB
      if (
        crawledDetails &&
        (crawledDetails.description || crawledDetails.images?.length > 0)
      ) {
        let options = {};
        if (item.auc_num == 5) {
          options = {
            headers: {
              Referer: "https://penguin-auction.jp/",
            },
          };
        }
        // 여기서 imageFolder, priority, cropType 파라미터를 전달하여 적절한 폴더에 저장
        const processedDetails = (
          await processImagesInChunks(
            [crawledDetails],
            imageFolder,
            priority,
            cropType,
            options,
          )
        )[0];

        if (processedDetails) {
          await DBManager.updateItemDetails(
            itemId,
            processedDetails,
            tableName,
            item.auc_num, // auc_num 추가
          );

          // Fetch the updated item data
          const [updatedItems] = await pool.query(
            `SELECT * FROM ${tableName} WHERE item_id = ?`,
            [itemId],
          );

          if (updatedItems.length > 0) {
            let updatedItem = updatedItems[0];
            // Attach the previously fetched bids to the updated item
            updatedItem.bids = userBids;

            if (returnData) return updatedItem;
            return res.json(updatedItem);
          } else {
            // Should not happen if update was successful, but handle defensively
            console.error(`Item ${itemId} not found after update.`);
            if (returnData) return item; // Return original item with bids
            return res.json(item);
          }
        } else {
          console.warn(
            `Processing crawled details yielded no result for item ${itemId}`,
          );
          if (returnData) return item; // Return original item with bids
          return res.json(item);
        }
      } else {
        console.warn(`Crawling returned no new details for item ${itemId}`);
        if (returnData) return item; // Return original item with bids
        return res.json(item);
      }
    } catch (error) {
      console.error(`Error crawling item details for ${itemId}:`, error);
      // Return the original item data (with bids) if crawling fails
      if (returnData) return item;
      return res.json(item);
    }
  } catch (error) {
    console.error(`Error processing item ${itemId}:`, error);
    if (returnData) return null; // Indicate failure if returning data
    return res.status(500).json({ message: "Error getting item details" });
  }
}

module.exports = { processItem };
