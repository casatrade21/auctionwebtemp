// scripts/indexElasticsearch.js
require("dotenv").config();
const { pool } = require("../utils/DB");
const esManager = require("../utils/elasticsearch");

// 배치 크기 설정
const BATCH_SIZE = 10000;

async function indexInBatches(tableName, items) {
  let totalIndexed = 0;
  let totalErrors = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    console.log(
      `  Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`
    );

    const result = await esManager.bulkIndex(tableName, batch);
    totalIndexed += result.indexed;
    totalErrors += result.errors;

    // 배치 간 짧은 대기 (ES 부하 방지)
    if (i + BATCH_SIZE < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return { indexed: totalIndexed, errors: totalErrors };
}

async function indexAllData() {
  try {
    console.log("Starting initial indexing...");

    // ES 연결
    const connected = await esManager.connect();
    if (!connected) {
      console.error("Failed to connect to Elasticsearch");
      process.exit(1);
    }

    // crawled_items 인덱싱
    console.log("\n📦 Indexing crawled_items...");
    const [crawledItems] = await pool.query(`
      SELECT 
        item_id, title, brand, category, 
        auc_num, scheduled_date
      FROM crawled_items 
      WHERE is_enabled = 1 AND title IS NOT NULL
    `);

    if (crawledItems.length > 0) {
      console.log(`Found ${crawledItems.length} items to index`);
      const result = await indexInBatches("crawled_items", crawledItems);
      console.log(
        `✓ Indexed ${result.indexed} crawled_items (errors: ${result.errors})`
      );
    } else {
      console.log("No crawled_items to index");
    }

    // values_items 인덱싱
    console.log("\n📦 Indexing values_items...");
    const [valuesItems] = await pool.query(`
      SELECT 
        item_id, title, brand, category, 
        auc_num, scheduled_date
      FROM values_items
      WHERE title IS NOT NULL
    `);

    if (valuesItems.length > 0) {
      console.log(`Found ${valuesItems.length} items to index`);
      const result = await indexInBatches("values_items", valuesItems);
      console.log(
        `✓ Indexed ${result.indexed} values_items (errors: ${result.errors})`
      );
    } else {
      console.log("No values_items to index");
    }

    console.log("\n✓ Initial indexing complete!");
    process.exit(0);
  } catch (error) {
    console.error("✗ Indexing failed:", error);
    process.exit(1);
  }
}

indexAllData();
