const express = require("express");
const { pool } = require("../utils/DB");
const { requireAdmin } = require("../utils/adminAuth");
const {
  backfillCompletedWmsItemsByBidStatus,
} = require("../utils/wms-bid-sync");

const router = express.Router();
const BOARD_BACKFILL_INTERVAL_MS = 60 * 1000;
let boardBackfillRunning = false;
let boardBackfillLastRunAt = 0;

const LOCATION_SEEDS = [
  { code: "DOMESTIC_ARRIVAL_ZONE", name: "국내도착존", sort: 10 },
  { code: "INTERNAL_REPAIR_ZONE", name: "내부수선존", sort: 40 },
  { code: "EXTERNAL_REPAIR_ZONE", name: "외부수선존", sort: 45 },
  { code: "REPAIR_DONE_ZONE", name: "수선완료존", sort: 50 },
  { code: "HOLD_ZONE", name: "HOLD존", sort: 60 },
  { code: "OUTBOUND_ZONE", name: "출고존", sort: 70 },
];

const LOCATION_NAME_MAP = LOCATION_SEEDS.reduce((acc, cur) => {
  acc[cur.code] = cur.name;
  return acc;
}, {});
LOCATION_NAME_MAP.REPAIR_TEAM_CHECK_ZONE = "내부수선존";
LOCATION_NAME_MAP.AUTH_ZONE = "출고존";

function normalizeLocationCode(locationCode) {
  if (locationCode === "AUTH_ZONE") return "OUTBOUND_ZONE";
  if (locationCode === "REPAIR_TEAM_CHECK_ZONE") return "INTERNAL_REPAIR_ZONE";
  return locationCode;
}

function isAdmin(req, res, next) {
  return requireAdmin(req, res, next);
}

async function triggerBoardBackfill() {
  const now = Date.now();
  if (boardBackfillRunning) return;
  if (now - boardBackfillLastRunAt < BOARD_BACKFILL_INTERVAL_MS) return;

  boardBackfillRunning = true;
  boardBackfillLastRunAt = now;
  try {
    await backfillCompletedWmsItemsByBidStatus(pool);
  } catch (error) {
    console.error("WMS board backfill error:", error.message);
  } finally {
    boardBackfillRunning = false;
  }
}

async function reconcileDoneCasesToRepairDoneZone() {
  await pool.query(
    `
    UPDATE wms_items i
    INNER JOIN wms_repair_cases rc
      ON rc.item_id = i.id
    SET i.current_location_code = 'REPAIR_DONE_ZONE',
        i.current_status = 'REPAIR_DONE',
        i.updated_at = NOW()
    WHERE UPPER(TRIM(COALESCE(rc.case_state, ''))) = 'DONE'
      AND i.current_status <> 'COMPLETED'
      AND i.current_location_code NOT IN ('REPAIR_DONE_ZONE', 'OUTBOUND_ZONE')
    `,
  );
}

function statusByLocation(locationCode, requestType) {
  const normalizedLocationCode = normalizeLocationCode(locationCode);
  switch (locationCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
    case "INBOUND_ZONE":
      return "DOMESTIC_ARRIVED";
    case "REPAIR_ZONE":
    case "INTERNAL_REPAIR_ZONE":
      return "INTERNAL_REPAIR_IN_PROGRESS";
    case "EXTERNAL_REPAIR_ZONE":
      return "EXTERNAL_REPAIR_IN_PROGRESS";
    case "REPAIR_DONE_ZONE":
      return "REPAIR_DONE";
    case "HOLD_ZONE":
      return "HOLD";
    case "OUTBOUND_ZONE":
      return "OUTBOUND_READY";
    default:
      break;
  }

  switch (normalizedLocationCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
      return "DOMESTIC_ARRIVED";
    case "INTERNAL_REPAIR_ZONE":
      return "INTERNAL_REPAIR_IN_PROGRESS";
    case "EXTERNAL_REPAIR_ZONE":
      return "EXTERNAL_REPAIR_IN_PROGRESS";
    case "REPAIR_DONE_ZONE":
      return "REPAIR_DONE";
    case "HOLD_ZONE":
      return "HOLD";
    case "OUTBOUND_ZONE":
      return "OUTBOUND_READY";
    default:
      return "UNKNOWN";
  }
}

function workflowStageByLocation(locationCode) {
  const normalizedLocationCode = normalizeLocationCode(locationCode);
  switch (normalizedLocationCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
    case "INBOUND_ZONE":
    case "HOLD_ZONE":
      return "domestic_arrived";
    case "REPAIR_ZONE":
    case "INTERNAL_REPAIR_ZONE":
    case "EXTERNAL_REPAIR_ZONE":
    case "REPAIR_DONE_ZONE":
      return "processing";
    case "OUTBOUND_ZONE":
      return "shipped";
    default:
      return null;
  }
}

function isLikelyItemBarcode(barcode) {
  const text = String(barcode || "").trim();
  if (!text) return false;
  const upper = text.toUpperCase();
  if (upper.startsWith("ZONE:") || upper.startsWith("Z:")) return false;
  if (/^(DAZ|RTC|AUT|IRP|ERP|RDN|HLD|OBD)$/.test(upper)) return false;
  if (text.length < 6) return false;
  if (!/[0-9]/.test(text)) return false;
  return true;
}

