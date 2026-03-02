/**
 * DBManager.js — DB 볈크 작업 매니저 (싱글톤)
 *
 * crawled_items / values_items 테이블 대상:
 *  - saveItems — INSERT … ON DUPLICATE KEY UPDATE
 *  - updateItems / updateItemDetails — 부분 업데이트
 *  - deleteItemsWithout — 입찰 연결된 아이템 보호 후 삭제
 *  - cleanupUnusedImages — 고아 이미지 파일 정리
 *  - cleanupOldValueItems — 오래된 시세 데이터 정리
 */
const { pool } = require("./DB");
const fs = require("fs").promises;
const path = require("path");

class DatabaseManager {
  constructor(pool) {
    this.pool = pool;
    this.RETRY_DELAY = 1000;
    this.MAX_RETRIES = 1;

    // 기본 컬럼 정의 (공통적으로 사용될 수 있는 컬럼들)
    this.crawledItemColumns = [
      "item_id",
      "original_title",
      "title",
      "scheduled_date",
      "auc_num",
      "category",
      "brand",
      "rank",
      "starting_price",
      "image",
      "description",
      "additional_images",
      "accessory_code",
      "final_price",
      "additional_info",
      "bid_type",
      "original_scheduled_date",
    ];

    // 테이블별 컬럼 정의
    this.tableColumns = {
      crawled_items: [
        "item_id",
        "original_title",
        "title",
        "scheduled_date",
        "auc_num",
        "category",
        "brand",
        "rank",
        "starting_price",
        "image",
        "description",
        "additional_images",
        "accessory_code",
        "final_price",
        "additional_info",
        "bid_type",
        "original_scheduled_date",
      ],
      values_items: [
        "item_id",
        "original_title",
        "title",
        "scheduled_date",
        "auc_num",
        "category",
        "brand",
        "rank",
        "starting_price",
        "image",
        "description",
        "additional_images",
        "accessory_code",
        "final_price",
        "additional_info",
      ],
      invoices: ["date", "auc_num", "status", "amount"],
      // 필요한 다른 테이블들의 컬럼 정의를 여기에 추가할 수 있습니다
    };

    this.IMAGE_DIR = path.join(__dirname, "..", "public", "images", "products");
  }

  async withRetry(operation) {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === this.MAX_RETRIES) {
          throw error;
        }
        console.log(
          `Attempt ${attempt} failed, retrying in ${this.RETRY_DELAY}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
      }
    }
  }

  async updateItems(items, tableName) {
    if (!items || items.length === 0) {
      console.log("No updates to save");
      return;
    }

    console.log(`Updating ${items.length} items in ${tableName}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const item of items) {
        // item_id와 scheduled_date, starting_price만 업데이트
        if (
          item.item_id &&
          (item.original_scheduled_date ||
            item.scheduled_date ||
            item.starting_price)
        ) {
          const updateFields = [];
          const values = [];

          if (item.original_scheduled_date) {
            updateFields.push("original_scheduled_date = ?");
            values.push(item.original_scheduled_date);
          }

          if (item.scheduled_date) {
            updateFields.push("scheduled_date = ?");
            values.push(item.scheduled_date);
          }

          if (item.starting_price) {
            updateFields.push("starting_price = ?");
            values.push(item.starting_price);
          }

          if (updateFields.length > 0) {
            // 업데이트 쿼리 실행
            const query = `UPDATE ${tableName} SET ${updateFields.join(
              ", ",
            )} WHERE item_id = ?`;
            values.push(item.item_id);
            await conn.query(query, values);
          }
        }
      }

