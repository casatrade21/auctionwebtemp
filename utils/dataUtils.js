/**
 * dataUtils.js — 데이터 전처리 및 스케줄러
 *
 * 1. 필터 설정 동기화 — filter_settings → crawled_items.is_enabled
 * 2. 추천 설정 동기화 — recommend_settings → crawled_items.recommend
 * 3. 만료 상태 관리 — direct(1분)/live(1시간)/instant 만료 체크
 * 4. syncAllData() — 크롤링 완료 후 전체 동기화 트리거
 */
const { pool } = require("./DB");

// ==========================================
// SCHEDULER STATE
// ==========================================
let directInterval = null;
let liveInterval = null;

// ==========================================
// 1. FILTER SETTINGS (is_enabled)
// ==========================================

async function getFilterSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled 
      FROM filter_settings 
      ORDER BY filter_type, filter_value
    `);
    return rows;
  } catch (error) {
    console.error("Error getting filter settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function getEnabledFilters(filterType) {
  const conn = await pool.getConnection();
  try {
    const [enabled] = await conn.query(
      `
      SELECT filter_value 
      FROM filter_settings 
      WHERE filter_type = ? AND is_enabled = TRUE
    `,
      [filterType],
    );
    return enabled.map((item) => item.filter_value);
  } catch (error) {
    console.error("Error getting enabled filters:", error);
    return [];
  } finally {
    conn.release();
  }
}

async function updateFilterSetting(filterType, filterValue, isEnabled) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `
      INSERT INTO filter_settings (filter_type, filter_value, is_enabled)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE is_enabled = ?
    `,
      [filterType, filterValue, isEnabled, isEnabled],
    );

    return { filterType, filterValue, isEnabled };
  } catch (error) {
    console.error("Error updating filter setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function initializeFilterSettings() {
  const conn = await pool.getConnection();
  try {
    // 1. 현재 DB에 있는 모든 값들을 가져옴
    const [dates] = await conn.query(`
      SELECT DISTINCT DATE(scheduled_date) as value 
      FROM crawled_items 
      WHERE scheduled_date IS NOT NULL
      ORDER BY value
    `);
    const [brands] = await conn.query(`
      SELECT DISTINCT brand as value 
      FROM crawled_items 
      WHERE brand IS NOT NULL AND brand != ''
      ORDER BY value
    `);
    const [categories] = await conn.query(`
      SELECT DISTINCT category as value 
      FROM crawled_items 
      WHERE category IS NOT NULL AND category != ''
      ORDER BY value
    `);

    // 2. 현재 필터 설정을 가져옴
    const [currentSettings] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled
      FROM filter_settings
    `);

    // 3. 현재 값들을 타입별로 맵으로 변환
    const currentSettingsMap = new Map();
    currentSettings.forEach((setting) => {
      currentSettingsMap.set(
        `${setting.filter_type}:${setting.filter_value}`,
        setting.is_enabled,
      );
    });

    // 4. DB에서 가져온 현재 값들의 집합 생성
    const newValuesSet = new Set([
      ...dates.map((d) => `date:${d.value}`),
      ...brands.map((b) => `brand:${b.value}`),
      ...categories.map((c) => `category:${c.value}`),
    ]);

    // 5. 더 이상 DB에 없는 값들을 필터 설정에서 제거
    const outdatedSettings = Array.from(currentSettingsMap.keys()).filter(
      (key) => !newValuesSet.has(key),
    );

    if (outdatedSettings.length > 0) {
      const deletePromises = outdatedSettings.map((key) => {
        const [type, value] = key.split(":");
        return conn.query(
          "DELETE FROM filter_settings WHERE filter_type = ? AND filter_value = ?",
          [type, value],
        );
      });
      await Promise.all(deletePromises);
    }

    // 6. 새로운 값들 추가 (기존 값은 유지)
    const insertPromises = [];
    const processNewValue = (type, value) => {
      const key = `${type}:${value}`;
      if (!currentSettingsMap.has(key)) {
        insertPromises.push(
          conn.query(
            `
            INSERT IGNORE INTO filter_settings (filter_type, filter_value, is_enabled)
            VALUES (?, ?, TRUE)
          `,
            [type, value],
          ),
        );
      }
    };

    dates.forEach((d) => processNewValue("date", d.value));
    brands.forEach((b) => processNewValue("brand", b.value));
    categories.forEach((c) => processNewValue("category", c.value));

    if (insertPromises.length > 0) {
      await Promise.all(insertPromises);
    }

    // 오늘 이전의 날짜 필터 삭제
    await conn.query(`
      DELETE FROM filter_settings
      WHERE filter_type = 'date'
      AND filter_value < CURDATE()
    `);

    // 필터 설정 동기화
    await syncFilterSettingsToItems();

    return {
      added: insertPromises.length,
      removed: outdatedSettings.length,
      maintained: currentSettings.length - outdatedSettings.length,
    };
  } catch (error) {
    console.error("Error initializing filter settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 필터 설정을 crawled_items.is_enabled에 동기화
 */
async function syncFilterSettingsToItems() {
  console.log("Syncing crawled_items.is_enabled...");
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      UPDATE crawled_items ci
      SET is_enabled = CASE 
        WHEN EXISTS (
          SELECT 1 FROM filter_settings fs1 
          WHERE fs1.filter_type = 'brand' 
          AND fs1.filter_value = ci.brand 
          AND fs1.is_enabled = 1
        )
        AND EXISTS (
          SELECT 1 FROM filter_settings fs2 
          WHERE fs2.filter_type = 'category' 
          AND fs2.filter_value = ci.category 
          AND fs2.is_enabled = 1
        )
        AND (
          ci.bid_type = 'instant'
          OR EXISTS (
            SELECT 1 FROM filter_settings fs3 
            WHERE fs3.filter_type = 'date' 
            AND fs3.filter_value = DATE(ci.scheduled_date)
            AND fs3.is_enabled = 1
          )
        )
        THEN 1 
        ELSE 0 
      END
    `);
    console.log("✅ Filter sync completed");
    return { success: true };
  } catch (error) {
    console.error("❌ Error during filter sync:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// ==========================================
// 2. RECOMMEND SETTINGS
// ==========================================

async function getRecommendSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT id, rule_name, conditions, recommend_score, is_enabled 
      FROM recommend_settings 
      ORDER BY recommend_score DESC
    `);
    return rows;
  } catch (error) {
    console.error("Error getting recommend settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function addRecommendSetting(ruleName, conditions, recommendScore) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO recommend_settings (rule_name, conditions, recommend_score, is_enabled)
       VALUES (?, ?, ?, 1)`,
      [ruleName, JSON.stringify(conditions), recommendScore],
    );
    return { ruleName, conditions, recommendScore };
  } catch (error) {
    console.error("Error adding recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateRecommendSetting(
  id,
  ruleName,
  conditions,
  recommendScore,
  isEnabled,
) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE recommend_settings 
       SET rule_name = ?, conditions = ?, recommend_score = ?, is_enabled = ?
       WHERE id = ?`,
      [ruleName, JSON.stringify(conditions), recommendScore, isEnabled, id],
    );
    return { id, ruleName, conditions, recommendScore, isEnabled };
  } catch (error) {
    console.error("Error updating recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteRecommendSetting(id) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `DELETE FROM recommend_settings WHERE id = ?`,
      [id],
    );
    return result.affectedRows > 0;
  } catch (error) {
    console.error("Error deleting recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateRecommendSettingsBatch(settings) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const results = [];
    for (const setting of settings) {
      const { id, ruleName, conditions, recommendScore, isEnabled } = setting;

      const [result] = await conn.query(
        `UPDATE recommend_settings 
         SET rule_name = ?, conditions = ?, recommend_score = ?, is_enabled = ?
         WHERE id = ?`,
        [ruleName, JSON.stringify(conditions), recommendScore, isEnabled, id],
      );

      if (result.affectedRows > 0) {
        results.push({ id, updated: true });
      } else {
        results.push({ id, updated: false, error: "Rule not found" });
      }
    }

    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback();
    console.error("Error batch updating recommend settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

function buildRecommendWhereClause(conditions) {
  const whereClauses = [];
  const params = [];

  for (const [field, condition] of Object.entries(conditions)) {
    switch (condition.operator) {
      case "IN":
        if (condition.values && condition.values.length > 0) {
          whereClauses.push(
            `ci.${field} IN (${condition.values.map(() => "?").join(",")})`,
          );
          params.push(...condition.values);
        }
        break;

      case "BETWEEN":
        if (field === "starting_price") {
          whereClauses.push(`(ci.${field} + 0) BETWEEN ? AND ?`);
          params.push(condition.min, condition.max);
        } else if (field === "scheduled_date") {
          whereClauses.push(`DATE(ci.${field}) BETWEEN ? AND ?`);
          params.push(condition.start, condition.end);
        }
        break;

      case "CONTAINS":
        if (condition.keywords && condition.keywords.length > 0) {
          const keywordClauses = condition.keywords.map(
            () => `ci.${field} LIKE ?`,
          );
          whereClauses.push(`(${keywordClauses.join(" OR ")})`);
          condition.keywords.forEach((keyword) => {
            params.push(`%${keyword}%`);
          });
        }
        break;
    }
  }

  return { whereClause: whereClauses.join(" AND "), params };
}

/**
 * 추천 설정을 crawled_items.recommend에 동기화
 */
async function syncRecommendSettingsToItems() {
  console.log("Syncing crawled_items.recommend...");
  const conn = await pool.getConnection();
  try {
    // 모든 아이템을 0으로 초기화
    await conn.query(`UPDATE crawled_items SET recommend = 0`);

    // 활성화된 추천 규칙들을 점수 순으로 조회
    const [rows] = await conn.query(`
      SELECT id, rule_name, conditions, recommend_score, is_enabled 
      FROM recommend_settings 
      WHERE is_enabled = 1
      ORDER BY recommend_score DESC
    `);

    // 각 규칙을 순차적으로 적용
    for (const setting of rows) {
      const conditions = JSON.parse(setting.conditions);
      const { whereClause, params } = buildRecommendWhereClause(conditions);

      if (whereClause) {
        await conn.query(
          `
          UPDATE crawled_items ci
          SET recommend = ?
          WHERE (${whereClause}) AND recommend < ?
        `,
          [setting.recommend_score, ...params, setting.recommend_score],
        );
      }
    }

    console.log("✅ Recommend sync completed");
    return { success: true };
  } catch (error) {
    console.error("❌ Error during recommend sync:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// ==========================================
// 3. EXPIRED STATUS (is_expired)
// ==========================================

let syncDirectRunning = false;

/**
 * Direct 입찰의 만료 상태 업데이트 (실시간)
 * 자동 실행: 1분마다
 */
async function syncDirectExpiredStatus() {
  if (syncDirectRunning) {
    console.log("⏭️  Previous sync still running, skipping...");
    return { success: false, skipped: true };
  }

  syncDirectRunning = true;
  const conn = await pool.getConnection();
  try {
    // 1. 만료되어야 하는데 아직 is_expired = 0인 것들
    const [expireResult] = await conn.query(`
      UPDATE crawled_items
      SET is_expired = 1
      WHERE bid_type = 'direct'
        AND scheduled_date <= NOW()
        AND is_expired = 0
    `);

    // 2. 만료 해제되어야 하는데 아직 is_expired = 1인 것들
    const [unexpireResult] = await conn.query(`
      UPDATE crawled_items
      SET is_expired = 0
      WHERE bid_type = 'direct'
        AND scheduled_date > NOW()
        AND is_expired = 1
    `);

    const totalUpdated = expireResult.changedRows + unexpireResult.changedRows;
    if (totalUpdated > 0) {
      console.log(
        `✅ Direct expired sync: ${totalUpdated} rows updated (expired: ${expireResult.changedRows}, unexpired: ${unexpireResult.changedRows})`,
      );
    }
    return {
      success: true,
      expired: expireResult.changedRows,
      unexpired: unexpireResult.changedRows,
    };
  } catch (error) {
    console.error("❌ Error syncing direct expired status:", error);
    throw error;
  } finally {
    conn.release();
    syncDirectRunning = false;
  }
}

/**
 * Live 입찰의 만료 상태 업데이트 (날짜 기준)
 * 자동 실행: 1시간마다
 */
async function syncLiveExpiredStatus() {
  const conn = await pool.getConnection();
  try {
    // 1. 만료되어야 하는데 아직 is_expired = 0인 것들
    // (입찰이 없고 scheduled_date 지남)
    const [expireResult] = await conn.query(`
      UPDATE crawled_items ci
      SET is_expired = 1
      WHERE bid_type = 'live'
        AND is_expired = 0
        AND scheduled_date <= NOW()
    `);

    // 2. 만료 해제되어야 하는데 아직 is_expired = 1인 것들
    // (입찰이 생겼고 scheduled_date 당일이거나 미래)
    const [unexpireResult] = await conn.query(`
      UPDATE crawled_items ci
      SET is_expired = 0
      WHERE bid_type = 'live'
        AND is_expired = 1
        AND scheduled_date > NOW()
    `);

    const totalUpdated = expireResult.changedRows + unexpireResult.changedRows;
    if (totalUpdated > 0) {
      console.log(
        `✅ Live expired sync: ${totalUpdated} rows updated (expired: ${expireResult.changedRows}, unexpired: ${unexpireResult.changedRows})`,
      );
    }
    return {
      success: true,
      expired: expireResult.changedRows,
      unexpired: unexpireResult.changedRows,
    };
  } catch (error) {
    console.error("❌ Error syncing live expired status:", error);
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Instant(바로 구매) 아이템의 만료 상태 업데이트
 * 이미 구매 완료된 아이템은 만료 처리
 */
async function syncInstantExpiredStatus() {
  const conn = await pool.getConnection();
  try {
    // 이미 구매된 아이템 만료 처리
    const [expireResult] = await conn.query(`
      UPDATE crawled_items ci
      SET is_expired = 1
      WHERE ci.bid_type = 'instant'
        AND ci.is_expired = 0
        AND EXISTS (
          SELECT 1 FROM instant_purchases ip 
          WHERE ip.item_id = ci.item_id 
            AND ip.status IN ('pending', 'completed')
        )
    `);

    const totalUpdated = expireResult.changedRows;
    if (totalUpdated > 0) {
      console.log(`✅ Instant expired sync: ${totalUpdated} rows updated`);
    }
    return {
      success: true,
      expired: expireResult.changedRows,
    };
  } catch (error) {
    console.error("❌ Error syncing instant expired status:", error);
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 모든 expired 상태 업데이트 (통합)
 * 수동 호출: 크롤링 완료 시
 */
async function syncAllExpiredStatus() {
  console.log("Syncing all expired status...");
  try {
    await syncDirectExpiredStatus();
    await syncLiveExpiredStatus();
    await syncInstantExpiredStatus();
    console.log("✅ All expired sync completed");
    return { success: true };
  } catch (error) {
    console.error("❌ Error syncing all expired status:", error);
    throw error;
  }
}

// ==========================================
// 4. SCHEDULER
// ==========================================

/**
 * Direct 입찰 만료 체크 시작 (1분마다)
 */
function startDirectExpiredSync() {
  if (directInterval) {
    console.log("⚠️  Direct expired sync already running");
    return;
  }

  console.log("🚀 Starting direct expired sync (every 1 minute)");

  // 즉시 한 번 실행
  syncDirectExpiredStatus().catch(console.error);

  // 1분마다 실행
  directInterval = setInterval(() => {
    syncDirectExpiredStatus().catch(console.error);
  }, 60 * 1000);
}

/**
 * Live 입찰 만료 체크 시작 (1시간마다)
 */
function startLiveExpiredSync() {
  if (liveInterval) {
    console.log("⚠️  Live expired sync already running");
    return;
  }

  console.log("🚀 Starting live expired sync (every 1 hour)");

  // 즉시 한 번 실행
  syncLiveExpiredStatus().catch(console.error);

  // 5분마다 실행
  liveInterval = setInterval(
    () => {
      syncLiveExpiredStatus().catch(console.error);
    },
    5 * 60 * 1000,
  );
}

/**
 * 모든 스케줄러 시작
 */
function startExpiredSchedulers() {
  startDirectExpiredSync();
  startLiveExpiredSync();
}

/**
 * 모든 스케줄러 중지
 */
function stopExpiredSchedulers() {
  if (directInterval) {
    clearInterval(directInterval);
    directInterval = null;
    console.log("🛑 Direct expired sync stopped");
  }

  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
    console.log("🛑 Live expired sync stopped");
  }
}

// ==========================================
// 5. ALL-IN-ONE SYNC
// ==========================================

/**
 * 모든 전처리 데이터 동기화
 * 트리거: 크롤링 완료 시
 */
async function syncAllData() {
  console.log("🔄 Starting full data synchronization...");
  try {
    await initializeFilterSettings();
    await syncRecommendSettingsToItems();
    await syncAllExpiredStatus();
    console.log("✅ Full data synchronization completed");
    return { success: true };
  } catch (error) {
    console.error("❌ Error during full sync:", error);
    throw error;
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Filter
  getFilterSettings,
  getEnabledFilters,
  updateFilterSetting,
  initializeFilterSettings,
  syncFilterSettingsToItems,

  // Recommend
  getRecommendSettings,
  addRecommendSetting,
  updateRecommendSetting,
  updateRecommendSettingsBatch,
  deleteRecommendSetting,
  buildRecommendWhereClause,
  syncRecommendSettingsToItems,

  // Expired
  syncDirectExpiredStatus,
  syncLiveExpiredStatus,
  syncInstantExpiredStatus,
  syncAllExpiredStatus,

  // Scheduler
  startExpiredSchedulers,
  stopExpiredSchedulers,

  // All-in-one
  syncAllData,
};