async function resolveSourceBid(conn, item) {
  if (item?.source_bid_type && item?.source_bid_id) {
    return {
      bidType: String(item.source_bid_type),
      bidId: Number(item.source_bid_id),
    };
  }
  if (!item?.source_item_id) return null;

  const sourceItemId = String(item.source_item_id);
  const [directRows] = await conn.query(
    `
    SELECT id, updated_at
    FROM direct_bids
    WHERE item_id = ?
      AND status = 'completed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [sourceItemId],
  );
  const [liveRows] = await conn.query(
    `
    SELECT id, updated_at
    FROM live_bids
    WHERE item_id = ?
      AND status = 'completed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [sourceItemId],
  );
  const [instantRows] = await conn.query(
    `
    SELECT id, updated_at
    FROM instant_purchases
    WHERE item_id = ?
      AND status = 'completed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [sourceItemId],
  );

  const candidates = [
    directRows[0] ? { bidType: "direct", ...directRows[0] } : null,
    liveRows[0] ? { bidType: "live", ...liveRows[0] } : null,
    instantRows[0] ? { bidType: "instant", ...instantRows[0] } : null,
  ]
    .filter(Boolean)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (!candidates.length) return null;
  return { bidType: candidates[0].bidType, bidId: Number(candidates[0].id) };
}

async function syncBidStatusByLocation(conn, item, toLocationCode) {
  const normalizedToLocationCode = normalizeLocationCode(toLocationCode);
  let nextBidStatus = null;
  if (
    normalizedToLocationCode === "DOMESTIC_ARRIVAL_ZONE" ||
    normalizedToLocationCode === "INBOUND_ZONE" ||
    normalizedToLocationCode === "HOLD_ZONE"
  ) {
    // HOLD_ZONE도 domestic_arrived로 분류 (국내 도착했지만 보류된 상태)
    nextBidStatus = "domestic_arrived";
  } else if (
    normalizedToLocationCode === "REPAIR_ZONE" ||
    normalizedToLocationCode === "INTERNAL_REPAIR_ZONE" ||
    normalizedToLocationCode === "EXTERNAL_REPAIR_ZONE" ||
    normalizedToLocationCode === "REPAIR_DONE_ZONE"
  ) {
    nextBidStatus = "processing";
  } else if (normalizedToLocationCode === "OUTBOUND_ZONE") {
    nextBidStatus = "shipped";
  }

  if (!nextBidStatus) return;
  const resolved = await resolveSourceBid(conn, item);
  if (!resolved) return;
  const { bidType, bidId } = resolved;

  // WMS 스캔 위치에 따라 bid 테이블의 shipping_status를 직접 업데이트한다.
  // status = 'completed'인 경우에만 허용 (불변성 보장)
  const bidTable =
    bidType === "direct"
      ? "direct_bids"
      : bidType === "instant"
        ? "instant_purchases"
        : "live_bids";
  await conn.query(
    `UPDATE ${bidTable} SET shipping_status = ?, updated_at = NOW() WHERE id = ? AND status = 'completed'`,
    [nextBidStatus, bidId],
  );

  // 소스 연결이 비어 있던 기존 WMS 데이터는 여기서 백필한다.
  if (!item.source_bid_type || !item.source_bid_id) {
    await conn.query(
      `
      UPDATE wms_items
      SET source_bid_type = ?, source_bid_id = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [bidType, bidId, item.id],
    );
  }
}

function inferAuctionSource(crawledRow) {
  const raw =
    `${crawledRow?.auc_num || ""} ${crawledRow?.additional_info || ""}`.toLowerCase();
  if (raw.includes("eco")) return "ecoring";
  if (raw.includes("oak")) return "oaknet";
  return null;
}

async function fetchBidRequestInfo(conn, bidType, bidId) {
  if (!bidType || !bidId) {
    return {
      requestType: 0,
      requestLabel: "없음",
      hasAppraisal: false,
      hasRepair: false,
    };
  }

  const tableName =
    bidType === "live"
      ? "live_bids"
      : bidType === "instant"
        ? "instant_purchases"
        : "direct_bids";
  const [rows] = await conn.query(
    `
    SELECT appr_id, repair_requested_at
    FROM ${tableName}
    WHERE id = ?
    LIMIT 1
    `,
    [Number(bidId)],
  );

  const row = rows[0] || {};
  const hasAppr = Boolean(row.appr_id);
  const hasRepair = Boolean(row.repair_requested_at);

  if (hasAppr && hasRepair) {
    return {
      requestType: 3,
      requestLabel: "감정+수선",
      hasAppraisal: true,
      hasRepair: true,
    };
  }
  if (hasAppr) {
    return {
      requestType: 1,
      requestLabel: "감정",
      hasAppraisal: true,
      hasRepair: false,
    };
  }
  if (hasRepair) {
    return {
      requestType: 2,
      requestLabel: "수선",
      hasAppraisal: false,
      hasRepair: true,
    };
  }
  return {
    requestType: 0,
    requestLabel: "없음",
    hasAppraisal: false,
    hasRepair: false,
  };
}