      await conn.commit();
      console.log(`Successfully updated ${items.length} items in ${tableName}`);
    } catch (error) {
      await conn.rollback();
      console.error(`Error updating items in ${tableName}:`, error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async updateItemDetails(itemId, newDetails, tableName, aucNum = null) {
    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();

        const updateFields = [];
        const updateValues = [];

        // 테이블별 컬럼을 사용
        const validColumns =
          this.tableColumns[tableName] || this.crawledItemColumns;

        for (const [key, value] of Object.entries(newDetails)) {
          if (validColumns.includes(key)) {
            updateFields.push(`${key} = ?`);
            updateValues.push(value);
          }
        }

        if (updateFields.length === 0) {
          console.log(`No valid fields to update for item ${itemId}`);
          return;
        }

        // auc_num이 제공된 경우 WHERE 조건에 추가
        let updateQuery;
        if (aucNum !== null) {
          updateQuery = `UPDATE ${tableName} SET ${updateFields.join(
            ", ",
          )} WHERE item_id = ? AND auc_num = ?`;
          updateValues.push(itemId, aucNum);
        } else {
          updateQuery = `UPDATE ${tableName} SET ${updateFields.join(
            ", ",
          )} WHERE item_id = ?`;
          updateValues.push(itemId);
        }

        await conn.query(updateQuery, updateValues);

        console.log(
          `Item ${itemId}${
            aucNum ? ` (auc_num=${aucNum})` : ""
          } details updated successfully`,
        );
      });
    } catch (error) {
      console.error(`Error updating item ${itemId} details:`, error.message);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }

  async cleanupUnusedImages(folderName = "products", batchSize = 100) {
    let conn;

    try {
      // 이미지 디렉토리 경로 동적 설정
      const IMAGE_DIR = path.join(
        __dirname,
        "..",
        "public",
        "images",
        folderName,
      );

      conn = await this.pool.getConnection();

      const QUERY_BATCH_SIZE = 10000; // DB 조회 배치 크기

      if (folderName === "values") {
        // ===== VALUES 폴더 처리 (S3-aware) =====

        const localFilesInUse = new Set();
        let offset = 0;
        let hasMore = true;

        console.log(
          `[Cleanup] Collecting image paths from 'values_items' table...`,
        );

        // 배치 단위로 DB 조회
        while (hasMore) {
          const [batch] = await conn.query(
            `SELECT image, additional_images
           FROM values_items
           LIMIT ? OFFSET ?`,
            [QUERY_BATCH_SIZE, offset],
          );

          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          // 로컬 경로만 추출
          batch.forEach((item) => {
            // 메인 이미지
            if (item.image && item.image.startsWith("/images/values/")) {
              localFilesInUse.add(path.basename(item.image));
            }

            // 추가 이미지
            if (item.additional_images) {
              try {
                const additionalImages = JSON.parse(item.additional_images);
                additionalImages.forEach((img) => {
                  if (img.startsWith("/images/values/")) {
                    localFilesInUse.add(path.basename(img));
                  }
                });
              } catch (error) {
                console.error(`Error parsing additional_images:`, error);
              }
            }
          });

          offset += QUERY_BATCH_SIZE;

          // 진행률 표시
          if (offset % 50000 === 0) {
            console.log(`[Cleanup] Processed ${offset} items...`);
          }
        }

        console.log(
          `[Cleanup] Processed ${offset} items total, ` +
            `${localFilesInUse.size} unique local images in use`,
        );

        // 파일 시스템에서 이미지 정리 (재귀적으로 하위 폴더 포함)
        const allFiles = await this.getAllFilesRecursive(IMAGE_DIR);
        console.log(
          `[Cleanup] Scanning ${allFiles.length} files in filesystem (including subfolders)...`,
        );

        let deletedCount = 0;

        for (let i = 0; i < allFiles.length; i += batchSize) {
          const batch = allFiles.slice(i, i + batchSize);

          const results = await Promise.all(
            batch.map(async (filePath) => {
              const fileName = path.basename(filePath);

              // DB에 없는 파일만 삭제
              if (!localFilesInUse.has(fileName)) {
                try {
                  await fs.unlink(filePath);
                  return true;
                } catch (unlinkError) {
                  console.error(
                    `Error deleting file ${filePath}:`,
                    unlinkError,
                  );
                  return false;
                }
              }
              return false;
            }),
          );

          deletedCount += results.filter((r) => r).length;

          // 진행률 표시
          if (
            (i + batchSize) % 1000 === 0 ||
            i + batchSize >= allFiles.length
          ) {
            console.log(
              `[Cleanup] File cleanup progress: ${Math.min(
                i + batchSize,
                allFiles.length,
              )}/${allFiles.length}, ` + `deleted: ${deletedCount}`,
            );
          }
        }

        console.log(
          `Complete cleaning up unused images in 'values' folder (S3-aware)\n` +
            `Deleted ${deletedCount} unused local files`,
        );
      } else {
        // ===== PRODUCTS 폴더 처리 (배치 처리) =====

        const activeImagePaths = new Set();

        console.log(
          `[Cleanup] Collecting image paths from 'crawled_items' table...`,
        );

        // 1. crawled_items 배치 조회
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const [batch] = await conn.query(
            `SELECT image, additional_images
           FROM crawled_items
           LIMIT ? OFFSET ?`,
            [QUERY_BATCH_SIZE, offset],
          );

          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          // 이미지 경로 수집
          batch.forEach((item) => {
            if (item.image) activeImagePaths.add(item.image);
            if (item.additional_images) {
              try {
                JSON.parse(item.additional_images).forEach((img) =>
                  activeImagePaths.add(img),
                );
              } catch (error) {
                console.error(`Error parsing additional_images:`, error);
              }
            }
          });

          offset += QUERY_BATCH_SIZE;

          if (offset % 50000 === 0) {
            console.log(`[Cleanup] Processed ${offset} crawled_items...`);
          }
        }

        console.log(`[Cleanup] Total ${offset} crawled_items processed`);

        // 2. 입찰이 있는 아이템 이미지 조회 (배치)
        console.log(`[Cleanup] Collecting images from items with bids...`);

        offset = 0;
        hasMore = true;

        while (hasMore) {
          const [batch] = await conn.query(
            `SELECT ci.image, ci.additional_images 
           FROM crawled_items ci
           JOIN (
             SELECT DISTINCT item_id FROM direct_bids
             UNION
             SELECT DISTINCT item_id FROM live_bids
             UNION
             SELECT DISTINCT item_id FROM instant_purchases
           ) b ON ci.item_id = b.item_id
           LIMIT ? OFFSET ?`,
            [QUERY_BATCH_SIZE, offset],
          );

          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          // 이미지 경로 수집
          batch.forEach((item) => {
            if (item.image) activeImagePaths.add(item.image);
            if (item.additional_images) {
              try {
                JSON.parse(item.additional_images).forEach((img) =>
                  activeImagePaths.add(img),
                );
              } catch (error) {
                console.error(`Error parsing additional_images:`, error);
              }
            }
          });

          offset += QUERY_BATCH_SIZE;

          if (offset % 50000 === 0) {
            console.log(`[Cleanup] Processed ${offset} bid items...`);
          }
        }

        console.log(
          `[Cleanup] Total ${activeImagePaths.size} unique images in use`,
        );

        // 파일 시스템에서 이미지 정리
        const files = await fs.readdir(IMAGE_DIR);
        console.log(
          `[Cleanup] Scanning ${files.length} files in filesystem...`,
        );

        let deletedCount = 0;

        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);

          const results = await Promise.all(
            batch.map(async (file) => {
              const filePath = path.join(IMAGE_DIR, file);
              const relativePath = `/images/${folderName}/${file}`;

              if (!activeImagePaths.has(relativePath)) {
                try {
                  await fs.unlink(filePath);
                  return true;
                } catch (unlinkError) {
                  console.error(
                    `Error deleting file ${filePath}:`,
                    unlinkError,
                  );
                  return false;
                }
              }
              return false;
            }),
          );

          deletedCount += results.filter((r) => r).length;

          // 진행률 표시
          if ((i + batchSize) % 1000 === 0 || i + batchSize >= files.length) {
            console.log(
              `[Cleanup] File cleanup progress: ${Math.min(
                i + batchSize,
                files.length,
              )}/${files.length}, ` + `deleted: ${deletedCount}`,
            );
          }
        }

        console.log(
          `Complete cleaning up unused images in '${folderName}' folder\n` +
            `Deleted ${deletedCount} unused files`,
        );
      }
    } catch (error) {
      console.error(
        `Error cleaning up unused images in '${folderName}' folder:`,
        error,
      );
    } finally {
      if (conn) {
        try {
          await conn.release();
        } catch (releaseError) {
          console.error("Error releasing database connection:", releaseError);
        }
      }
    }
  }

  /**
   * 재귀적으로 모든 파일 경로 가져오기 (하위 폴더 포함)
   */
  async getAllFilesRecursive(dir) {
    const files = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.getAllFilesRecursive(fullPath);
          files.push(...subFiles);
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }

    return files;
  }

  async cleanupOldValueItems(daysThreshold = 90, batchSize = 500) {
    let conn;
    try {
      conn = await this.pool.getConnection();

      // Get items to be deleted
      const [oldItems] = await conn.query(
        `
        SELECT item_id
        FROM values_items 
        WHERE scheduled_date < DATE_SUB(NOW(), INTERVAL ? DAY) OR scheduled_date IS NULL
      `,
        [daysThreshold],
      );

      if (!oldItems.length) {
        console.log("No old items to clean up");
        return;
      }

      // Delete items in batches
      const itemIds = oldItems.map((item) => item.item_id);
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batchIds = itemIds.slice(i, i + batchSize);
        await conn.query(
          `
          DELETE FROM values_items 
          WHERE item_id IN (?)
        `,
          [batchIds],
        );
      }

      console.log(`Deleted ${oldItems.length} old value items from database`);

      // 데이터베이스 삭제 후 사용되지 않는 이미지 정리
      // values 폴더의 이미지만 정리
      await this.cleanupUnusedImages("values");
    } catch (error) {
      console.error("Error cleaning up old value items:", error);
      throw error;
    } finally {
      if (conn) await conn.release();
    }
  }

  async deleteItemsWithout(itemIds, tableName) {
    let conn;
    try {
      conn = await this.pool.getConnection();

      // direct_bids와 live_bids, instant_purchases 테이블에 있는 item_id 가져오기
      const [bidItems] = await conn.query(`
        SELECT DISTINCT item_id FROM direct_bids
        UNION
        SELECT DISTINCT item_id FROM live_bids
        UNION
        SELECT DISTINCT item_id FROM instant_purchases
      `);

      // 입찰이 있는 아이템 ID 목록 생성
      const bidItemIds = bidItems.map((item) => item.item_id);

      // 삭제해서는 안 될 아이템 ID 목록 (입찰이 있는 아이템 + 파라미터로 받은 아이템)
      const protectedItemIds = [...new Set([...bidItemIds, ...itemIds])];

      // Handle empty itemIds array
      if (!protectedItemIds.length) {
        // If no items provided and no bid items, delete all items
        const deleteAllQuery = `
          DELETE FROM ${tableName}
        `;
        await conn.query(deleteAllQuery);
      } else {
        // MariaDB compliant query to delete items not in protected list
        const deleteQuery = `
          DELETE FROM ${tableName}
          WHERE item_id NOT IN (?)
        `;

        await conn.query(deleteQuery, [protectedItemIds]);
      }

      // If you need to clean up wishlists, use this query:
      await conn.query(`
        DELETE w FROM wishlists w
        LEFT JOIN ${tableName} ci ON w.item_id = ci.item_id
        WHERE ci.item_id IS NULL 
        OR ci.scheduled_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      console.log(
        "Complete to delete outdated items (protected bid items preserved)",
      );
    } catch (error) {
      console.error("Error deleting items:", error.message);
      throw error; // Propagate error to caller
    } finally {
      if (conn) await conn.release();
    }
  }

  async saveItems(items, tableName, batchSize = 1000) {
    if (!items || !Array.isArray(items))
      throw new Error("Invalid input: items must be an array");

    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();

        // Filter out items without title for insertion/update
        const validItems =
          tableName === "invoices"
            ? items.filter((item) => item.date && item.auc_num) // 인보이스는 date와 auc_num 기준으로 필터링
            : items.filter((item) => item.title);
        if (validItems.length) {
          // 테이블별 정의된 컬럼 사용
          const tableSpecificColumns =
            this.tableColumns[tableName] || this.crawledItemColumns;

          // 모든 아이템의 속성을 수집하여 해당 테이블에 정의된 컬럼 중 사용할 컬럼을 결정
          const itemKeys = new Set();
          validItems.forEach((item) => {
            Object.keys(item).forEach((key) => itemKeys.add(key));
          });

          // 아이템의 속성 중 테이블에 정의된 컬럼만 사용
          const columns = tableSpecificColumns.filter((col) =>
            itemKeys.has(col),
          );

          const placeholders = columns.map(() => "?").join(", ");
          const updateClauses = columns
            .map((col) => `${col} = VALUES(${col})`)
            .join(", ");

          // Process items in batches
          for (let i = 0; i < validItems.length; i += batchSize) {
            const batch = validItems.slice(i, i + batchSize);
            const insertQuery = `
              INSERT INTO ${tableName} (${columns.join(", ")})
              VALUES ${batch.map(() => `(${placeholders})`).join(", ")}
              ON DUPLICATE KEY UPDATE ${updateClauses}
            `;

            const values = batch.flatMap((item) =>
              columns.map((col) => {
                // 속성이 없는 경우 null을 사용
                let value = item.hasOwnProperty(col) ? item[col] : null;
                // additional_info는 JSON으로 변환
                if (
                  col === "additional_info" &&
                  value !== null &&
                  typeof value === "object"
                ) {
                  value = JSON.stringify(value);
                }
                return value;
              }),
            );

            try {
              await conn.query(insertQuery, values);
            } catch (error) {
              console.error(
                `Error inserting batch ${i / batchSize + 1}:`,
                error,
              );
              // 개별 아이템 삽입 시도
              for (let j = 0; j < batch.length; j++) {
                const singleItemValues = columns.map((col) => {
                  // 속성이 없는 경우 null을 사용
                  let value = batch[j].hasOwnProperty(col)
                    ? batch[j][col]
                    : null;
                  // additional_info는 JSON으로 변환
                  if (
                    col === "additional_info" &&
                    value !== null &&
                    typeof value === "object"
                  ) {
                    value = JSON.stringify(value);
                  }
                  return value;
                });
                const singleInsertQuery = `
                  INSERT INTO ${tableName} (${columns.join(", ")})
                  VALUES (${placeholders})
                  ON DUPLICATE KEY UPDATE ${updateClauses}
                `;
                try {
                  await conn.query(singleInsertQuery, singleItemValues);
                } catch (singleError) {
                  console.error(
                    `Error inserting item ${batch[j].item_id}:`,
                    singleError,
                  );
                }
              }
            }
          }
        }
        await conn.commit();
        console.log("Items saved to database");
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Error saving items to database:", error.message);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}

const DBManager = new DatabaseManager(pool);

module.exports = DBManager;