async function getTableColumns(conn, tableName) {
  const [rows] = await conn.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function findCrawledItemByScannedCode(conn, scannedCode) {
  const cols = await getTableColumns(conn, "crawled_items");
  const candidates = [
    "item_id",
    "auc_num",
    "barcode",
    "external_barcode",
    "lot_no",
    "lot_number",
    "original_item_id",
  ].filter((c) => cols.has(c));

  if (!candidates.length) return null;

  const where = candidates.map((c) => `\`${c}\` = ?`).join(" OR ");
  const params = candidates.map(() => scannedCode);
  const orderBy = cols.has("updated_at")
    ? "ORDER BY updated_at DESC"
    : cols.has("created_at")
      ? "ORDER BY created_at DESC"
      : cols.has("id")
        ? "ORDER BY id DESC"
        : "";
  const [rows] = await conn.query(
    `
    SELECT *
    FROM crawled_items
    WHERE ${where}
    ${orderBy}
    LIMIT 1
    `,
    params,
  );
  return rows[0] || null;
}

async function findOwnerByItemId(conn, itemId) {
  const liveCols = await getTableColumns(conn, "live_bids");
  const directCols = await getTableColumns(conn, "direct_bids");
  const instantCols = await getTableColumns(conn, "instant_purchases");
  const liveOrderBy = liveCols.has("updated_at")
    ? "ORDER BY updated_at DESC"
    : liveCols.has("created_at")
      ? "ORDER BY created_at DESC"
      : liveCols.has("id")
        ? "ORDER BY id DESC"
        : "";
  const directOrderBy = directCols.has("updated_at")
    ? "ORDER BY updated_at DESC"
    : directCols.has("created_at")
      ? "ORDER BY created_at DESC"
      : directCols.has("id")
        ? "ORDER BY id DESC"
        : "";
  const instantOrderBy = instantCols.has("updated_at")
    ? "ORDER BY updated_at DESC"
    : instantCols.has("created_at")
      ? "ORDER BY created_at DESC"
      : instantCols.has("id")
        ? "ORDER BY id DESC"
        : "";
  const [liveRows] = await conn.query(
    `
    SELECT user_id,
           ${liveCols.has("updated_at") ? "updated_at" : "NULL AS updated_at"}
    FROM live_bids
    WHERE item_id = ?
    ${liveOrderBy}
    LIMIT 1
    `,
    [itemId],
  );
  const [directRows] = await conn.query(
    `
    SELECT user_id,
           ${directCols.has("updated_at") ? "updated_at" : "NULL AS updated_at"}
    FROM direct_bids
    WHERE item_id = ?
    ${directOrderBy}
    LIMIT 1
    `,
    [itemId],
  );
  const [instantRows] = await conn.query(
    `
    SELECT user_id,
           ${instantCols.has("updated_at") ? "updated_at" : "NULL AS updated_at"}
    FROM instant_purchases
    WHERE item_id = ?
    ${instantOrderBy}
    LIMIT 1
    `,
    [itemId],
  );

  const winner = [liveRows[0], directRows[0], instantRows[0]]
    .filter(Boolean)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];

  if (!winner?.user_id) return null;

  const [users] = await conn.query(
    `
    SELECT id, company_name, login_id
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [winner.user_id],
  );
  return users[0] || null;
}

async function autoCreateItemByScan(conn, scannedCode, toLocationCode) {
  const crawled = await findCrawledItemByScannedCode(conn, scannedCode);
  const owner = crawled?.item_id
    ? await findOwnerByItemId(conn, crawled.item_id)
    : null;

  const uid = `WMS-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const requestType = 0;
  const status = statusByLocation(toLocationCode, requestType);

  const metadata = {
    autoCreated: true,
    sourceMatched: Boolean(crawled),
    crawledItemId: crawled?.item_id || null,
    crawledAucNum: crawled?.auc_num || null,
  };

  const [inserted] = await conn.query(
    `
    INSERT INTO wms_items (
      item_uid, member_name, auction_source, auction_lot_no,
      external_barcode, internal_barcode, request_type,
      current_status, current_location_code, metadata_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      uid,
      owner?.company_name || owner?.login_id || null,
      inferAuctionSource(crawled),
      crawled?.auc_num || null,
      scannedCode,
      null,
      requestType,
      status,
      toLocationCode,
      JSON.stringify(metadata),
    ],
  );

  const [rows] = await conn.query(`SELECT * FROM wms_items WHERE id = ?`, [
    inserted.insertId,
  ]);
  return rows[0];
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wms_locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wms_items (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_uid VARCHAR(40) NOT NULL UNIQUE,
      member_name VARCHAR(100) NULL,
      auction_source VARCHAR(30) NULL,
      auction_lot_no VARCHAR(80) NULL,
      external_barcode VARCHAR(120) NULL,
      internal_barcode VARCHAR(120) NULL,
      request_type TINYINT NOT NULL DEFAULT 0,
      current_status VARCHAR(50) NOT NULL DEFAULT 'DOMESTIC_ARRIVED',
      current_location_code VARCHAR(50) NOT NULL DEFAULT 'DOMESTIC_ARRIVAL_ZONE',
      hold_reason VARCHAR(255) NULL,
      metadata_text LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_external_barcode (external_barcode),
      UNIQUE KEY uq_wms_internal_barcode (internal_barcode),
      KEY idx_wms_items_location (current_location_code),
      KEY idx_wms_items_status (current_status),
      CONSTRAINT fk_wms_items_location_code
        FOREIGN KEY (current_location_code) REFERENCES wms_locations(code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wms_scan_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_id BIGINT NOT NULL,
      barcode_input VARCHAR(120) NOT NULL,
      from_location_code VARCHAR(50) NULL,
      to_location_code VARCHAR(50) NOT NULL,
      prev_status VARCHAR(50) NULL,
      next_status VARCHAR(50) NOT NULL,
      action_type VARCHAR(50) NOT NULL DEFAULT 'MOVE',
      staff_name VARCHAR(100) NULL,
      note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_wms_scan_events_item (item_id),
      KEY idx_wms_scan_events_to_location (to_location_code),
      CONSTRAINT fk_wms_scan_events_item
        FOREIGN KEY (item_id) REFERENCES wms_items(id),
      CONSTRAINT fk_wms_scan_events_from_location
        FOREIGN KEY (from_location_code) REFERENCES wms_locations(code),
      CONSTRAINT fk_wms_scan_events_to_location
        FOREIGN KEY (to_location_code) REFERENCES wms_locations(code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wms_member_onboarding (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      member_name VARCHAR(100) NOT NULL,
      phone VARCHAR(40) NULL,
      signup_sheet_row_id VARCHAR(40) NULL,
      owner_staff_name VARCHAR(100) NULL,
      onboarding_status VARCHAR(50) NOT NULL DEFAULT 'NEW',
      note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_wms_member_onboarding_status (onboarding_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_cases (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_id BIGINT NOT NULL,
      repair_sheet_row_id VARCHAR(40) NULL,
      proposal_status VARCHAR(50) NOT NULL DEFAULT 'REPAIR_PROPOSED',
      work_status VARCHAR(50) NOT NULL DEFAULT 'WAITING',
      result_status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
      note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_wms_repair_cases_item (item_id),
      CONSTRAINT fk_wms_repair_cases_item
        FOREIGN KEY (item_id) REFERENCES wms_items(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  for (const loc of LOCATION_SEEDS) {
    await pool.query(
      `
      INSERT INTO wms_locations (code, name, sort_order, is_active)
      VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        sort_order = VALUES(sort_order),
        is_active = VALUES(is_active)
      `,
      [loc.code, loc.name, loc.sort],
    );
  }

  // 레거시 입고존(INBOUND_ZONE)은 운영에서 제외
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'INBOUND_ZONE'
      `,
    )
    .catch(() => {});

  // 레거시 검수존은 내부수선존으로 이관 후 운영에서 제외
  await pool
    .query(
      `
      UPDATE wms_items
      SET current_location_code = 'INTERNAL_REPAIR_ZONE',
          current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
          updated_at = NOW()
      WHERE current_location_code = 'INSPECT_ZONE'
      `,
    )
    .catch(() => {});
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'INSPECT_ZONE'
      `,
    )
    .catch(() => {});

  // 수선팀검수중존은 내부수선존으로 통합 후 운영에서 제외
  await pool
    .query(
      `
      UPDATE wms_items
      SET current_location_code = 'INTERNAL_REPAIR_ZONE',
          current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
          updated_at = NOW()
      WHERE current_location_code = 'REPAIR_TEAM_CHECK_ZONE'
      `,
    )
    .catch(() => {});
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'REPAIR_TEAM_CHECK_ZONE'
      `,
    )
    .catch(() => {});

  // 감정출력존은 출고존으로 통합 후 운영에서 제외
  await pool
    .query(
      `
      UPDATE wms_items
      SET current_location_code = 'OUTBOUND_ZONE',
          current_status = 'OUTBOUND_READY',
          updated_at = NOW()
      WHERE current_location_code = 'AUTH_ZONE'
      `,
    )
    .catch(() => {});
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'AUTH_ZONE'
      `,
    )
    .catch(() => {});

  // 레거시 수선존(REPAIR_ZONE)은 내부수선존으로 이관 후 운영에서 제외
  await pool
    .query(
      `
      UPDATE wms_items
      SET current_location_code = 'INTERNAL_REPAIR_ZONE',
          current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
          updated_at = NOW()
      WHERE current_location_code = 'REPAIR_ZONE'
      `,
    )
    .catch(() => {});
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'REPAIR_ZONE'
      `,
    )
    .catch(() => {});

  // 출고존/출고완료존 통합: 출고완료존 데이터는 출고존으로 이관
  await pool
    .query(
      `
      UPDATE wms_items
      SET current_location_code = 'OUTBOUND_ZONE',
          current_status = 'SHIPPED',
          updated_at = NOW()
      WHERE current_location_code = 'SHIPPED_ZONE'
      `,
    )
    .catch(() => {});
  await pool
    .query(
      `
      UPDATE wms_locations
      SET is_active = 0
      WHERE code = 'SHIPPED_ZONE'
      `,
    )
    .catch(() => {});

  const wmsColumns = await getTableColumns(pool, "wms_items");
  if (!wmsColumns.has("source_bid_type")) {
    await pool.query(`
      ALTER TABLE wms_items
      ADD COLUMN source_bid_type VARCHAR(20) NULL
    `);
  }
  if (!wmsColumns.has("source_bid_id")) {
    await pool.query(`
      ALTER TABLE wms_items
      ADD COLUMN source_bid_id BIGINT NULL
    `);
  }
  if (!wmsColumns.has("source_item_id")) {
    await pool.query(`
      ALTER TABLE wms_items
      ADD COLUMN source_item_id VARCHAR(120) NULL
    `);
  }
  if (!wmsColumns.has("source_scheduled_date")) {
    await pool.query(`
      ALTER TABLE wms_items
      ADD COLUMN source_scheduled_date DATETIME NULL
    `);
  }

  await pool
    .query(
      `
    CREATE INDEX idx_wms_source_bid ON wms_items (source_bid_type, source_bid_id)
  `,
    )
    .catch(() => {});
  await pool
    .query(
      `
    CREATE INDEX idx_wms_source_item ON wms_items (source_item_id)
  `,
    )
    .catch(() => {});
}

function formatDatePart(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${String(now.getFullYear()).slice(-2)}${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${String(d.getFullYear()).slice(-2)}${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeAuctionCode(aucNum) {
  const raw = String(aucNum || "00")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
  return (raw || "00").slice(0, 3);
}

async function generateInternalBarcode(conn, scheduledDate, aucNum) {
  const datePart = formatDatePart(scheduledDate);
  const aucPart = normalizeAuctionCode(aucNum);
  const prefix = `CB-${datePart}-${aucPart}`;

  const [rows] = await conn.query(
    `
    SELECT internal_barcode
    FROM wms_items
    WHERE internal_barcode LIKE ?
    `,
    [`${prefix}-%`],
  );

  let maxSeq = 0;
  for (const row of rows) {
    const code = row.internal_barcode || "";
    const seq = Number(code.split("-").pop());
    if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
  }

  const nextSeq = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}-${nextSeq}`;
}

function sourceByAuctionNum(aucNum) {
  const key = String(aucNum || "");
  if (key === "1") return "ecoring";
  if (key === "2") return "oaknet";
  if (key === "4") return "mekiki";
  return `auc-${key || "unknown"}`;
}

function toMysqlDatetime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

router.post("/init", isAdmin, async (req, res) => {
  try {
    await ensureTables();
    res.json({ ok: true, message: "WMS tables initialized" });
  } catch (error) {
    console.error("WMS init error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.get("/locations", isAdmin, async (req, res) => {
  try {
    await ensureTables();
    const [rows] = await pool.query(
      `
      SELECT code, name, sort_order
      FROM wms_locations
      WHERE is_active = 1
        AND code <> 'INBOUND_ZONE'
      ORDER BY sort_order ASC
      `,
    );
    res.json({ ok: true, locations: rows });
  } catch (error) {
    console.error("WMS locations error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.post("/items", isAdmin, async (req, res) => {
  const {
    memberName,
    auctionSource,
    auctionLotNo,
    externalBarcode,
    internalBarcode,
    requestType = 0,
    locationCode = "DOMESTIC_ARRIVAL_ZONE",
    metadata,
  } = req.body || {};
  const normalizedLocationCode = normalizeLocationCode(locationCode);

  if (!externalBarcode && !internalBarcode) {
    return res.status(400).json({
      ok: false,
      message: "externalBarcode or internalBarcode required",
    });
  }

  try {
    await ensureTables();
    const uid = `WMS-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const status = statusByLocation(
      normalizedLocationCode,
      Number(requestType),
    );
    const metadataText =
      metadata === undefined ? null : JSON.stringify(metadata);

    const [result] = await pool.query(
      `
      INSERT INTO wms_items (
        item_uid, member_name, auction_source, auction_lot_no,
        external_barcode, internal_barcode, request_type,
        current_status, current_location_code, metadata_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uid,
        memberName || null,
        auctionSource || null,
        auctionLotNo || null,
        externalBarcode || null,
        internalBarcode || null,
        Number(requestType),
        status,
        normalizedLocationCode,
        metadataText,
      ],
    );

    const [rows] = await pool.query(`SELECT * FROM wms_items WHERE id = ?`, [
      result.insertId,
    ]);
    res.json({ ok: true, item: rows[0] });
  } catch (error) {
    console.error("WMS create item error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.get("/items/:barcode", isAdmin, async (req, res) => {
  try {
    await ensureTables();
    const barcode = req.params.barcode;
    const [rows] = await pool.query(
      `
      SELECT * FROM wms_items
      WHERE external_barcode = ? OR internal_barcode = ?
      LIMIT 1
      `,
      [barcode, barcode],
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Item not found" });
    }

    const item = rows[0];
    const [events] = await pool.query(
      `
      SELECT id, barcode_input, from_location_code, to_location_code,
             prev_status, next_status, action_type, staff_name, note, created_at
      FROM wms_scan_events
      WHERE item_id = ?
      ORDER BY id DESC
      LIMIT 50
      `,
      [item.id],
    );

    res.json({ ok: true, item, events });
  } catch (error) {
    console.error("WMS get item error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.post("/scan", isAdmin, async (req, res) => {
  const {
    barcode,
    toLocationCode,
    actionType = "MOVE",
    staffName,
    note,
    holdReason,
  } = req.body || {};

  if (!barcode || !toLocationCode) {
    return res
      .status(400)
      .json({ ok: false, message: "barcode and toLocationCode are required" });
  }
  const normalizedToLocationCode = normalizeLocationCode(toLocationCode);

  let conn;
  try {
    await ensureTables();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [itemRows] = await conn.query(
      `
      SELECT *
      FROM wms_items
      WHERE external_barcode = ? OR internal_barcode = ?
      LIMIT 1
      `,
      [barcode, barcode],
    );

    let item = itemRows[0];
    if (!item) {
      // 국내도착 스캔에서는 미등록 바코드를 자동 등록한다.
      if (
        normalizedToLocationCode === "DOMESTIC_ARRIVAL_ZONE" ||
        normalizedToLocationCode === "INBOUND_ZONE"
      ) {
        if (!isLikelyItemBarcode(barcode)) {
          await conn.rollback();
          return res.status(400).json({
            ok: false,
            message:
              "유효한 물건 바코드만 자동등록됩니다. 숫자가 포함된 물건 바코드를 다시 스캔하세요.",
          });
        }
        item = await autoCreateItemByScan(
          conn,
          barcode,
          normalizedToLocationCode,
        );
      } else {
        await conn.rollback();
        return res.status(404).json({
          ok: false,
          message:
            "Item not found. 국내도착존 스캔으로 먼저 자동등록하거나 수동 등록하세요.",
        });
      }
    }
    const nextStatus = statusByLocation(
      normalizedToLocationCode,
      Number(item.request_type),
    );
    const nextHoldReason =
      normalizedToLocationCode === "HOLD_ZONE" ? holdReason || null : null;

    await conn.query(
      `
      UPDATE wms_items
      SET current_location_code = ?,
          current_status = ?,
          hold_reason = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [normalizedToLocationCode, nextStatus, nextHoldReason, item.id],
    );

    await conn.query(
      `
      INSERT INTO wms_scan_events (
        item_id, barcode_input, from_location_code, to_location_code,
        prev_status, next_status, action_type, staff_name, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.id,
        barcode,
        item.current_location_code,
        normalizedToLocationCode,
        item.current_status,
        nextStatus,
        actionType,
        staffName || null,
        note || null,
      ],
    );

    // 경매관리 상태와 WMS 존 이동을 동기화한다.
    await syncBidStatusByLocation(conn, item, normalizedToLocationCode);

    await conn.commit();

    const [updatedRows] = await pool.query(
      `SELECT * FROM wms_items WHERE id = ?`,
      [item.id],
    );

    const moved = updatedRows[0] || {};
    const fromCode = item.current_location_code || null;
    const toCode = normalizedToLocationCode || null;
    const fromName = LOCATION_NAME_MAP[fromCode] || fromCode || "-";
    const toName = LOCATION_NAME_MAP[toCode] || toCode || "-";
    req.adminActivityContext = {
      menu: "WMS",
      title: "WMS 스캔 처리",
      targetType: "wms_item",
      targetId:
        moved.internal_barcode ||
        moved.external_barcode ||
        item.internal_barcode ||
        item.external_barcode ||
        String(item.id),
      summary: [
        `바코드: ${barcode}`,
        `이동: ${fromName} -> ${toName}`,
        moved.source_bid_type && moved.source_bid_id
          ? `연결경매: ${moved.source_bid_type}#${moved.source_bid_id}`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
      detail: {
        itemId: item.id,
        internalBarcode: moved.internal_barcode || null,
        externalBarcode: moved.external_barcode || null,
        fromLocationCode: fromCode,
        toLocationCode: toCode,
        nextStatus: nextStatus,
        sourceBidType: moved.source_bid_type || null,
        sourceBidId: moved.source_bid_id || null,
      },
    };

    res.json({ ok: true, item: updatedRows[0] });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("WMS scan error:", error);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    if (conn) conn.release();
  }
});

router.get("/board", isAdmin, async (req, res) => {
  try {
    await ensureTables();
    triggerBoardBackfill().catch(() => {});
    await reconcileDoneCasesToRepairDoneZone();
    const [locations] = await pool.query(
      `
      SELECT code, name, sort_order
      FROM wms_locations
      WHERE is_active = 1
        AND code <> 'INBOUND_ZONE'
      ORDER BY sort_order ASC
      `,
    );

    const [counts] = await pool.query(
      `
      SELECT i.current_location_code AS code, COUNT(DISTINCT i.id) AS cnt
      FROM wms_items i
      WHERE i.current_status <> 'COMPLETED'
        AND (
          NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL
          OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL
        )
        AND CHAR_LENGTH(
          COALESCE(
            NULLIF(TRIM(i.internal_barcode), ''),
            NULLIF(TRIM(i.external_barcode), '')
          )
        ) >= 6
        AND COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) REGEXP '[0-9]'
      GROUP BY i.current_location_code
      `,
    );

    const [recent] = await pool.query(
      `
      SELECT
        i.id,
        i.item_uid,
        i.member_name,
        i.auction_source,
        i.auction_lot_no,
        i.external_barcode,
        i.internal_barcode,
        COALESCE(
          NULLIF(i.source_bid_type, ''),
          CASE
            WHEN d.id IS NOT NULL THEN 'direct'
            WHEN l.id IS NOT NULL THEN 'live'
            WHEN ip.id IS NOT NULL THEN 'instant'
            ELSE NULL
          END
        ) AS source_bid_type,
        COALESCE(i.source_bid_id, d.id, l.id, ip.id) AS source_bid_id,
        i.source_item_id,
        i.current_status,
        i.current_location_code,
        i.updated_at,
        (
          SELECT MIN(se.created_at)
          FROM wms_scan_events se
          WHERE se.item_id = i.id
            AND se.to_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE')
        ) AS domestic_arrived_at,
        (
          SELECT MIN(se.created_at)
          FROM wms_scan_events se
          WHERE se.item_id = i.id
            AND se.to_location_code IN (
              'REPAIR_TEAM_CHECK_ZONE',
              'REPAIR_ZONE',
              'INTERNAL_REPAIR_ZONE',
              'EXTERNAL_REPAIR_ZONE',
              'REPAIR_DONE_ZONE'
            )
        ) AS processing_started_at,
        (
          SELECT MAX(se.created_at)
          FROM wms_scan_events se
          WHERE se.item_id = i.id
        ) AS last_scan_at,
        COALESCE(
          NULLIF(TRIM(ci.image), ''),
          CASE
            WHEN JSON_VALID(ci.additional_images) THEN
              NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
            ELSE NULL
          END,
          ''
        ) AS product_image,
        COALESCE(ci.original_title, ci.title) AS product_title,
        COALESCE(u.company_name, i.member_name) AS company_name,
        CASE
          WHEN JSON_VALID(ci.additional_info)
          THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_info, '$.itemNo')), '')
          ELSE NULL
        END AS product_item_no,
        COALESCE(ci.auc_num, i.auction_lot_no) AS auc_num
      FROM wms_items i
      LEFT JOIN direct_bids d
        ON i.source_bid_type = 'direct'
       AND i.source_bid_id = d.id
      LEFT JOIN live_bids l
        ON i.source_bid_type = 'live'
       AND i.source_bid_id = l.id
      LEFT JOIN instant_purchases ip
        ON i.source_bid_type = 'instant'
       AND i.source_bid_id = ip.id
      LEFT JOIN crawled_items ci
        ON CONVERT(ci.item_id USING utf8mb4) =
           CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
      LEFT JOIN users u
        ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
      WHERE i.current_status <> 'COMPLETED'
        AND (
          NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL
          OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL
        )
        AND CHAR_LENGTH(
          COALESCE(
            NULLIF(TRIM(i.internal_barcode), ''),
            NULLIF(TRIM(i.external_barcode), '')
          )
        ) >= 6
        AND COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) REGEXP '[0-9]'
      ORDER BY i.updated_at DESC
      LIMIT 200
      `,
    );

    const countMap = {};
    for (const row of counts) countMap[row.code] = Number(row.cnt);

    const board = locations.map((loc) => ({
      ...loc,
      count: countMap[loc.code] || 0,
    }));

    res.json({ ok: true, board, items: recent });
  } catch (error) {
    console.error("WMS board error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.get("/auction-completed", isAdmin, async (req, res) => {
  const { scheduledDate, aucNum } = req.query || {};
  if (!scheduledDate) {
    return res
      .status(400)
      .json({ ok: false, message: "scheduledDate(YYYY-MM-DD) is required" });
  }

  try {
    await ensureTables();

    const params = [scheduledDate];
    const aucCondition = aucNum ? "AND i.auc_num = ?" : "";
    if (aucNum) params.push(String(aucNum));

    const [liveRows] = await pool.query(
      `
      SELECT
        'live' AS bid_type,
        l.id AS bid_id,
        l.item_id,
        l.status,
        l.winning_price,
        i.auc_num,
        i.original_title,
        i.brand,
        i.category,
        COALESCE(i.original_scheduled_date, i.scheduled_date) AS scheduled_at,
        u.company_name,
        w.id AS wms_item_id,
        w.internal_barcode
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN wms_items w
        ON w.source_bid_type = 'live' AND w.source_bid_id = l.id
      WHERE DATE(COALESCE(i.original_scheduled_date, i.scheduled_date)) = ?
        ${aucCondition}
        AND l.status = 'completed'
      ORDER BY i.auc_num ASC, i.original_scheduled_date ASC, l.id ASC
      `,
      params,
    );

    const [directRows] = await pool.query(
      `
      SELECT
        'direct' AS bid_type,
        d.id AS bid_id,
        d.item_id,
        d.status,
        d.winning_price,
        i.auc_num,
        i.original_title,
        i.brand,
        i.category,
        COALESCE(i.original_scheduled_date, i.scheduled_date) AS scheduled_at,
        u.company_name,
        w.id AS wms_item_id,
        w.internal_barcode
      FROM direct_bids d
      JOIN crawled_items i ON d.item_id = i.item_id
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN wms_items w
        ON w.source_bid_type = 'direct' AND w.source_bid_id = d.id
      WHERE DATE(COALESCE(i.original_scheduled_date, i.scheduled_date)) = ?
        ${aucCondition}
        AND d.status = 'completed'
      ORDER BY i.auc_num ASC, i.original_scheduled_date ASC, d.id ASC
      `,
      params,
    );

    const [instantRows] = await pool.query(
      `
      SELECT
        'instant' AS bid_type,
        ip.id AS bid_id,
        ip.item_id,
        ip.status,
        ip.purchase_price AS winning_price,
        i.auc_num,
        i.original_title,
        i.brand,
        i.category,
        COALESCE(i.original_scheduled_date, i.scheduled_date) AS scheduled_at,
        u.company_name,
        w.id AS wms_item_id,
        w.internal_barcode
      FROM instant_purchases ip
      JOIN crawled_items i ON ip.item_id = i.item_id
      LEFT JOIN users u ON ip.user_id = u.id
      LEFT JOIN wms_items w
        ON w.source_bid_type = 'instant' AND w.source_bid_id = ip.id
      WHERE DATE(COALESCE(i.original_scheduled_date, i.scheduled_date)) = ?
        ${aucCondition}
        AND ip.status = 'completed'
      ORDER BY i.auc_num ASC, i.original_scheduled_date ASC, ip.id ASC
      `,
      params,
    );

    const rows = [...liveRows, ...directRows, ...instantRows];
    res.json({ ok: true, items: rows });
  } catch (error) {
    console.error("WMS auction-completed error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.post("/auction-labels", isAdmin, async (req, res) => {
  const { items, requestType = 0 } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, message: "items is required" });
  }

  let conn;
  try {
    await ensureTables();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const labels = [];

    for (const row of items) {
      const bidType = row.bid_type || row.bidType;
      const bidId = Number(row.bid_id || row.bidId);
      const itemId = String(row.item_id || row.itemId || "");
      const aucNum = String(
        row.auc_num ||
          row.aucNum ||
          row.auction_lot_no ||
          row.auctionLotNo ||
          "",
      );
      const scheduledAt = row.scheduled_at || row.scheduledAt || null;
      const scheduledAtForDb = toMysqlDatetime(scheduledAt);

      if (!bidType || !bidId || !itemId) continue;

      const [foundRows] = await conn.query(
        `
        SELECT *
        FROM wms_items
        WHERE source_bid_type = ? AND source_bid_id = ?
        LIMIT 1
        `,
        [bidType, bidId],
      );

      const reqInfo = await fetchBidRequestInfo(conn, bidType, bidId);
      const effectiveRequestType = Number.isFinite(Number(requestType))
        ? Number(requestType) || reqInfo.requestType
        : reqInfo.requestType;

      let wmsItem = foundRows[0];
      let internalBarcode = wmsItem?.internal_barcode || null;

      if (!internalBarcode) {
        internalBarcode = await generateInternalBarcode(
          conn,
          scheduledAt,
          aucNum,
        );
      }

      if (!wmsItem) {
        const uid = `WMS-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const status = "DOMESTIC_ARRIVED";
        const locationCode = "DOMESTIC_ARRIVAL_ZONE";
        const metadata = {
          generatedFrom: "auction-completed",
          title: row.original_title || null,
          brand: row.brand || null,
          category: row.category || null,
        };

        const [ins] = await conn.query(
          `
          INSERT INTO wms_items (
            item_uid, member_name, auction_source, auction_lot_no,
            external_barcode, internal_barcode, request_type,
            current_status, current_location_code, metadata_text,
            source_bid_type, source_bid_id, source_item_id, source_scheduled_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            uid,
            row.company_name || null,
            sourceByAuctionNum(aucNum),
            itemId,
            null,
            internalBarcode,
            effectiveRequestType,
            status,
            locationCode,
            JSON.stringify(metadata),
            bidType,
            bidId,
            itemId,
            scheduledAtForDb,
          ],
        );

        const [newRows] = await conn.query(
          `SELECT * FROM wms_items WHERE id = ? LIMIT 1`,
          [ins.insertId],
        );
        wmsItem = newRows[0];
      } else {
        const patchFields = [];
        const patchParams = [];

        if (!wmsItem.internal_barcode) {
          patchFields.push("internal_barcode = ?");
          patchParams.push(internalBarcode);
          wmsItem.internal_barcode = internalBarcode;
        }

        if (Number(wmsItem.request_type || 0) !== effectiveRequestType) {
          patchFields.push("request_type = ?");
          patchParams.push(effectiveRequestType);
          wmsItem.request_type = effectiveRequestType;
        }

        if (patchFields.length > 0) {
          patchFields.push("updated_at = NOW()");
          await conn.query(
            `
            UPDATE wms_items
            SET ${patchFields.join(", ")}
            WHERE id = ?
            `,
            [...patchParams, wmsItem.id],
          );
        }
      }

      // 라벨 생성 시점: bid 테이블 shipping_status = 'domestic_arrived' 로 전환
      // (WMS 아이템이 DOMESTIC_ARRIVAL_ZONE에 등록됨 = 국내 도착 처리)
      const bidTableForLabel =
        bidType === "direct"
          ? "direct_bids"
          : bidType === "instant"
            ? "instant_purchases"
            : "live_bids";
      await conn.query(
        `UPDATE ${bidTableForLabel} SET shipping_status = 'domestic_arrived', updated_at = NOW() WHERE id = ? AND status = 'completed'`,
        [bidId],
      );

      labels.push({
        bid_type: bidType,
        bid_id: bidId,
        item_id: itemId,
        auc_num: aucNum,
        scheduled_at: scheduledAt,
        customer_name: row.company_name || "",
        company_name: row.company_name || "",
        original_title: row.original_title || "",
        internal_barcode: wmsItem.internal_barcode,
        request_type: effectiveRequestType,
        request_label: reqInfo.requestLabel,
        has_appraisal: Boolean(reqInfo.hasAppraisal),
      });
    }

    await conn.commit();
    res.json({ ok: true, labels });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("WMS auction-labels error:", error);
    res.status(500).json({ ok: false, message: error.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
