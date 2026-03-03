const express = require("express");
const path = require("path");
const { google } = require("googleapis");
const { pool } = require("../utils/DB");
const { requireAdmin } = require("../utils/adminAuth");
const {
  backfillCompletedWmsItemsByBidStatus,
} = require("../utils/wms-bid-sync");

const router = express.Router();
const INTERNAL_VENDOR_NAME = "까사(내부)";
const DEFAULT_REPAIR_MAIN_SHEET_NAME = "수선_전체현황";
const DEFAULT_REPAIR_COMPLETED_SHEET_NAME = "수선_완료내역";
const VENDOR_ACTIVE_SHEET_NAME = "진행중";
const VENDOR_COMPLETED_SHEET_NAME = "수선완료";
const SHEET_SETTING_KEYS = {
  MAIN_OVERVIEW: "MAIN_OVERVIEW",
  COMPLETED_HISTORY: "COMPLETED_HISTORY",
};

const DEFAULT_VENDORS = [
  "리리",
  "크리뉴",
  "성신사(종로)",
  "연희",
  INTERNAL_VENDOR_NAME,
];

const REPAIR_CASE_STATES = {
  ARRIVED: "ARRIVED",
  DRAFT: "DRAFT",
  READY_TO_SEND: "READY_TO_SEND",
  PROPOSED: "PROPOSED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  DONE: "DONE",
};

const REPAIR_STAGE_CODES = {
  DOMESTIC: "DOMESTIC",
  EXTERNAL_WAITING: "EXTERNAL_WAITING",
  READY_TO_SEND: "READY_TO_SEND",
  PROPOSED: "PROPOSED",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
};

let sheetsClientPromise = null;
const SHEET_IMAGE_BASE_URL = String(
  process.env.FRONTEND_URL || "https://casastrade.com",
)
  .trim()
  .replace(/\/+$/, "");
const batchReconcileJobState = {
  runId: 0,
  running: false,
  requestedBy: null,
  startedAt: null,
  finishedAt: null,
  summary: null,
  error: null,
};

function isAdmin(req, res, next) {
  return requireAdmin(req, res, next);
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

async function ensureRepairTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_vendors (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      sheet_url VARCHAR(600) NULL,
      sheet_id VARCHAR(180) NULL,
      sheet_gid VARCHAR(40) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_repair_vendor_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_cases (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_id BIGINT NOT NULL,
      decision_type VARCHAR(30) NULL,
      vendor_name VARCHAR(120) NULL,
      repair_note TEXT NULL,
      repair_amount DECIMAL(14,2) NULL,
      repair_eta VARCHAR(120) NULL,
      proposal_text LONGTEXT NULL,
      internal_note TEXT NULL,
      case_state VARCHAR(30) NOT NULL DEFAULT 'PROPOSED',
      proposed_at DATETIME NULL,
      accepted_at DATETIME NULL,
      rejected_at DATETIME NULL,
      completed_at DATETIME NULL,
      external_sent_at DATETIME NULL,
      external_synced_at DATETIME NULL,
      internal_sent_at DATETIME NULL,
      internal_synced_at DATETIME NULL,
      created_by VARCHAR(100) NULL,
      updated_by VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_repair_cases_item (item_id),
      KEY idx_wms_repair_cases_updated_at (updated_at),
      CONSTRAINT fk_wms_repair_cases_item
        FOREIGN KEY (item_id) REFERENCES wms_items(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_sheet_settings (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(60) NOT NULL,
      sheet_url VARCHAR(600) NULL,
      sheet_id VARCHAR(180) NULL,
      sheet_gid VARCHAR(40) NULL,
      updated_by VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_repair_sheet_settings_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const vendorCols = await getTableColumns(conn, "wms_repair_vendors");
  if (!vendorCols.has("sheet_url")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_url VARCHAR(600) NULL`,
    );
  }
  if (!vendorCols.has("sheet_id")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_id VARCHAR(180) NULL`,
    );
  }
  if (!vendorCols.has("sheet_gid")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_gid VARCHAR(40) NULL`,
    );
  }

  const caseCols = await getTableColumns(conn, "wms_repair_cases");
  if (!caseCols.has("decision_type")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN decision_type VARCHAR(30) NULL`,
    );
  }
  if (!caseCols.has("vendor_name")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN vendor_name VARCHAR(120) NULL`,
    );
  }
  if (!caseCols.has("repair_note")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_note TEXT NULL`,
    );
  }
  if (!caseCols.has("repair_amount")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_amount DECIMAL(14,2) NULL`,
    );
  }
  if (!caseCols.has("repair_eta")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_eta VARCHAR(120) NULL`,
    );
  }
  if (!caseCols.has("proposal_text")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN proposal_text LONGTEXT NULL`,
    );
  }
  if (!caseCols.has("internal_note")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN internal_note TEXT NULL`,
    );
  }
  if (!caseCols.has("created_by")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN created_by VARCHAR(100) NULL`,
    );
  }
  if (!caseCols.has("updated_by")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN updated_by VARCHAR(100) NULL`,
    );
  }
  if (!caseCols.has("case_state")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN case_state VARCHAR(30) NOT NULL DEFAULT 'PROPOSED'`,
    );
  }
  if (!caseCols.has("proposed_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN proposed_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("accepted_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN accepted_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("rejected_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN rejected_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("completed_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN completed_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("external_synced_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN external_synced_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("external_sent_at")) {
    try {
      await conn.query(
        `ALTER TABLE wms_repair_cases ADD COLUMN external_sent_at DATETIME NULL`,
      );
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  if (!caseCols.has("internal_sent_at")) {
    try {
      await conn.query(
        `ALTER TABLE wms_repair_cases ADD COLUMN internal_sent_at DATETIME NULL`,
      );
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  if (!caseCols.has("internal_synced_at")) {
    try {
      await conn.query(
        `ALTER TABLE wms_repair_cases ADD COLUMN internal_synced_at DATETIME NULL`,
      );
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  await conn.query(
    `
    UPDATE wms_repair_cases
    SET case_state = 'PROPOSED'
    WHERE case_state IS NULL OR TRIM(case_state) = ''
    `,
  );

  // 과거 데이터 정합성 보정:
  // 1단계(ARRIVED)인데 외부/내부 수선 정보가 남아 있으면 시트 재전송의 원인이 될 수 있어
  // 앱 시작 시점에 한 번 정리한다.
  await conn.query(
    `
    UPDATE wms_repair_cases
    SET decision_type = NULL,
        vendor_name = NULL,
        repair_note = NULL,
        repair_amount = NULL,
        repair_eta = NULL,
        proposal_text = NULL,
        internal_note = NULL,
        proposed_at = NULL,
        accepted_at = NULL,
        rejected_at = NULL,
        completed_at = NULL,
        external_sent_at = NULL,
        external_synced_at = NULL,
        internal_sent_at = NULL,
        internal_synced_at = NULL,
        updated_at = NOW()
    WHERE UPPER(TRIM(COALESCE(case_state, ''))) = 'ARRIVED'
      AND (
        decision_type IS NOT NULL
        OR vendor_name IS NOT NULL
        OR repair_note IS NOT NULL
        OR repair_amount IS NOT NULL
        OR repair_eta IS NOT NULL
        OR proposal_text IS NOT NULL
        OR internal_note IS NOT NULL
        OR proposed_at IS NOT NULL
        OR accepted_at IS NOT NULL
        OR rejected_at IS NOT NULL
        OR completed_at IS NOT NULL
        OR external_sent_at IS NOT NULL
        OR external_synced_at IS NOT NULL
        OR internal_sent_at IS NOT NULL
        OR internal_synced_at IS NOT NULL
      )
    `,
  );

  for (const name of DEFAULT_VENDORS) {
    await conn.query(
      `
      INSERT INTO wms_repair_vendors (name, is_active)
      VALUES (?, 1)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        updated_at = NOW()
      `,
      [name],
    );
  }
}

function normalizeSheetSettingKey(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  if (raw === "MAIN" || raw === SHEET_SETTING_KEYS.MAIN_OVERVIEW) {
    return SHEET_SETTING_KEYS.MAIN_OVERVIEW;
  }
  if (raw === "COMPLETED" || raw === SHEET_SETTING_KEYS.COMPLETED_HISTORY) {
    return SHEET_SETTING_KEYS.COMPLETED_HISTORY;
  }
  return "";
}

async function getRepairSheetSetting(conn, settingKey) {
  const safeKey = normalizeSheetSettingKey(settingKey);
  if (!safeKey) return null;
  const [rows] = await conn.query(
    `
    SELECT setting_key, sheet_url, sheet_id, sheet_gid, updated_at
    FROM wms_repair_sheet_settings
    WHERE setting_key = ?
    LIMIT 1
    `,
    [safeKey],
  );
  const row = rows[0] || null;
  if (!row) return null;
  return {
    settingKey: row.setting_key,
    sheetUrl: row.sheet_url || null,
    sheetId: row.sheet_id || null,
    sheetGid: row.sheet_gid || null,
    updatedAt: row.updated_at || null,
  };
}

async function upsertRepairSheetSetting(
  conn,
  settingKey,
  sheetUrl,
  updatedBy = "admin",
) {
  const safeKey = normalizeSheetSettingKey(settingKey);
  if (!safeKey)
    return { ok: false, error: "유효하지 않은 시트 설정 키입니다." };
  const parsed = parseGoogleSheetLink(sheetUrl);
  await conn.query(
    `
    INSERT INTO wms_repair_sheet_settings (setting_key, sheet_url, sheet_id, sheet_gid, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sheet_url = VALUES(sheet_url),
      sheet_id = VALUES(sheet_id),
      sheet_gid = VALUES(sheet_gid),
      updated_by = VALUES(updated_by),
      updated_at = NOW()
    `,
    [
      safeKey,
      parsed.sheetUrl,
      parsed.sheetId,
      parsed.sheetGid,
      String(updatedBy || "admin"),
    ],
  );
  return {
    ok: true,
    settingKey: safeKey,
    sheetUrl: parsed.sheetUrl || null,
    sheetId: parsed.sheetId || null,
    sheetGid: parsed.sheetGid || null,
  };
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const compact = String(value).trim().replace(/[,\s]/g, "");
  if (!compact) return null;
  const matched = compact.match(/-?\d+(?:\.\d+)?/);
  if (!matched?.[0]) return null;
  const numeric = Number(matched[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMonthDayKR(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function formatDateForSheet(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const LEADING_ITEM_CODE_RE =
  /^(?:\(\s*\d+(?:[_-]\d+)+\s*\)|\[\s*\d+(?:[_-]\d+)+\s*\]|\d+(?:[_-]\d+)+)\s*/;

function sanitizeProductTitle(title) {
  let value = String(title || "").trim();
  while (true) {
    const next = value.replace(LEADING_ITEM_CODE_RE, "").trim();
    if (next === value) break;
    value = next;
  }
  return value || "상품명 미확인";
}

function buildProposalText({
  companyName,
  productTitle,
  barcode,
  repairNote,
  repairAmount,
  repairEta,
  vendorName,
  scheduledAt,
}) {
  const safeCompany = companyName || "회원사 미확인";
  const safeDate = formatMonthDayKR(scheduledAt) || "(날짜 미확인)";
  const safeTitle = sanitizeProductTitle(productTitle);
  const safeNote = repairNote || "(수선내용 입력 필요)";
  const safeAmount =
    repairAmount != null
      ? `${Number(repairAmount).toLocaleString()}원 (vat 별도)`
      : "(금액 입력 필요)";
  const safeEta = String(repairEta || "").trim() || "(소요기간 입력 필요)";

  return [
    `${safeCompany}`,
    `안녕하세요, ${safeDate} 일 낙찰 상품 중`,
    "",
    `${safeTitle}`,
    "",
    "수선내용 :",
    `${safeNote}`,
    "",
    "소요기간 :",
    `${safeEta}`,
    "",
    "수선금액 :",
    `${safeAmount}`,
    "",
    "진행 여부 회신 부탁드립니다.",
    "감사합니다.",
  ].join("\n");
}

function parseGoogleSheetLink(sheetUrlRaw) {
  const sheetUrl = String(sheetUrlRaw || "").trim();
  if (!sheetUrl) return { sheetUrl: null, sheetId: null, sheetGid: null };
  const idMatch = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = sheetUrl.match(/[?&#]gid=([0-9]+)/);
  return {
    sheetUrl,
    sheetId: idMatch?.[1] || null,
    sheetGid: gidMatch?.[1] || null,
  };
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function getHeaderIndex(headers, candidates) {
  const normalizedCandidates = new Set(
    candidates.map((c) => normalizeHeader(c)),
  );
  return headers.findIndex((header) =>
    normalizedCandidates.has(normalizeHeader(header)),
  );
}

function getHeaderIndexes(headers, candidates) {
  const normalizedCandidates = new Set(
    candidates.map((c) => normalizeHeader(c)),
  );
  return headers.reduce((acc, header, idx) => {
    if (normalizedCandidates.has(normalizeHeader(header))) acc.push(idx);
    return acc;
  }, []);
}

function isCorruptedHeaderRow(headers) {
  const normalized = (headers || [])
    .map((h) => normalizeHeader(h))
    .filter(Boolean);
  if (!normalized.length) return true;
  const unique = new Set(normalized);
  if (normalized.length >= 5 && unique.size <= 1) return true;
  const hasBarcode = getHeaderIndex(headers, SHEET_COL_CANDIDATES.barcode) >= 0;
  const hasQuote = getHeaderIndex(headers, SHEET_COL_CANDIDATES.quote) >= 0;
  return !(hasBarcode && hasQuote);
}

function normalizeBarcode(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^'+/, "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function extractFirstImageValue(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";

  if (/^=IMAGE\s*\(/i.test(text)) {
    return text;
  }

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const first = parsed.find(
          (entry) => typeof entry === "string" && entry.trim(),
        );
        if (first) return first.trim();
      } else if (parsed && typeof parsed === "object") {
        const candidates = [
          parsed.image,
          parsed.url,
          parsed.src,
          parsed.path,
        ].filter((entry) => typeof entry === "string" && entry.trim());
        if (candidates.length > 0) return candidates[0].trim();
      }
    } catch (_) {}
  }

  return text;
}

function toSheetImageFormula(imageUrlRaw) {
  const raw = extractFirstImageValue(imageUrlRaw);
  if (!raw) return "";
  if (/^=IMAGE\s*\(/i.test(raw)) return raw;

  const base = SHEET_IMAGE_BASE_URL || "https://casastrade.com";
  let absoluteUrl = raw;
  if (/^https?:\/\//i.test(raw)) {
    absoluteUrl = raw;
  } else if (raw.startsWith("//")) {
    absoluteUrl = `https:${raw}`;
  } else if (raw.startsWith("/")) {
    absoluteUrl = `${base}${raw}`;
  } else {
    absoluteUrl = `${base}/${raw.replace(/^\/+/, "")}`;
  }

  let targetUrl = absoluteUrl;
  // Google Sheets가 일부 WEBP를 렌더링하지 못하는 경우가 있어 JPG 변환 프록시를 사용한다.
  if (/\.webp(?:[?#].*)?$/i.test(absoluteUrl)) {
    const stripped = absoluteUrl.replace(/^https?:\/\//i, "");
    targetUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg`;
  }

  const safeUrl = targetUrl.replace(/"/g, '""');
  return `=IMAGE("${safeUrl}")`;
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), "service-account-key.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const client = await auth.getClient();
      return google.sheets({ version: "v4", auth: client });
    })();
  }
  return sheetsClientPromise;
}

const SHEET_COL_CANDIDATES = {
  barcode: [
    "internal_barcode",
    "barcode",
    "내부바코드",
    "내부 바코드",
    "바코드",
  ],
  quote: [
    "quote_amount",
    "repair_amount",
    "견적금액",
    "수선금액",
    "견적",
    "금액",
    "견적금액(엔)",
    "견적금액(원)",
    "견적가",
    "수선비",
    "금액(원)",
  ],
  eta: [
    "eta_days",
    "예상일",
    "예상소요일",
    "소요일",
    "예상완료일",
    "예상일자",
    "작업기간",
    "작업 기간",
  ],
  note: ["repair_note", "비고", "메모", "내용", "수선요청내용", "수선내용"],
  title: ["product_title", "title", "상품명", "상품명칭", "제목"],
  vendor: ["vendor_name", "vendor", "외주업체", "외주 업체", "업체"],
  image: ["image", "image_url", "사진", "이미지", "상품이미지", "상품사진"],
  bidDate: [
    "낙찰일자",
    "낙찰일시",
    "예정일시",
    "scheduled_at",
    "scheduled_date",
  ],
  customer: ["고객명", "회원사", "company_name", "member_name"],
  progress: [
    "수선 진행 확정",
    "수선진행확정",
    "수선진행여부",
    "수선 진행여부",
    "진행여부",
    "진행 상태",
    "progress",
  ],
};

function columnIndexToA1(idx) {
  let num = Number(idx) + 1;
  let out = "";
  while (num > 0) {
    const rem = (num - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    num = Math.floor((num - 1) / 26);
  }
  return out || "A";
}

async function resolveTargetSheetAndRows({
  sheets,
  sheetId,
  sheetGid,
  sheetName = "",
  createIfMissing = false,
  fallbackToFirst = true,
}) {
  const book = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const allSheets = Array.isArray(book?.data?.sheets) ? book.data.sheets : [];

  let targetSheet = null;
  const safeSheetName = String(sheetName || "").trim();
  // 탭명이 명시된 경우에는 gid보다 탭명을 우선한다.
  // (진행중/수선완료 분리 동기화 시 반대 탭 삭제에서 오삭제 방지)
  if (safeSheetName) {
    const found = allSheets.find(
      (s) => String(s?.properties?.title || "") === safeSheetName,
    );
    if (found?.properties) targetSheet = found.properties;
  }
  if (!targetSheet && sheetGid && !safeSheetName) {
    const found = allSheets.find(
      (s) => String(s?.properties?.sheetId || "") === String(sheetGid),
    );
    if (found?.properties) targetSheet = found.properties;
  }
  if (!targetSheet && createIfMissing && safeSheetName) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: safeSheetName } } }],
      },
    });
    const props = created?.data?.replies?.[0]?.addSheet?.properties || null;
    if (props?.title) targetSheet = props;
  }
  if (!targetSheet && fallbackToFirst && !safeSheetName) {
    targetSheet = allSheets[0]?.properties || null;
  }
  if (!targetSheet?.title) {
    return { notFound: true, error: "시트 탭을 찾을 수 없습니다." };
  }
  const range = `'${targetSheet.title.replace(/'/g, "''")}'!A1:Z2000`;
  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "FORMULA",
  });
  return {
    targetSheetTitle: targetSheet.title,
    targetSheetId: Number(targetSheet.sheetId),
    rows: valuesRes?.data?.values || [],
  };
}

function findQuoteHeaderInfo(rows) {
  let headerRowIndex = -1;
  let headers = [];
  let barcodeIdx = -1;
  let quoteIdx = -1;
  let etaIdx = -1;
  let noteIdx = -1;
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const candidateHeaders = row.map((h) => String(h || "").trim());
    if (!candidateHeaders.some(Boolean)) continue;

    const candidateBarcodeIdx = getHeaderIndex(
      candidateHeaders,
      SHEET_COL_CANDIDATES.barcode,
    );
    const candidateQuoteIdx = getHeaderIndex(
      candidateHeaders,
      SHEET_COL_CANDIDATES.quote,
    );
    if (candidateBarcodeIdx >= 0 && candidateQuoteIdx >= 0) {
      headerRowIndex = i;
      headers = candidateHeaders;
      barcodeIdx = candidateBarcodeIdx;
      quoteIdx = candidateQuoteIdx;
      etaIdx = getHeaderIndex(candidateHeaders, SHEET_COL_CANDIDATES.eta);
      noteIdx = getHeaderIndex(candidateHeaders, SHEET_COL_CANDIDATES.note);
      break;
    }
  }
  return { headerRowIndex, headers, barcodeIdx, quoteIdx, etaIdx, noteIdx };
}

function findBarcodeHeaderInfo(rows) {
  let headerRowIndex = -1;
  let barcodeIdx = -1;
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const candidateHeaders = row.map((h) => String(h || "").trim());
    if (!candidateHeaders.some(Boolean)) continue;
    const candidateBarcodeIdx = getHeaderIndex(
      candidateHeaders,
      SHEET_COL_CANDIDATES.barcode,
    );
    if (candidateBarcodeIdx >= 0) {
      headerRowIndex = i;
      barcodeIdx = candidateBarcodeIdx;
      break;
    }
  }
  return { headerRowIndex, barcodeIdx };
}

function parseSheetDateSortTs(value) {
  const raw = String(value || "").trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const directTs = new Date(raw).getTime();
  if (Number.isFinite(directTs)) return directTs;
  const normalized = raw.replace(/\./g, "-").replace(/\//g, "-");
  const m = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

function findVendorSheetHeaderInfo(rows) {
  let headerRowIndex = -1;
  let barcodeIdx = -1;
  let bidDateIdx = -1;
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const headers = row.map((h) => String(h || "").trim());
    if (!headers.some(Boolean)) continue;
    const nextBarcodeIdx = getHeaderIndex(
      headers,
      SHEET_COL_CANDIDATES.barcode,
    );
    const nextBidDateIdx = getHeaderIndex(
      headers,
      SHEET_COL_CANDIDATES.bidDate,
    );
    if (nextBarcodeIdx >= 0 && nextBidDateIdx >= 0) {
      headerRowIndex = i;
      barcodeIdx = nextBarcodeIdx;
      bidDateIdx = nextBidDateIdx;
      break;
    }
  }
  return { headerRowIndex, barcodeIdx, bidDateIdx };
}

async function sortVendorSheetRowsByBidDate({
  sheetId,
  sheetGid,
  sheetName,
  fallbackToFirst = true,
}) {
  if (!sheetId) return { ok: false, error: "시트ID가 없습니다." };
  const sheets = await getSheetsClient();
  const resolved = await resolveTargetSheetAndRows({
    sheets,
    sheetId,
    sheetGid,
    sheetName,
    createIfMissing: false,
    fallbackToFirst,
  });
  if (resolved?.notFound) return { ok: true, sorted: false, rowCount: 0 };
  if (resolved.error) return { ok: false, error: resolved.error };

  const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
  if (!rows.length) return { ok: true, sorted: false, rowCount: 0 };

  const { headerRowIndex, barcodeIdx, bidDateIdx } =
    findVendorSheetHeaderInfo(rows);
  if (headerRowIndex < 0 || barcodeIdx < 0 || bidDateIdx < 0) {
    return { ok: true, sorted: false, rowCount: 0 };
  }

  const headRows = rows.slice(0, headerRowIndex + 1);
  const dataRows = rows.slice(headerRowIndex + 1);
  if (dataRows.length <= 1)
    return { ok: true, sorted: false, rowCount: dataRows.length };

  const indexed = dataRows.map((row, idx) => ({ row, idx }));
  const sorted = [...indexed].sort((a, b) => {
    const aTs = parseSheetDateSortTs(a.row?.[bidDateIdx]);
    const bTs = parseSheetDateSortTs(b.row?.[bidDateIdx]);
    if (aTs !== bTs) return aTs - bTs;
    const aBarcode = normalizeBarcode(a.row?.[barcodeIdx]);
    const bBarcode = normalizeBarcode(b.row?.[barcodeIdx]);
    if (aBarcode !== bBarcode) return aBarcode.localeCompare(bBarcode);
    return a.idx - b.idx;
  });
  const changed = sorted.some((entry, idx) => entry.idx !== idx);
  if (!changed) return { ok: true, sorted: false, rowCount: dataRows.length };

  const nextRows = [...headRows, ...sorted.map((entry) => entry.row)];
  const width = Math.max(
    1,
    ...nextRows.map((row) => (Array.isArray(row) ? row.length : 0)),
  );
  const endCell = `${columnIndexToA1(width - 1)}${nextRows.length}`;
  const safeTitle = String(resolved.targetSheetTitle || "").replace(/'/g, "''");
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${safeTitle}'!A1:ZZ5000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${safeTitle}'!A1:${endCell}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: nextRows },
  });
  return { ok: true, sorted: true, rowCount: dataRows.length };
}

async function upsertVendorSheetRow({
  sheetId,
  sheetGid,
  sheetName = "",
  barcode,
  bidDate,
  productTitle,
  customerName,
  repairNote,
  repairAmount,
  workPeriod,
  vendorName,
  productImage,
  progressFlag,
}) {
  if (!sheetId || !barcode) {
    return { error: "시트ID 또는 바코드가 없습니다." };
  }
  const sheets = await getSheetsClient();
  const resolved = await resolveTargetSheetAndRows({
    sheets,
    sheetId,
    sheetGid,
    sheetName,
    createIfMissing: true,
    fallbackToFirst: true,
  });
  if (resolved.error) return { error: resolved.error };

  const title = resolved.targetSheetTitle;
  const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
  const desiredHeaderDefs = [
    {
      key: "bidDate",
      label: "낙찰일자",
      candidates: SHEET_COL_CANDIDATES.bidDate,
    },
    { key: "title", label: "제목", candidates: SHEET_COL_CANDIDATES.title },
    { key: "image", label: "사진", candidates: SHEET_COL_CANDIDATES.image },
    {
      key: "note",
      label: "수선요청내용",
      candidates: SHEET_COL_CANDIDATES.note,
    },
    {
      key: "customer",
      label: "고객명",
      candidates: SHEET_COL_CANDIDATES.customer,
    },
    {
      key: "vendor",
      label: "외주 업체",
      candidates: SHEET_COL_CANDIDATES.vendor,
    },
    { key: "memo", label: "비고", candidates: ["비고", "memo", "note"] },
    { key: "quote", label: "견적", candidates: SHEET_COL_CANDIDATES.quote },
    { key: "eta", label: "작업 기간", candidates: SHEET_COL_CANDIDATES.eta },
    {
      key: "barcode",
      label: "내부바코드",
      candidates: SHEET_COL_CANDIDATES.barcode,
    },
    {
      key: "progress",
      label: "수선 진행 확정",
      candidates: SHEET_COL_CANDIDATES.progress,
    },
  ];

  let originalHeaders = rows[0]
    ? rows[0].map((v) => String(v || "").trim())
    : [];
  let originalDataRows = rows.slice(1);
  if (!originalHeaders.length || isCorruptedHeaderRow(originalHeaders)) {
    originalHeaders = [];
    originalDataRows = [];
  }

  const usedSourceIndexes = new Set();
  const sourceIdxByKey = {};
  for (const def of desiredHeaderDefs) {
    const idx = getHeaderIndex(originalHeaders, def.candidates);
    sourceIdxByKey[def.key] = idx;
    if (idx >= 0) usedSourceIndexes.add(idx);
  }

  const extraSourceIndexes = originalHeaders
    .map((_, idx) => idx)
    .filter(
      (idx) =>
        !usedSourceIndexes.has(idx) &&
        String(originalHeaders[idx] || "").trim(),
    );
  const extraHeaders = extraSourceIndexes.map((idx) =>
    String(originalHeaders[idx] || "").trim(),
  );

  const headers = [...desiredHeaderDefs.map((d) => d.label), ...extraHeaders];
  const dataRows = originalDataRows.map((row) => {
    const nextRow = Array.from({ length: headers.length }, () => "");
    desiredHeaderDefs.forEach((def, targetIdx) => {
      const sourceIdx = sourceIdxByKey[def.key];
      nextRow[targetIdx] = sourceIdx >= 0 ? row?.[sourceIdx] || "" : "";
    });
    extraSourceIndexes.forEach((sourceIdx, extraIdx) => {
      nextRow[desiredHeaderDefs.length + extraIdx] = row?.[sourceIdx] || "";
    });
    return nextRow;
  });

  const shouldRewriteLayout =
    !originalHeaders.length ||
    originalHeaders.length !== headers.length ||
    headers.some(
      (header, idx) =>
        normalizeHeader(originalHeaders[idx]) !== normalizeHeader(header),
    );
  if (shouldRewriteLayout) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${title.replace(/'/g, "''")}'!A1:ZZ2000`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${title.replace(/'/g, "''")}'!A1:${columnIndexToA1(headers.length - 1)}${Math.max(1, dataRows.length + 1)}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers, ...dataRows] },
    });
  }

  const bidDateIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.bidDate);
  const barcodeIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.barcode);
  const imageIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.image);
  const titleIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.title);
  const repairNoteIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.note);
  const customerIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.customer);
  const vendorIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.vendor);
  const quoteIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.quote);
  const etaIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.eta);
  const progressIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.progress);
  const memoIdx = getHeaderIndex(headers, ["비고", "memo", "note"]);

  const normalizedBarcode = normalizeBarcode(barcode);
  const rowOffset = dataRows.findIndex(
    (row) => normalizeBarcode(row?.[barcodeIdx]) === normalizedBarcode,
  );
  const existing = rowOffset >= 0 ? dataRows[rowOffset] : [];
  const newRow = Array.from({ length: headers.length }, (_, idx) =>
    idx < existing.length ? existing[idx] : "",
  );

  if (bidDate && String(bidDate).trim()) {
    newRow[bidDateIdx] = String(bidDate).trim();
  }
  newRow[barcodeIdx] = barcode;
  if (productImage && String(productImage).trim()) {
    const formula = toSheetImageFormula(productImage);
    if (formula) newRow[imageIdx] = formula;
  }
  newRow[titleIdx] =
    String(productTitle || "").trim() ||
    String(newRow[titleIdx] || "").trim() ||
    barcode;
  if (customerName && String(customerName).trim()) {
    newRow[customerIdx] = String(customerName).trim();
  }
  newRow[repairNoteIdx] = repairNote || "";
  newRow[vendorIdx] = vendorName || "";
  const parsedRepairAmount = toAmount(repairAmount);
  if (parsedRepairAmount !== null) {
    newRow[quoteIdx] = parsedRepairAmount;
  } else if (!String(newRow[quoteIdx] || "").trim()) {
    newRow[quoteIdx] = "";
  }
  if (
    workPeriod &&
    String(workPeriod).trim() &&
    !String(newRow[etaIdx] || "").trim()
  ) {
    newRow[etaIdx] = String(workPeriod).trim();
  }
  if (!String(newRow[etaIdx] || "").trim()) newRow[etaIdx] = "";
  if (
    progressFlag !== undefined &&
    progressFlag !== null &&
    String(progressFlag).trim() !== ""
  ) {
    newRow[progressIdx] = String(progressFlag).trim();
  }
  if (!String(newRow[memoIdx] || "").trim()) newRow[memoIdx] = "";

  if (rowOffset >= 0) {
    const rowNo = rowOffset + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${title.replace(/'/g, "''")}'!A${rowNo}:${columnIndexToA1(headers.length - 1)}${rowNo}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
    return { created: false, rowNumber: rowNo };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${title.replace(/'/g, "''")}'!A:${columnIndexToA1(headers.length - 1)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [newRow] },
  });
  return { created: true };
}

async function deleteVendorSheetRowsByBarcode({
  sheetId,
  sheetGid,
  sheetName = "",
  fallbackToFirst = true,
  barcode,
}) {
  if (!sheetId || !barcode) {
    return { error: "시트ID 또는 바코드가 없습니다." };
  }
  try {
    const sheets = await getSheetsClient();
    const resolved = await resolveTargetSheetAndRows({
      sheets,
      sheetId,
      sheetGid,
      sheetName,
      createIfMissing: false,
      fallbackToFirst,
    });
    if (resolved?.notFound) return { removed: 0 };
    if (resolved.error) return { error: resolved.error };

    const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
    if (!rows.length) {
      return { removed: 0 };
    }
    const { headerRowIndex, barcodeIdx } = findBarcodeHeaderInfo(rows);
    if (headerRowIndex < 0 || barcodeIdx < 0) {
      return { removed: 0 };
    }

    const normalizedTargetBarcode = normalizeBarcode(barcode);
    const matchedRowNumbers = rows
      .slice(headerRowIndex + 1)
      .map((row, idx) => ({
        row,
        rowNumber: headerRowIndex + 2 + idx,
      }))
      .filter(
        ({ row }) =>
          normalizeBarcode(row?.[barcodeIdx]) === normalizedTargetBarcode,
      )
      .map(({ rowNumber }) => rowNumber)
      .sort((a, b) => b - a);

    if (!matchedRowNumbers.length) {
      return { removed: 0 };
    }

    const requests = matchedRowNumbers.map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: Number(resolved.targetSheetId),
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });

    return { removed: matchedRowNumbers.length };
  } catch (error) {
    const raw = error?.response?.data?.error?.message || error?.message;
    return { error: `구글시트 삭제 실패: ${raw || "알 수 없는 오류"}` };
  }
}

async function cleanupVendorSheetRowsByAllowedBarcodes({
  sheetId,
  sheetGid,
  sheetName,
  fallbackToFirst = true,
  allowedBarcodes = [],
}) {
  if (!sheetId) return { ok: false, error: "시트ID가 없습니다." };
  const sheets = await getSheetsClient();
  const resolved = await resolveTargetSheetAndRows({
    sheets,
    sheetId,
    sheetGid,
    sheetName,
    createIfMissing: false,
    fallbackToFirst,
  });
  if (resolved?.notFound) return { ok: true, removed: 0 };
  if (resolved.error) return { ok: false, error: resolved.error };

  const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
  if (!rows.length) return { ok: true, removed: 0 };
  const { headerRowIndex, barcodeIdx } = findBarcodeHeaderInfo(rows);
  if (headerRowIndex < 0 || barcodeIdx < 0) return { ok: true, removed: 0 };

  const allowedSet = new Set(
    (allowedBarcodes || []).map((v) => normalizeBarcode(v)).filter(Boolean),
  );
  const seen = new Set();
  const matchedRowNumbers = [];
  for (let rowNo = rows.length; rowNo >= headerRowIndex + 2; rowNo -= 1) {
    const row = rows[rowNo - 1] || [];
    const key = normalizeBarcode(row?.[barcodeIdx]);
    if (!key) continue;
    if (!allowedSet.has(key) || seen.has(key)) {
      matchedRowNumbers.push(rowNo);
      continue;
    }
    seen.add(key);
  }
  if (!matchedRowNumbers.length) return { ok: true, removed: 0 };

  const requests = matchedRowNumbers.map((rowNumber) => ({
    deleteDimension: {
      range: {
        sheetId: Number(resolved.targetSheetId),
        dimension: "ROWS",
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });
  return { ok: true, removed: matchedRowNumbers.length };
}

async function fetchVendorSheetQuote({
  sheetId,
  sheetGid,
  sheetName = "",
  fallbackToFirst = true,
  barcode,
}) {
  if (!sheetId || !barcode) {
    return { error: "시트ID 또는 바코드가 없습니다." };
  }
  try {
    const sheets = await getSheetsClient();
    const resolved = await resolveTargetSheetAndRows({
      sheets,
      sheetId,
      sheetGid,
      sheetName,
      createIfMissing: false,
      fallbackToFirst,
    });
    if (resolved.error) return { error: resolved.error };
    const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
    if (!rows.length) {
      return { error: "시트 데이터가 비어 있습니다." };
    }

    const { headerRowIndex, barcodeIdx, quoteIdx, etaIdx, noteIdx } =
      findQuoteHeaderInfo(rows);
    if (headerRowIndex < 0 || barcodeIdx < 0 || quoteIdx < 0) {
      const preview = rows
        .slice(0, 3)
        .map((r, idx) => `R${idx + 1}: ${(r || []).slice(0, 6).join(" | ")}`)
        .join(" / ");
      return {
        error:
          "시트 헤더를 찾지 못했습니다. 필수 컬럼: [내부바코드/바코드] + [견적금액/수선금액]. " +
          (preview ? `현재 상단행: ${preview}` : ""),
      };
    }

    const normalizedTargetBarcode = normalizeBarcode(barcode);
    const dataRows = rows.slice(headerRowIndex + 1);
    const matchedRows = dataRows
      .map((row, idx) => ({
        row,
        rowNumber: headerRowIndex + 2 + idx,
      }))
      .filter(({ row }) => {
        const rowBarcode = normalizeBarcode(row?.[barcodeIdx]);
        return rowBarcode && rowBarcode === normalizedTargetBarcode;
      });

    if (!matchedRows.length) {
      const samples = dataRows
        .map((row) => normalizeBarcode(row?.[barcodeIdx]))
        .filter(Boolean)
        .slice(0, 5);
      return {
        error:
          `시트에서 바코드 [${barcode}] 행을 찾지 못했습니다.` +
          (samples.length ? ` (시트 바코드 예시: ${samples.join(", ")})` : ""),
      };
    }

    // 같은 바코드가 여러 줄이면 "견적이 있는 최신 행"을 우선 사용
    const rowsFromLatest = [...matchedRows].reverse();
    const picked =
      rowsFromLatest.find(({ row }) => toAmount(row?.[quoteIdx]) !== null) ||
      rowsFromLatest[0];

    return {
      quoteAmountRaw: picked?.row?.[quoteIdx],
      etaRaw: etaIdx >= 0 ? picked?.row?.[etaIdx] : null,
      noteRaw: noteIdx >= 0 ? picked?.row?.[noteIdx] : null,
      matchedCount: matchedRows.length,
      pickedRowNumber: picked?.rowNumber || null,
    };
  } catch (error) {
    const raw = error?.response?.data?.error?.message || error?.message;
    return {
      error: `구글시트 조회 실패: ${raw || "알 수 없는 오류"}`,
    };
  }
}

async function resolveRepairVendorSheetInfo(conn, vendorName) {
  const safeVendorName = String(vendorName || "").trim();
  if (!safeVendorName) {
    return { vendorName: null, sheetId: null, sheetGid: null, sheetUrl: null };
  }
  const [vendorRows] = await conn.query(
    `
    SELECT name, sheet_url, sheet_id, sheet_gid
    FROM wms_repair_vendors
    WHERE name = ?
    LIMIT 1
    `,
    [safeVendorName],
  );
  const vendor = vendorRows[0] || null;
  const parsedSheet = parseGoogleSheetLink(vendor?.sheet_url);
  return {
    vendorName: vendor?.name || safeVendorName,
    sheetUrl: vendor?.sheet_url || null,
    sheetId: vendor?.sheet_id || parsedSheet.sheetId,
    sheetGid: vendor?.sheet_gid || parsedSheet.sheetGid,
  };
}

function resolveVendorSheetState(caseState) {
  const normalized = String(caseState || "")
    .trim()
    .toUpperCase();
  if (normalized === REPAIR_CASE_STATES.DONE) return "COMPLETED";
  if (
    [
      REPAIR_CASE_STATES.DRAFT,
      REPAIR_CASE_STATES.READY_TO_SEND,
      REPAIR_CASE_STATES.PROPOSED,
      REPAIR_CASE_STATES.ACCEPTED,
    ].includes(normalized)
  ) {
    return "ACTIVE";
  }
  return "NONE";
}

async function removeRepairCaseFromVendorSheets({
  conn,
  decisionType,
  vendorName,
  barcode,
}) {
  const normalizedDecision = String(decisionType || "")
    .trim()
    .toUpperCase();
  if (!["INTERNAL", "EXTERNAL"].includes(normalizedDecision)) {
    return {
      ok: false,
      error: "내부/외부 수선건만 시트에서 삭제할 수 있습니다.",
    };
  }
  const normalizedBarcode = String(barcode || "").trim();
  if (!normalizedBarcode) return { ok: false, error: "바코드가 없습니다." };

  const targetVendorName =
    normalizedDecision === "INTERNAL"
      ? INTERNAL_VENDOR_NAME
      : String(vendorName || "").trim();
  const vendorSheet = await resolveRepairVendorSheetInfo(
    conn,
    targetVendorName,
  );
  if (!vendorSheet.sheetId) {
    return { ok: false, error: "시트가 연결되지 않아 삭제를 건너뜀" };
  }

  const activeDeleted = await deleteVendorSheetRowsByBarcode({
    sheetId: vendorSheet.sheetId,
    sheetGid: vendorSheet.sheetGid,
    sheetName: VENDOR_ACTIVE_SHEET_NAME,
    fallbackToFirst: true,
    barcode: normalizedBarcode,
  });
  if (activeDeleted?.error) return { ok: false, error: activeDeleted.error };
  const completedDeleted = await deleteVendorSheetRowsByBarcode({
    sheetId: vendorSheet.sheetId,
    sheetGid: vendorSheet.sheetGid,
    sheetName: VENDOR_COMPLETED_SHEET_NAME,
    fallbackToFirst: false,
    barcode: normalizedBarcode,
  });
  if (completedDeleted?.error)
    return { ok: false, error: completedDeleted.error };

  return {
    ok: true,
    removed:
      Number(activeDeleted?.removed || 0) +
      Number(completedDeleted?.removed || 0),
    removedActive: Number(activeDeleted?.removed || 0),
    removedCompleted: Number(completedDeleted?.removed || 0),
  };
}

async function syncRepairCaseToVendorSheet({
  conn,
  caseRow,
  itemRow,
  vendorSheet,
  vendorName,
  decisionType,
  sheetState,
  skipSort = false,
}) {
  const barcode = String(
    itemRow.internal_barcode || itemRow.external_barcode || "",
  ).trim();
  if (!barcode)
    return { ok: false, error: "내부바코드가 없어 시트 전송할 수 없습니다." };

  if (sheetState === "NONE") {
    const removed = await removeRepairCaseFromVendorSheets({
      conn,
      decisionType,
      vendorName,
      barcode,
    });
    return removed.ok ? { ok: true, removedOnly: true, removed } : removed;
  }

  if (!vendorSheet.sheetId) {
    return {
      ok: false,
      error:
        decisionType === "INTERNAL"
          ? "내부업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 내부 시트를 등록하세요."
          : "외주업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 외주 시트를 등록하세요.",
    };
  }

  const item = await fetchRepairItemWithMeta(conn, caseRow.item_id);
  const targetSheetName =
    sheetState === "COMPLETED"
      ? VENDOR_COMPLETED_SHEET_NAME
      : VENDOR_ACTIVE_SHEET_NAME;
  const pushed = await upsertVendorSheetRow({
    sheetId: vendorSheet.sheetId,
    sheetGid: vendorSheet.sheetGid,
    sheetName: targetSheetName,
    barcode,
    bidDate: formatDateForSheet(item?.scheduled_at),
    productTitle: item?.product_title || "",
    customerName: item?.company_name || item?.member_name || "",
    repairNote: caseRow.repair_note || "",
    repairAmount: caseRow.repair_amount,
    workPeriod: caseRow.repair_eta || "",
    vendorName,
    productImage: item?.product_image || "",
    progressFlag:
      caseRow.case_state === REPAIR_CASE_STATES.ACCEPTED ? "TRUE" : "FALSE",
  });
  if (pushed?.error) return { ok: false, error: pushed.error };

  const deleteFromOpposite =
    sheetState === "COMPLETED"
      ? VENDOR_ACTIVE_SHEET_NAME
      : VENDOR_COMPLETED_SHEET_NAME;
  const removedOpposite = await deleteVendorSheetRowsByBarcode({
    sheetId: vendorSheet.sheetId,
    sheetGid: vendorSheet.sheetGid,
    sheetName: deleteFromOpposite,
    fallbackToFirst: deleteFromOpposite === VENDOR_ACTIVE_SHEET_NAME,
    barcode,
  });
  if (removedOpposite?.error)
    return { ok: false, error: removedOpposite.error };

  if (!skipSort) {
    const sorted = await sortVendorSheetRowsByBidDate({
      sheetId: vendorSheet.sheetId,
      sheetGid: vendorSheet.sheetGid,
      sheetName: targetSheetName,
      fallbackToFirst: targetSheetName === VENDOR_ACTIVE_SHEET_NAME,
    });
    if (!sorted?.ok)
      return { ok: false, error: sorted.error || "시트 예정일 정렬 실패" };
  }

  return {
    ok: true,
    created: !!pushed.created,
    sheetName: targetSheetName,
    removedFromOpposite: Number(removedOpposite?.removed || 0),
    sortSkipped: !!skipSort,
  };
}

async function ensureGoogleSheetTab({
  sheets,
  spreadsheetId,
  sheetGid,
  sheetName,
  createIfMissing = false,
}) {
  const safeSheetName = String(sheetName || "").trim();
  const book = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,index))",
  });
  const allSheets = Array.isArray(book?.data?.sheets) ? book.data.sheets : [];

  let found = null;
  if (sheetGid) {
    found =
      allSheets.find(
        (sheet) =>
          String(sheet?.properties?.sheetId || "") === String(sheetGid),
      ) || null;
  }
  if (!found && safeSheetName) {
    found =
      allSheets.find((sheet) => sheet?.properties?.title === safeSheetName) ||
      null;
  }
  if (!found && createIfMissing && safeSheetName) {
    const createRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: safeSheetName },
            },
          },
        ],
      },
    });
    const created = createRes?.data?.replies?.[0]?.addSheet?.properties || null;
    if (created?.title) {
      return { title: created.title, sheetId: created.sheetId };
    }
  }
  if (!found) {
    found = allSheets[0] || null;
  }
  if (!found?.properties?.title) {
    return { error: "사용 가능한 시트 탭을 찾지 못했습니다." };
  }
  return {
    title: found.properties.title,
    sheetId: found.properties.sheetId,
  };
}

async function pushRepairCaseToDecisionSheet({
  conn,
  caseId,
  loginId,
  expectedDecisionType = "",
  skipSheetSort = false,
}) {
  const normalizedExpected = String(expectedDecisionType || "")
    .trim()
    .toUpperCase();
  const [rows] = await conn.query(
    `
    SELECT
      rc.id,
      rc.item_id,
      rc.case_state,
      rc.decision_type,
      rc.vendor_name,
      rc.repair_note,
      rc.repair_amount,
      rc.repair_eta,
      i.internal_barcode,
      i.external_barcode
    FROM wms_repair_cases rc
    INNER JOIN wms_items i
      ON i.id = rc.item_id
    WHERE rc.id = ?
    LIMIT 1
    FOR UPDATE
    `,
    [caseId],
  );
  const row = rows[0] || null;
  if (!row) {
    return { ok: false, error: "수선건을 찾을 수 없습니다." };
  }

  const decisionType = String(row.decision_type || "")
    .trim()
    .toUpperCase();
  const caseState = String(row.case_state || "")
    .trim()
    .toUpperCase();
  if (!["INTERNAL", "EXTERNAL"].includes(decisionType)) {
    return { ok: false, error: "내부/외부 수선건만 시트 전송할 수 있습니다." };
  }
  if (
    [REPAIR_CASE_STATES.ARRIVED, REPAIR_CASE_STATES.REJECTED].includes(
      caseState,
    )
  ) {
    return {
      ok: false,
      error: "1단계(국내도착)/거절 건은 시트 전송 대상이 아닙니다.",
    };
  }
  if (normalizedExpected && decisionType !== normalizedExpected) {
    return {
      ok: false,
      error:
        decisionType === "INTERNAL"
          ? "내부수선(INTERNAL) 건만 전송할 수 있습니다."
          : "외부수선(EXTERNAL) 건만 전송할 수 있습니다.",
    };
  }

  const barcode = String(
    row.internal_barcode || row.external_barcode || "",
  ).trim();
  if (!barcode) {
    return { ok: false, error: "내부바코드가 없어 시트 전송할 수 없습니다." };
  }

  const vendorName =
    decisionType === "INTERNAL"
      ? INTERNAL_VENDOR_NAME
      : String(row.vendor_name || "").trim();
  const vendorSheet = await resolveRepairVendorSheetInfo(conn, vendorName);
  if (!vendorSheet.sheetId) {
    return {
      ok: false,
      error:
        decisionType === "INTERNAL"
          ? "내부업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 내부 시트를 등록하세요."
          : "외주업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 외주 시트를 등록하세요.",
    };
  }

  const sheetState = resolveVendorSheetState(caseState);
  const synced = await syncRepairCaseToVendorSheet({
    conn,
    caseRow: row,
    itemRow: row,
    vendorSheet,
    vendorName:
      decisionType === "INTERNAL"
        ? INTERNAL_VENDOR_NAME
        : vendorSheet.vendorName || row.vendor_name || "",
    decisionType,
    sheetState,
    skipSort: !!skipSheetSort,
  });
  if (!synced?.ok) return { ok: false, error: synced.error };

  if (decisionType === "EXTERNAL") {
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = CASE
            WHEN case_state IN ('READY_TO_SEND', 'PROPOSED', 'ACCEPTED', 'DONE') THEN case_state
            ELSE 'DRAFT'
          END,
          external_sent_at = NOW(),
          external_synced_at = CASE
            WHEN case_state IN ('READY_TO_SEND', 'PROPOSED', 'ACCEPTED', 'DONE') THEN external_synced_at
            ELSE NULL
          END,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [loginId, caseId],
    );
  } else {
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET internal_sent_at = NOW(),
          internal_synced_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [loginId, caseId],
    );
  }

  return {
    ok: true,
    decisionType,
    barcode,
    vendorName:
      decisionType === "INTERNAL"
        ? INTERNAL_VENDOR_NAME
        : vendorSheet.vendorName || row.vendor_name || "",
    created: !!synced.created,
    sheetState,
    sheetName: synced.sheetName || "",
  };
}

async function removeRepairCaseFromDecisionSheet({
  conn,
  decisionType,
  vendorName,
  barcode,
}) {
  const normalizedDecision = String(decisionType || "")
    .trim()
    .toUpperCase();
  const normalizedBarcode = String(barcode || "").trim();
  if (!normalizedBarcode) {
    return { ok: false, error: "바코드가 없어 시트에서 삭제할 수 없습니다." };
  }
  if (!["INTERNAL", "EXTERNAL"].includes(normalizedDecision)) {
    return {
      ok: false,
      error: "내부/외부 수선건만 시트에서 삭제할 수 있습니다.",
    };
  }
  return removeRepairCaseFromVendorSheets({
    conn,
    decisionType: normalizedDecision,
    vendorName,
    barcode: normalizedBarcode,
  });
}

function toDateKey(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function toDateTimeKey(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${toDateKey(d)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function toRepairStageLabel(stageCode) {
  switch (
    String(stageCode || "")
      .trim()
      .toUpperCase()
  ) {
    case REPAIR_STAGE_CODES.DOMESTIC:
      return "1) 국내도착";
    case REPAIR_STAGE_CODES.EXTERNAL_WAITING:
      return "2) 외부견적대기";
    case REPAIR_STAGE_CODES.READY_TO_SEND:
      return "3) 견적완료/고객전송대기";
    case REPAIR_STAGE_CODES.PROPOSED:
      return "4) 고객응답대기";
    case REPAIR_STAGE_CODES.IN_PROGRESS:
      return "5) 진행중";
    case REPAIR_STAGE_CODES.DONE:
      return "6) 수선완료존";
    default:
      return "-";
  }
}

function toDecisionTypeLabel(decisionType) {
  const normalized = String(decisionType || "")
    .trim()
    .toUpperCase();
  if (normalized === "INTERNAL") return "내부";
  if (normalized === "EXTERNAL") return "외부";
  if (normalized === "NONE") return "무수선";
  return "-";
}

function toSheetSyncLabel(row) {
  const decisionType = String(row?.decision_type || "")
    .trim()
    .toUpperCase();
  if (decisionType === "INTERNAL") {
    if (row?.internal_synced_at) return "내부시트전송완료";
    if (row?.internal_sent_at) return "내부시트전송처리중";
    return "내부미전송";
  }
  if (decisionType === "EXTERNAL") {
    if (row?.external_synced_at) return "외주시트동기화완료";
    if (row?.external_sent_at) return "외주시트전송완료/견적대기";
    return "외부미전송";
  }
  if (decisionType === "NONE") {
    return "수선없음";
  }
  return "-";
}

async function resolveRepairMainSheetConfig(conn) {
  const configuredMain = await getRepairSheetSetting(
    conn,
    SHEET_SETTING_KEYS.MAIN_OVERVIEW,
  );
  if (configuredMain?.sheetId) {
    return {
      sheetId: configuredMain.sheetId,
      sheetGid: configuredMain.sheetGid || null,
      sheetName: DEFAULT_REPAIR_MAIN_SHEET_NAME,
      configuredBy: "DB",
    };
  }

  const envSheetId = String(process.env.REPAIR_MAIN_SHEET_ID || "").trim();
  const envSheetGid = String(process.env.REPAIR_MAIN_SHEET_GID || "").trim();
  const envSheetName = String(process.env.REPAIR_MAIN_SHEET_NAME || "").trim();
  if (envSheetId) {
    return {
      sheetId: envSheetId,
      sheetGid: envSheetGid || null,
      sheetName: envSheetName || DEFAULT_REPAIR_MAIN_SHEET_NAME,
      configuredBy: "ENV",
    };
  }

  const internalVendor = await resolveRepairVendorSheetInfo(
    conn,
    INTERNAL_VENDOR_NAME,
  );
  return {
    sheetId: internalVendor.sheetId || null,
    // 내부업체 시트 gid를 메인집계 탭 gid로 재사용하면 상세탭이 덮어써질 수 있음.
    // 메인집계는 같은 스프레드시트 내에서도 시트명(수선_전체현황) 기준으로 찾고,
    // 없으면 새로 생성한다.
    sheetGid: envSheetGid || null,
    sheetName: envSheetName || DEFAULT_REPAIR_MAIN_SHEET_NAME,
    configuredBy: "INTERNAL_VENDOR_FALLBACK",
  };
}

async function resolveRepairCompletedSheetConfig(conn) {
  const configuredCompleted = await getRepairSheetSetting(
    conn,
    SHEET_SETTING_KEYS.COMPLETED_HISTORY,
  );
  if (configuredCompleted?.sheetId) {
    return {
      sheetId: configuredCompleted.sheetId,
      sheetGid: configuredCompleted.sheetGid || null,
      sheetName: DEFAULT_REPAIR_COMPLETED_SHEET_NAME,
      configuredBy: "DB",
    };
  }

  const envSheetId = String(process.env.REPAIR_COMPLETED_SHEET_ID || "").trim();
  const envSheetGid = String(
    process.env.REPAIR_COMPLETED_SHEET_GID || "",
  ).trim();
  const envSheetName = String(
    process.env.REPAIR_COMPLETED_SHEET_NAME || "",
  ).trim();
  if (envSheetId) {
    return {
      sheetId: envSheetId,
      sheetGid: envSheetGid || null,
      sheetName: envSheetName || DEFAULT_REPAIR_COMPLETED_SHEET_NAME,
      configuredBy: "ENV",
    };
  }

  const mainSheet = await resolveRepairMainSheetConfig(conn);
  return {
    sheetId: mainSheet.sheetId || null,
    sheetGid: envSheetGid || null,
    sheetName: envSheetName || DEFAULT_REPAIR_COMPLETED_SHEET_NAME,
    configuredBy: "MAIN_SHEET_FALLBACK",
  };
}

async function syncRepairDailyOverviewSheet(conn) {
  const mainSheetConfig = await resolveRepairMainSheetConfig(conn);
  if (!mainSheetConfig.sheetId) {
    return {
      ok: false,
      skipped: true,
      reason:
        "메인 시트 ID가 없습니다. REPAIR_MAIN_SHEET_ID 또는 내부업체 시트 링크를 먼저 설정하세요.",
    };
  }

  const [rows] = await conn.query(
    `
    SELECT
      i.id,
      COALESCE(NULLIF(TRIM(i.internal_barcode), ''), NULLIF(TRIM(i.external_barcode), '')) AS internal_barcode,
      COALESCE(u.company_name, i.member_name) AS member_name,
      COALESCE(ci.original_title, ci.title) AS product_title,
      i.current_location_code,
      i.current_status,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date, rc.updated_at, i.updated_at, i.created_at) AS scheduled_at,
      COALESCE(rc.updated_at, i.updated_at, i.created_at) AS updated_at,
      COALESCE(
        NULLIF(TRIM(ci.image), ''),
        CASE
          WHEN JSON_VALID(ci.additional_images) THEN
            NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
          ELSE NULL
        END,
        ''
      ) AS product_image,
      rc.id AS case_id,
      rc.case_state,
      rc.decision_type,
      rc.vendor_name,
      rc.repair_amount,
      rc.repair_eta,
      rc.repair_note,
      rc.external_sent_at,
      rc.external_synced_at,
      rc.internal_sent_at,
      rc.internal_synced_at
    FROM wms_items i
    LEFT JOIN wms_repair_cases rc
      ON rc.item_id = i.id
    LEFT JOIN direct_bids d
      ON i.source_bid_type = 'direct'
     AND i.source_bid_id = d.id
    LEFT JOIN live_bids l
      ON i.source_bid_type = 'live'
     AND i.source_bid_id = l.id
    LEFT JOIN instant_purchases ip
      ON i.source_bid_type = 'instant'
     AND i.source_bid_id = ip.id
    LEFT JOIN users u
      ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) =
         CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
    WHERE
      rc.id IS NOT NULL
      AND UPPER(TRIM(COALESCE(rc.case_state, ''))) <> 'ARRIVED'
      AND UPPER(TRIM(COALESCE(rc.decision_type, ''))) IN ('INTERNAL', 'EXTERNAL', 'NONE')
      AND (
        NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL
        OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL
      )
    `,
  );

  const normalizedRows = rows
    .map((row) => {
      const stageCode = deriveRepairStage(
        row.case_state,
        row.decision_type,
        normalizeLocationCode(row.current_location_code),
      );
      // 수선_전체현황 시트는 수선관리 전체 단계(2~6)를 보여준다.
      // 별도 완료누적 이력은 수선_완료내역 시트에서 계속 관리한다.
      const decisionType = String(row.decision_type || "")
        .trim()
        .toUpperCase();
      const normalizedZone = normalizeLocationCode(row.current_location_code);
      const repairAmount = toAmount(row.repair_amount);
      const updatedAtTs = new Date(row.updated_at || 0).getTime() || 0;
      const scheduledAtRawTs = new Date(row.scheduled_at || 0).getTime();
      const scheduledAtTs = Number.isFinite(scheduledAtRawTs)
        ? scheduledAtRawTs
        : Number.MAX_SAFE_INTEGER;
      const barcode = String(row.internal_barcode || "").trim();

      return {
        scheduledAtTs,
        updatedAtTs,
        barcode,
        rowValues: [
          toDateTimeKey(row.updated_at),
          formatDateForSheet(row.scheduled_at),
          barcode,
          String(row.member_name || "").trim(),
          sanitizeProductTitle(row.product_title || ""),
          toSheetImageFormula(row.product_image || ""),
          toRepairStageLabel(stageCode),
          toDecisionTypeLabel(decisionType),
          decisionType === "INTERNAL"
            ? INTERNAL_VENDOR_NAME
            : String(row.vendor_name || "").trim() || "-",
          repairAmount !== null ? repairAmount : "",
          String(row.repair_eta || "").trim(),
          toSheetSyncLabel(row),
          String(row.case_state || "").trim() || "-",
          String(normalizedZone || "").trim() || "-",
          String(row.current_status || "").trim() || "-",
          String(row.repair_note || "").trim(),
        ],
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.scheduledAtTs !== b.scheduledAtTs)
        return a.scheduledAtTs - b.scheduledAtTs;
      if (a.updatedAtTs !== b.updatedAtTs) return a.updatedAtTs - b.updatedAtTs;
      return String(a.barcode || "").localeCompare(String(b.barcode || ""));
    });

  const values = [
    [
      "최종업데이트",
      "예정일",
      "내부바코드",
      "회원사",
      "상품명",
      "사진",
      "단계",
      "처리구분",
      "업체",
      "견적금액(원)",
      "예상일",
      "시트상태",
      "케이스상태",
      "존코드",
      "상태코드",
      "수선요청내용",
    ],
    ...normalizedRows.map((entry) => entry.rowValues),
  ];

  const sheets = await getSheetsClient();
  const tabInfo = await ensureGoogleSheetTab({
    sheets,
    spreadsheetId: mainSheetConfig.sheetId,
    sheetGid: mainSheetConfig.sheetGid,
    sheetName: mainSheetConfig.sheetName,
    createIfMissing: true,
  });
  if (tabInfo.error) {
    return { ok: false, reason: tabInfo.error };
  }

  const tabName = String(tabInfo.title || "").replace(/'/g, "''");
  const width = Math.max(1, values[0].length);
  const height = Math.max(1, values.length);
  const endCell = `${columnIndexToA1(width - 1)}${height}`;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: mainSheetConfig.sheetId,
    range: `'${tabName}'!A1:Z5000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: mainSheetConfig.sheetId,
    range: `'${tabName}'!A1:${endCell}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return {
    ok: true,
    spreadsheetId: mainSheetConfig.sheetId,
    sheetName: tabInfo.title,
    rowCount: normalizedRows.length,
  };
}

async function syncRepairCompletedHistorySheet(conn) {
  const completedSheetConfig = await resolveRepairCompletedSheetConfig(conn);
  if (!completedSheetConfig.sheetId) {
    return {
      ok: false,
      skipped: true,
      reason:
        "완료누적 시트 ID가 없습니다. REPAIR_COMPLETED_SHEET_ID 또는 내부업체 시트 링크를 먼저 설정하세요.",
    };
  }

  const [rows] = await conn.query(
    `
    SELECT
      i.id,
      COALESCE(NULLIF(TRIM(i.internal_barcode), ''), NULLIF(TRIM(i.external_barcode), '')) AS internal_barcode,
      COALESCE(u.company_name, i.member_name) AS member_name,
      COALESCE(ci.original_title, ci.title) AS product_title,
      COALESCE(
        NULLIF(TRIM(ci.image), ''),
        CASE
          WHEN JSON_VALID(ci.additional_images) THEN
            NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
          ELSE NULL
        END,
        ''
      ) AS product_image,
      i.current_location_code,
      i.current_status,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date, rc.updated_at, i.updated_at, i.created_at) AS scheduled_at,
      COALESCE(rc.completed_at, rc.updated_at, i.updated_at, i.created_at) AS updated_at,
      rc.id AS case_id,
      rc.case_state,
      rc.decision_type,
      rc.vendor_name,
      rc.repair_amount,
      rc.repair_eta,
      rc.repair_note,
      rc.external_sent_at,
      rc.external_synced_at,
      rc.internal_sent_at,
      rc.internal_synced_at
    FROM wms_items i
    LEFT JOIN wms_repair_cases rc
      ON rc.item_id = i.id
    LEFT JOIN direct_bids d
      ON i.source_bid_type = 'direct'
     AND i.source_bid_id = d.id
    LEFT JOIN live_bids l
      ON i.source_bid_type = 'live'
     AND i.source_bid_id = l.id
    LEFT JOIN instant_purchases ip
      ON i.source_bid_type = 'instant'
     AND i.source_bid_id = ip.id
    LEFT JOIN users u
      ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) =
         CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
    WHERE
      rc.id IS NOT NULL
      AND UPPER(TRIM(COALESCE(rc.case_state, ''))) = 'DONE'
      AND UPPER(TRIM(COALESCE(rc.decision_type, ''))) IN ('INTERNAL', 'EXTERNAL', 'NONE')
      AND (
        NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL
        OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL
      )
    ORDER BY COALESCE(rc.completed_at, rc.updated_at, i.updated_at, i.created_at) ASC
    `,
  );

  const completedRows = rows
    .map((row) => {
      const decisionType = String(row.decision_type || "")
        .trim()
        .toUpperCase();
      const normalizedZone = normalizeLocationCode(row.current_location_code);
      const stageLabel =
        normalizedZone === "OUTBOUND_ZONE" ? "출고완료" : "6) 수선완료존";
      const repairAmount = toAmount(row.repair_amount);
      const barcode = String(row.internal_barcode || "").trim();
      if (!barcode) return null;
      const scheduledAtRawTs = new Date(row.scheduled_at || 0).getTime();
      const scheduledAtTs = Number.isFinite(scheduledAtRawTs)
        ? scheduledAtRawTs
        : Number.MAX_SAFE_INTEGER;
      const updatedAtTs = new Date(row.updated_at || 0).getTime() || 0;

      return {
        scheduledAtTs,
        updatedAtTs,
        barcode,
        rowValues: [
          toDateTimeKey(row.updated_at),
          formatDateForSheet(row.scheduled_at),
          barcode,
          String(row.member_name || "").trim(),
          sanitizeProductTitle(row.product_title || ""),
          toSheetImageFormula(row.product_image || ""),
          stageLabel,
          toDecisionTypeLabel(decisionType),
          decisionType === "INTERNAL"
            ? INTERNAL_VENDOR_NAME
            : String(row.vendor_name || "").trim() || "-",
          repairAmount !== null ? repairAmount : "",
          String(row.repair_eta || "").trim(),
          toSheetSyncLabel(row),
          String(row.case_state || "").trim() || "-",
          String(normalizedZone || "").trim() || "-",
          String(row.current_status || "").trim() || "-",
          String(row.repair_note || "").trim(),
        ],
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.scheduledAtTs !== b.scheduledAtTs)
        return a.scheduledAtTs - b.scheduledAtTs;
      if (a.updatedAtTs !== b.updatedAtTs) return a.updatedAtTs - b.updatedAtTs;
      return String(a.barcode || "").localeCompare(String(b.barcode || ""));
    })
    .map((entry) => entry.rowValues);

  const headers = [
    "최종업데이트",
    "예정일",
    "내부바코드",
    "회원사",
    "상품명",
    "사진",
    "단계",
    "처리구분",
    "업체",
    "견적금액(원)",
    "예상일",
    "시트상태",
    "케이스상태",
    "존코드",
    "상태코드",
    "수선요청내용",
  ];
  const barcodeIdx = 2;
  const imageIdx = 5;

  const sheets = await getSheetsClient();
  const tabInfo = await ensureGoogleSheetTab({
    sheets,
    spreadsheetId: completedSheetConfig.sheetId,
    sheetGid: completedSheetConfig.sheetGid,
    sheetName: completedSheetConfig.sheetName,
    createIfMissing: true,
  });
  if (tabInfo.error) {
    return { ok: false, reason: tabInfo.error };
  }

  const tabName = String(tabInfo.title || "").replace(/'/g, "''");
  const range = `'${tabName}'!A1:${columnIndexToA1(headers.length - 1)}5000`;
  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: completedSheetConfig.sheetId,
    range,
    valueRenderOption: "FORMULA",
  });
  const existingRows = Array.isArray(valuesRes?.data?.values)
    ? valuesRes.data.values
    : [];

  const hasHeader =
    existingRows.length > 0 &&
    normalizeHeader(existingRows[0]?.[0]) === normalizeHeader(headers[0]) &&
    normalizeHeader(existingRows[0]?.[2]) === normalizeHeader(headers[2]);

  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: completedSheetConfig.sheetId,
      range: `'${tabName}'!A1:${columnIndexToA1(headers.length - 1)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] },
    });
  }

  const rowMap = new Map();
  const rowsForIndex = hasHeader ? existingRows : [];
  for (let i = 1; i < rowsForIndex.length; i += 1) {
    const row = rowsForIndex[i] || [];
    const key = normalizeBarcode(row[barcodeIdx]);
    if (!key) continue;
    rowMap.set(key, { rowNo: i + 1, row });
  }

  let updatedCount = 0;
  let appendedCount = 0;

  for (const values of completedRows) {
    const barcodeKey = normalizeBarcode(values[barcodeIdx]);
    if (!barcodeKey) continue;
    const existing = rowMap.get(barcodeKey);
    if (existing) {
      const rowNo = existing.rowNo;
      const nextValues = Array.from(
        { length: headers.length },
        (_, idx) => values[idx] ?? "",
      );
      if (
        !String(nextValues[imageIdx] || "").trim() &&
        String(existing.row[imageIdx] || "").trim()
      ) {
        nextValues[imageIdx] = existing.row[imageIdx];
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId: completedSheetConfig.sheetId,
        range: `'${tabName}'!A${rowNo}:${columnIndexToA1(headers.length - 1)}${rowNo}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [nextValues] },
      });
      updatedCount += 1;
      continue;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: completedSheetConfig.sheetId,
      range: `'${tabName}'!A:${columnIndexToA1(headers.length - 1)}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
    appendedCount += 1;
  }

  return {
    ok: true,
    spreadsheetId: completedSheetConfig.sheetId,
    sheetName: tabInfo.title,
    sourceCount: completedRows.length,
    updatedCount,
    appendedCount,
  };
}

async function syncRepairDailyOverviewSheetSafe(conn, contextLabel = "") {
  let mainResult = null;
  let completedResult = null;
  try {
    mainResult = await syncRepairDailyOverviewSheet(conn);
  } catch (error) {
    const reason = error?.message || "알 수 없는 오류";
    console.error(
      `repair main sheet sync error${contextLabel ? ` (${contextLabel})` : ""}:`,
      error,
    );
    mainResult = { ok: false, reason };
  }

  try {
    completedResult = await syncRepairCompletedHistorySheet(conn);
  } catch (error) {
    const reason = error?.message || "알 수 없는 오류";
    console.error(
      `repair completed sheet sync error${contextLabel ? ` (${contextLabel})` : ""}:`,
      error,
    );
    completedResult = { ok: false, reason };
  }

  return {
    ok: !!mainResult?.ok,
    skipped: !!mainResult?.skipped,
    reason: mainResult?.reason || null,
    rowCount: Number(mainResult?.rowCount || 0),
    completed: completedResult || null,
  };
}

function zoneAndStatusByDecision(decisionType) {
  if (decisionType === "INTERNAL") {
    return {
      zoneCode: "INTERNAL_REPAIR_ZONE",
      statusCode: "INTERNAL_REPAIR_IN_PROGRESS",
      actionType: "REPAIR_INTERNAL_START",
    };
  }
  if (decisionType === "NONE") {
    return {
      zoneCode: "REPAIR_DONE_ZONE",
      statusCode: "REPAIR_DONE",
      actionType: "REPAIR_SKIP_DONE",
    };
  }

  return {
    zoneCode: "EXTERNAL_REPAIR_ZONE",
    statusCode: "EXTERNAL_REPAIR_IN_PROGRESS",
    actionType: "REPAIR_EXTERNAL_START",
  };
}

function statusByZone(zoneCode) {
  switch (zoneCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
      return "DOMESTIC_ARRIVED";
    case "INTERNAL_REPAIR_ZONE":
      return "INTERNAL_REPAIR_IN_PROGRESS";
    case "EXTERNAL_REPAIR_ZONE":
      return "EXTERNAL_REPAIR_IN_PROGRESS";
    case "REPAIR_DONE_ZONE":
      return "REPAIR_DONE";
    case "OUTBOUND_ZONE":
      return "OUTBOUND_READY";
    default:
      return "INTERNAL_REPAIR_IN_PROGRESS";
  }
}

async function moveItemToZone({
  conn,
  item,
  toZoneCode,
  actionType,
  staffName,
  note,
}) {
  const nextStatus = statusByZone(toZoneCode);
  await conn.query(
    `
    UPDATE wms_items
    SET current_location_code = ?,
        current_status = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [toZoneCode, nextStatus, item.id],
  );

  await conn.query(
    `
    INSERT INTO wms_scan_events (
      item_id,
      barcode_input,
      from_location_code,
      to_location_code,
      prev_status,
      next_status,
      action_type,
      staff_name,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      item.id,
      item.internal_barcode || item.external_barcode || `ITEM:${item.id}`,
      item.current_location_code,
      toZoneCode,
      item.current_status,
      nextStatus,
      actionType,
      staffName,
      note || null,
    ],
  );
  return nextStatus;
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

function normalizeLocationCode(locationCode) {
  if (locationCode === "AUTH_ZONE") return "OUTBOUND_ZONE";
  if (locationCode === "REPAIR_TEAM_CHECK_ZONE") return "INTERNAL_REPAIR_ZONE";
  return locationCode;
}

function normalizeRepairStage(stage) {
  const raw = String(stage || "")
    .trim()
    .toUpperCase();
  if (raw === "1" || raw === REPAIR_STAGE_CODES.DOMESTIC) {
    return REPAIR_STAGE_CODES.DOMESTIC;
  }
  if (raw === "2" || raw === REPAIR_STAGE_CODES.EXTERNAL_WAITING) {
    return REPAIR_STAGE_CODES.EXTERNAL_WAITING;
  }
  if (raw === "3" || raw === REPAIR_STAGE_CODES.READY_TO_SEND) {
    return REPAIR_STAGE_CODES.READY_TO_SEND;
  }
  if (raw === "4" || raw === REPAIR_STAGE_CODES.PROPOSED) {
    return REPAIR_STAGE_CODES.PROPOSED;
  }
  if (raw === "5" || raw === REPAIR_STAGE_CODES.IN_PROGRESS) {
    return REPAIR_STAGE_CODES.IN_PROGRESS;
  }
  if (raw === "6" || raw === REPAIR_STAGE_CODES.DONE) {
    return REPAIR_STAGE_CODES.DONE;
  }
  return "";
}

function deriveRepairStage(caseState, decisionType, currentLocationCode) {
  const stageCaseState = String(caseState || "")
    .trim()
    .toUpperCase();
  const stageDecisionType = String(decisionType || "")
    .trim()
    .toUpperCase();
  const zoneCode = String(currentLocationCode || "")
    .trim()
    .toUpperCase();

  if (zoneCode === "OUTBOUND_ZONE") {
    return "";
  }
  if (
    zoneCode === "REPAIR_DONE_ZONE" ||
    stageCaseState === REPAIR_CASE_STATES.DONE
  ) {
    return REPAIR_STAGE_CODES.DONE;
  }
  if (
    ["INTERNAL_REPAIR_ZONE", "EXTERNAL_REPAIR_ZONE"].includes(zoneCode) ||
    stageCaseState === REPAIR_CASE_STATES.ACCEPTED
  ) {
    return REPAIR_STAGE_CODES.IN_PROGRESS;
  }
  if (stageCaseState === REPAIR_CASE_STATES.PROPOSED) {
    return REPAIR_STAGE_CODES.PROPOSED;
  }
  if (
    [REPAIR_CASE_STATES.READY_TO_SEND, REPAIR_CASE_STATES.REJECTED].includes(
      stageCaseState,
    )
  ) {
    return REPAIR_STAGE_CODES.READY_TO_SEND;
  }
  if (
    stageDecisionType === "EXTERNAL" &&
    stageCaseState === REPAIR_CASE_STATES.DRAFT
  ) {
    return REPAIR_STAGE_CODES.EXTERNAL_WAITING;
  }
  return REPAIR_STAGE_CODES.DOMESTIC;
}

async function hideInvalidDomesticArrivals(conn) {
  // 잘못 스캔되어 생성된 잡음 데이터는 운영 목록에서 제외한다.
  await conn.query(
    `
    UPDATE wms_items i
    LEFT JOIN wms_repair_cases rc
      ON rc.item_id = i.id
    SET i.current_status = 'COMPLETED',
        i.updated_at = NOW()
    WHERE i.current_location_code = 'DOMESTIC_ARRIVAL_ZONE'
      AND i.current_status <> 'COMPLETED'
      AND rc.id IS NULL
      AND (
        NULLIF(TRIM(i.source_item_id), '') IS NULL
        AND (
          i.source_bid_type IS NULL
          OR i.source_bid_type NOT IN ('live', 'direct', 'instant')
          OR i.source_bid_id IS NULL
        )
      )
      AND (
        COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) IS NULL
        OR CHAR_LENGTH(
          COALESCE(
            NULLIF(TRIM(i.internal_barcode), ''),
            NULLIF(TRIM(i.external_barcode), '')
          )
        ) < 6
        OR COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) NOT REGEXP '[0-9]'
      )
    `,
  );

  // WMS를 COMPLETED로 바꾼 것들의 shipping_status도 동기화
  await conn.query(
    `
    UPDATE direct_bids d
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET d.shipping_status = 'completed',
        d.updated_at = NOW()
    WHERE d.status = 'completed'
      AND wi.current_status = 'COMPLETED'
      AND d.shipping_status <> 'completed'
    `,
  );

  await conn.query(
    `
    UPDATE live_bids l
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET l.shipping_status = 'completed',
        l.updated_at = NOW()
    WHERE l.status = 'completed'
      AND wi.current_status = 'COMPLETED'
      AND l.shipping_status <> 'completed'
    `,
  );

  await conn.query(
    `
    UPDATE instant_purchases ip
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = ip.id
    SET ip.shipping_status = 'completed',
        ip.updated_at = NOW()
    WHERE ip.status = 'completed'
      AND wi.current_status = 'COMPLETED'
      AND ip.shipping_status <> 'completed'
    `,
  );
}

async function reconcileDoneCasesToRepairDoneZone(conn) {
  // 과거 데이터 중 DONE인데 존코드가 내부/외부에 남아 있는 건을 수선완료존으로 정합한다.
  await conn.query(
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

async function syncBidStatusByLocation(conn, item, toLocationCode) {
  const normalizedToLocationCode = normalizeLocationCode(toLocationCode);
  let nextBidStatus = null;
  if (
    normalizedToLocationCode === "DOMESTIC_ARRIVAL_ZONE" ||
    normalizedToLocationCode === "INBOUND_ZONE"
  ) {
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

async function fetchRepairItemWithMeta(conn, itemId) {
  const [rows] = await conn.query(
    `
    SELECT
      i.id,
      i.member_name,
      i.internal_barcode,
      i.external_barcode,
      i.current_location_code,
      i.current_status,
      i.source_bid_type,
      i.source_bid_id,
      i.source_item_id,
      i.source_scheduled_date,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
      COALESCE(ci.original_title, ci.title) AS product_title,
      COALESCE(
        NULLIF(TRIM(ci.image), ''),
        CASE
          WHEN JSON_VALID(ci.additional_images) THEN
            NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
          ELSE NULL
        END,
        ''
      ) AS product_image,
      COALESCE(u.company_name, i.member_name) AS company_name
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
    LEFT JOIN users u
      ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) =
         CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
    WHERE i.id = ?
    LIMIT 1
    `,
    [itemId],
  );
  return rows[0] || null;
}

router.get("/sheet-settings", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const [main, completed] = await Promise.all([
      getRepairSheetSetting(conn, SHEET_SETTING_KEYS.MAIN_OVERVIEW),
      getRepairSheetSetting(conn, SHEET_SETTING_KEYS.COMPLETED_HISTORY),
    ]);
    res.json({
      ok: true,
      settings: {
        mainOverview: main,
        completedHistory: completed,
      },
    });
  } catch (error) {
    console.error("repair sheet-settings get error:", error);
    res.status(500).json({ ok: false, message: "시트 설정 조회 실패" });
  } finally {
    conn.release();
  }
});

router.put("/sheet-settings/:key", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const normalizedKey = normalizeSheetSettingKey(req.params?.key);
    if (!normalizedKey) {
      return res
        .status(400)
        .json({ ok: false, message: "유효하지 않은 시트 설정 키입니다." });
    }
    const sheetUrl = String(
      req.body?.sheetUrl || req.body?.sheet_url || "",
    ).trim();
    const loginId = String(req.session?.user?.login_id || "admin");
    const saved = await upsertRepairSheetSetting(
      conn,
      normalizedKey,
      sheetUrl,
      loginId,
    );
    if (!saved.ok) {
      return res
        .status(400)
        .json({ ok: false, message: saved.error || "시트 설정 저장 실패" });
    }
    res.json({
      ok: true,
      message: "시트 설정이 저장되었습니다.",
      setting: saved,
    });
  } catch (error) {
    console.error("repair sheet-settings put error:", error);
    res.status(500).json({ ok: false, message: "시트 설정 저장 실패" });
  } finally {
    conn.release();
  }
});

router.post("/sheets/sync-main-overview", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const result = await syncRepairDailyOverviewSheet(conn);
    if (!result?.ok && !result?.skipped) {
      return res
        .status(500)
        .json({ ok: false, message: result?.reason || "전체현황 동기화 실패" });
    }
    res.json({
      ok: true,
      message: result?.skipped
        ? `전체현황 동기화 건너뜀: ${result.reason}`
        : "전체현황 동기화 완료",
      result,
    });
  } catch (error) {
    console.error("repair sync-main-overview error:", error);
    res.status(500).json({ ok: false, message: "전체현황 동기화 실패" });
  } finally {
    conn.release();
  }
});

router.post("/sheets/sync-completed-history", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const result = await syncRepairCompletedHistorySheet(conn);
    if (!result?.ok && !result?.skipped) {
      return res
        .status(500)
        .json({ ok: false, message: result?.reason || "완료내역 동기화 실패" });
    }
    res.json({
      ok: true,
      message: result?.skipped
        ? `완료내역 동기화 건너뜀: ${result.reason}`
        : "완료내역 동기화 완료",
      result,
    });
  } catch (error) {
    console.error("repair sync-completed-history error:", error);
    res.status(500).json({ ok: false, message: "완료내역 동기화 실패" });
  } finally {
    conn.release();
  }
});

router.post("/sheets/sync-vendor/:id", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const vendorId = Number(req.params?.id);
    if (!vendorId) {
      return res
        .status(400)
        .json({ ok: false, message: "업체 id가 필요합니다." });
    }
    const [rows] = await conn.query(
      `
      SELECT id, name, is_active
      FROM wms_repair_vendors
      WHERE id = ?
      LIMIT 1
      `,
      [vendorId],
    );
    const vendor = rows[0] || null;
    if (!vendor || Number(vendor.is_active || 0) !== 1) {
      return res
        .status(404)
        .json({ ok: false, message: "업체를 찾을 수 없습니다." });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    const cursorIndex = Math.max(
      0,
      Number(req.body?.cursorIndex ?? req.query?.cursorIndex ?? 0) || 0,
    );
    const limitRaw = Number(req.body?.limit ?? req.query?.limit ?? 4) || 4;
    const maxTargets = Math.min(10, Math.max(1, limitRaw));
    const summary = await executeBatchReconcile(conn, loginId, {
      vendorNames: [vendor.name],
      includeOverviewSync: false,
      skipCleanup: true,
      skipSort: true,
      cursorIndex,
      maxTargets,
    });
    res.json({
      ok: true,
      message: `[${vendor.name}] 시트 동기화 완료`,
      result: {
        vendorId,
        vendorName: vendor.name,
        ...summary.result,
        summaryMessage: summary.message,
        limit: maxTargets,
      },
    });
  } catch (error) {
    console.error("repair sync-vendor error:", error);
    res.status(500).json({ ok: false, message: "업체 시트 동기화 실패" });
  } finally {
    conn.release();
  }
});

router.get("/vendors", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const [rows] = await conn.query(
      `
      SELECT id, name, sheet_url, sheet_id, sheet_gid
      FROM wms_repair_vendors
      WHERE is_active = 1
      ORDER BY name ASC
      `,
    );
    res.json({ ok: true, vendors: rows });
  } catch (error) {
    console.error("repair vendors error:", error);
    res.status(500).json({ ok: false, message: "외주업체 목록 조회 실패" });
  } finally {
    conn.release();
  }
});

router.post("/vendors", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const name = String(req.body?.name || "").trim();
    const sheetUrl = String(
      req.body?.sheetUrl || req.body?.sheet_url || "",
    ).trim();
    if (!name) {
      return res
        .status(400)
        .json({ ok: false, message: "업체명을 입력하세요." });
    }

    const parsed = parseGoogleSheetLink(sheetUrl);
    await conn.query(
      `
      INSERT INTO wms_repair_vendors (name, sheet_url, sheet_id, sheet_gid, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        is_active = 1,
        sheet_url = VALUES(sheet_url),
        sheet_id = VALUES(sheet_id),
        sheet_gid = VALUES(sheet_gid),
        updated_at = NOW()
      `,
      [name, parsed.sheetUrl, parsed.sheetId, parsed.sheetGid],
    );

    res.json({
      ok: true,
      message: "외주업체가 등록되었습니다.",
      vendor: {
        name,
        sheet_url: parsed.sheetUrl,
        sheet_id: parsed.sheetId,
        sheet_gid: parsed.sheetGid,
      },
    });
  } catch (error) {
    console.error("repair vendor create error:", error);
    res.status(500).json({ ok: false, message: "외주업체 등록 실패" });
  } finally {
    conn.release();
  }
});

router.put("/vendors/:id", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const vendorId = Number(req.params?.id);
    if (!vendorId) {
      return res
        .status(400)
        .json({ ok: false, message: "업체 id가 필요합니다." });
    }

    const name = String(req.body?.name || req.body?.vendorName || "").trim();
    const sheetUrl = String(
      req.body?.sheetUrl || req.body?.sheet_url || "",
    ).trim();
    if (!name) {
      return res
        .status(400)
        .json({ ok: false, message: "업체명을 입력하세요." });
    }

    await conn.beginTransaction();
    const [vendorRows] = await conn.query(
      `
      SELECT id, name
      FROM wms_repair_vendors
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [vendorId],
    );
    const vendor = vendorRows[0];
    if (!vendor) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "외주업체를 찾을 수 없습니다." });
    }
    if (vendor.name === INTERNAL_VENDOR_NAME && name !== INTERNAL_VENDOR_NAME) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "내부업체 이름은 변경할 수 없습니다. 시트 링크만 수정하세요.",
      });
    }
    const nextName =
      vendor.name === INTERNAL_VENDOR_NAME ? INTERNAL_VENDOR_NAME : name;

    const parsed = parseGoogleSheetLink(sheetUrl);
    await conn.query(
      `
      UPDATE wms_repair_vendors
      SET name = ?,
          sheet_url = ?,
          sheet_id = ?,
          sheet_gid = ?,
          is_active = 1,
          updated_at = NOW()
      WHERE id = ?
      `,
      [nextName, parsed.sheetUrl, parsed.sheetId, parsed.sheetGid, vendorId],
    );

    if (vendor.name !== nextName) {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET vendor_name = ?,
            updated_at = NOW()
        WHERE vendor_name = ?
        `,
        [nextName, vendor.name],
      );
    }

    await conn.commit();
    await syncRepairDailyOverviewSheetSafe(conn, "vendor-update");

    res.json({
      ok: true,
      message: "외주업체가 수정되었습니다.",
      vendor: {
        id: vendorId,
        name: nextName,
        sheet_url: parsed.sheetUrl,
        sheet_id: parsed.sheetId,
        sheet_gid: parsed.sheetGid,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair vendor update error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({
          ok: false,
          message: "같은 이름의 외주업체가 이미 존재합니다.",
        });
    }
    res.status(500).json({ ok: false, message: "외주업체 수정 실패" });
  } finally {
    conn.release();
  }
});

router.delete("/vendors/:id", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const vendorId = Number(req.params?.id);
    if (!vendorId) {
      return res
        .status(400)
        .json({ ok: false, message: "업체 id가 필요합니다." });
    }

    const [vendorRows] = await conn.query(
      `
      SELECT id, name
      FROM wms_repair_vendors
      WHERE id = ?
      LIMIT 1
      `,
      [vendorId],
    );
    const vendor = vendorRows[0];
    if (!vendor) {
      return res
        .status(404)
        .json({ ok: false, message: "외주업체를 찾을 수 없습니다." });
    }
    if (vendor.name === INTERNAL_VENDOR_NAME) {
      return res
        .status(400)
        .json({ ok: false, message: "내부업체는 삭제할 수 없습니다." });
    }

    await conn.query(
      `
      UPDATE wms_repair_vendors
      SET is_active = 0,
          updated_at = NOW()
      WHERE id = ?
      `,
      [vendorId],
    );

    res.json({
      ok: true,
      message: "외주업체가 삭제되었습니다.",
      result: { id: vendorId, name: vendor.name },
    });
  } catch (error) {
    console.error("repair vendor delete error:", error);
    res.status(500).json({ ok: false, message: "외주업체 삭제 실패" });
  } finally {
    conn.release();
  }
});

router.get("/domestic-arrivals", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    await backfillCompletedWmsItemsByBidStatus(conn);
    await hideInvalidDomesticArrivals(conn);
    await reconcileDoneCasesToRepairDoneZone(conn);

    const q = String(req.query?.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 300, 50), 1000);

    const where = [
      "i.current_location_code = 'DOMESTIC_ARRIVAL_ZONE'",
      "i.current_status IN ('DOMESTIC_ARRIVED', 'DOMESTIC_ARRIVAL_IN_PROGRESS', 'NEW')",
      "(NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL)",
      `CHAR_LENGTH(
        COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        )
      ) >= 6`,
      `COALESCE(
        NULLIF(TRIM(i.internal_barcode), ''),
        NULLIF(TRIM(i.external_barcode), '')
      ) REGEXP '[0-9]'`,
      "(COALESCE(d.id, l.id, ip.id) IS NOT NULL OR ci.item_id IS NOT NULL)",
    ];
    const params = [];

    if (q) {
      where.push(
        `(
          i.internal_barcode LIKE ?
          OR i.external_barcode LIKE ?
          OR COALESCE(u.company_name, i.member_name, '') LIKE ?
          OR COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id, '') LIKE ?
          OR COALESCE(ci.original_title, ci.title, '') LIKE ?
        )`,
      );
      const k = `%${q}%`;
      params.push(k, k, k, k, k);
    }

    params.push(limit);

    const [rows] = await conn.query(
      `
      SELECT
        i.id,
        COALESCE(u.company_name, i.member_name) AS member_name,
        COALESCE(NULLIF(i.internal_barcode, ''), NULLIF(i.external_barcode, '')) AS internal_barcode,
        i.external_barcode,
        COALESCE(
          NULLIF(i.source_bid_type, ''),
          CASE
            WHEN d.id IS NOT NULL THEN 'direct'
            WHEN l.id IS NOT NULL THEN 'live'
            ELSE NULL
          END
        ) AS source_bid_type,
        COALESCE(i.source_bid_id, d.id, l.id) AS source_bid_id,
        COALESCE(i.source_item_id, d.item_id, l.item_id) AS source_item_id,
        ci.auc_num AS auc_num,
        i.auction_lot_no,
        i.current_status,
        i.current_location_code,
        i.created_at,
        i.updated_at,
        COALESCE(
          NULLIF(TRIM(ci.image), ''),
          CASE
            WHEN JSON_VALID(ci.additional_images) THEN
              NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
            ELSE NULL
          END,
          ''
        ) AS product_image,
        COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
        COALESCE(ci.original_title, ci.title) AS product_title,
        ci.brand,
        ci.category,
        ci.rank,
        ci.accessory_code,
        ci.additional_info,
        rc.id AS repair_case_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.internal_sent_at,
        rc.internal_synced_at,
        rc.updated_at AS repair_updated_at,
        rv.sheet_url AS vendor_sheet_url
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
      LEFT JOIN wms_repair_cases rc
        ON rc.item_id = i.id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      LEFT JOIN users u
        ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
      LEFT JOIN crawled_items ci
        ON CONVERT(ci.item_id USING utf8mb4) =
           CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
      WHERE ${where.join(" AND ")}
      ORDER BY scheduled_at ASC, i.updated_at ASC, i.id ASC
      LIMIT ?
      `,
      params,
    );

    res.json({ ok: true, items: rows });
  } catch (error) {
    console.error("repair domestic arrivals error:", error);
    res.status(500).json({ ok: false, message: "국내도착 물건 조회 실패" });
  } finally {
    conn.release();
  }
});

router.get("/cases", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    await reconcileDoneCasesToRepairDoneZone(conn);

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.internal_note,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.completed_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.internal_sent_at,
        rc.internal_synced_at,
        rc.updated_by,
        rc.updated_at,
        COALESCE(i.source_item_id, d.item_id, l.item_id) AS source_item_id,
        ci.auc_num AS auc_num,
        COALESCE(NULLIF(i.internal_barcode, ''), NULLIF(i.external_barcode, '')) AS internal_barcode,
        COALESCE(u.company_name, i.member_name) AS member_name,
        i.current_location_code,
        i.current_status,
        COALESCE(ci.original_title, ci.title) AS product_title,
        COALESCE(
          NULLIF(TRIM(ci.image), ''),
          CASE
            WHEN JSON_VALID(ci.additional_images) THEN
              NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(ci.additional_images, '$[0]'))), '')
            ELSE NULL
          END,
          ''
        ) AS product_image,
        COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
        ci.brand,
        ci.category,
        ci.rank,
        ci.accessory_code,
        ci.additional_info,
        rv.sheet_url AS vendor_sheet_url
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN direct_bids d
        ON i.source_bid_type = 'direct'
       AND i.source_bid_id = d.id
      LEFT JOIN live_bids l
        ON i.source_bid_type = 'live'
       AND i.source_bid_id = l.id
      LEFT JOIN instant_purchases ip
        ON i.source_bid_type = 'instant'
       AND i.source_bid_id = ip.id
      LEFT JOIN users u
        ON u.id = COALESCE(d.user_id, l.user_id, ip.user_id)
      LEFT JOIN crawled_items ci
        ON CONVERT(ci.item_id USING utf8mb4) =
           CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id, ip.item_id) USING utf8mb4)
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      ORDER BY scheduled_at ASC, rc.updated_at ASC, rc.id ASC
      LIMIT 1000
      `,
    );

    res.json({ ok: true, cases: rows });
  } catch (error) {
    console.error("repair cases error:", error);
    res.status(500).json({ ok: false, message: "수선제안 목록 조회 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);

    const itemId = Number(req.body?.itemId);
    const decisionType = String(req.body?.decisionType || "")
      .trim()
      .toUpperCase();
    const vendorNameInput = String(req.body?.vendorName || "").trim();
    const repairNote = String(req.body?.repairNote || "").trim();
    const repairEta = String(req.body?.repairEta || "").trim();
    const internalNote = String(req.body?.internalNote || "").trim();
    const repairAmount = toAmount(req.body?.repairAmount);
    const caseStateInput = String(req.body?.caseState || "")
      .trim()
      .toUpperCase();
    const action = String(req.body?.action || "")
      .trim()
      .toLowerCase();
    const proposeRequested =
      action === "propose" ||
      caseStateInput === REPAIR_CASE_STATES.PROPOSED ||
      req.body?.isProposal === true;

    if (!itemId) {
      return res
        .status(400)
        .json({ ok: false, message: "itemId가 필요합니다." });
    }
    if (!["INTERNAL", "EXTERNAL", "NONE"].includes(decisionType)) {
      return res.status(400).json({
        ok: false,
        message: "수선 구분은 INTERNAL/EXTERNAL/NONE만 가능합니다.",
      });
    }
    if (proposeRequested && decisionType === "NONE") {
      return res.status(400).json({
        ok: false,
        message: "무수선(NONE) 건은 제안등록할 수 없습니다.",
      });
    }
    if (decisionType === "EXTERNAL" && !vendorNameInput) {
      return res
        .status(400)
        .json({ ok: false, message: "외부수선은 외주업체 선택이 필요합니다." });
    }
    if (
      (decisionType === "INTERNAL" || proposeRequested) &&
      repairAmount === null
    ) {
      return res.status(400).json({
        ok: false,
        message: "견적금액을 입력하세요.",
      });
    }

    await conn.beginTransaction();

    const item = await fetchRepairItemWithMeta(conn, itemId);
    if (!item) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }

    const [existingRows] = await conn.query(
      `
      SELECT id, case_state
      FROM wms_repair_cases
      WHERE item_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const existing = existingRows[0] || null;
    if (
      existing &&
      [REPAIR_CASE_STATES.ACCEPTED, REPAIR_CASE_STATES.DONE].includes(
        existing.case_state,
      )
    ) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message:
          "이미 진행중/완료된 수선건은 국내도착 단계에서 수정할 수 없습니다.",
      });
    }

    const vendorName =
      decisionType === "EXTERNAL"
        ? vendorNameInput
        : decisionType === "NONE"
          ? "무수선"
          : INTERNAL_VENDOR_NAME;
    if (["EXTERNAL", "INTERNAL"].includes(decisionType)) {
      await conn.query(
        `
        INSERT INTO wms_repair_vendors (name, is_active)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE
          is_active = 1,
          updated_at = NOW()
        `,
        [vendorName],
      );
    }

    const proposalText =
      decisionType === "NONE"
        ? null
        : buildProposalText({
            companyName: item.company_name || item.member_name,
            productTitle: item.product_title,
            barcode: item.internal_barcode || item.external_barcode,
            repairNote,
            repairAmount,
            repairEta,
            vendorName,
            scheduledAt: item.scheduled_at,
          });

    const loginId = String(req.session?.user?.login_id || "admin");
    let nextCaseState = REPAIR_CASE_STATES.DRAFT;
    if (proposeRequested) {
      nextCaseState = REPAIR_CASE_STATES.PROPOSED;
    } else if (decisionType === "INTERNAL") {
      // 내부수선은 견적 입력 즉시 고객 전송 대기 단계로 바로 이동
      nextCaseState = REPAIR_CASE_STATES.READY_TO_SEND;
    } else if (decisionType === "EXTERNAL") {
      // 외부수선은 시트 회신 전까지 견적대기(DRAFT) 유지
      nextCaseState = REPAIR_CASE_STATES.DRAFT;
    }

    let caseId = existing?.id || null;
    if (!existing) {
      const [insertResult] = await conn.query(
        `
        INSERT INTO wms_repair_cases (
          item_id,
          case_state,
          decision_type,
          vendor_name,
          repair_note,
          repair_amount,
          repair_eta,
          proposal_text,
          internal_note,
          proposed_at,
          created_by,
          updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          itemId,
          nextCaseState,
          decisionType,
          vendorName,
          repairNote || null,
          repairAmount,
          repairEta || null,
          proposalText,
          internalNote || null,
          proposeRequested ? new Date() : null,
          loginId,
          loginId,
        ],
      );
      caseId = Number(insertResult.insertId);
    } else {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET case_state = ?,
            decision_type = ?,
            vendor_name = ?,
            repair_note = ?,
            repair_amount = ?,
            repair_eta = ?,
            proposal_text = ?,
            internal_note = ?,
            proposed_at = CASE WHEN ? = 'PROPOSED' THEN NOW() ELSE proposed_at END,
            rejected_at = CASE WHEN ? = 'PROPOSED' THEN NULL ELSE rejected_at END,
            updated_by = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [
          nextCaseState,
          decisionType,
          vendorName,
          repairNote || null,
          repairAmount,
          repairEta || null,
          proposalText,
          internalNote || null,
          nextCaseState,
          nextCaseState,
          loginId,
          existing.id,
        ],
      );
      caseId = Number(existing.id);
    }

    await conn.commit();

    let autoSheet = null;
    if (["EXTERNAL", "INTERNAL"].includes(decisionType) && !proposeRequested) {
      try {
        const pushed = await pushRepairCaseToDecisionSheet({
          conn,
          caseId,
          loginId,
          expectedDecisionType: decisionType,
        });
        if (!pushed.ok) {
          autoSheet = { ok: false, reason: pushed.error, type: decisionType };
        } else {
          if (decisionType === "EXTERNAL") {
            await conn.query(
              `
              UPDATE wms_repair_cases
              SET external_synced_at = NULL,
                  updated_by = ?,
                  updated_at = NOW()
              WHERE id = ?
              `,
              [loginId, caseId],
            );
          }
          autoSheet = {
            ok: true,
            created: !!pushed.created,
            type: decisionType,
          };
        }
      } catch (error) {
        autoSheet = {
          ok: false,
          reason: error?.message || "알 수 없는 오류",
          type: decisionType,
        };
      }
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "save-case",
    );

    const baseMessage = proposeRequested
      ? "고객응답대기 단계로 이동했습니다."
      : decisionType === "EXTERNAL"
        ? "외부 수선 정보가 저장되었습니다. (시트전송완료/견적대기)"
        : "내부 수선 정보가 저장되었습니다. (견적완료/고객전송대기)";
    let message =
      autoSheet === null
        ? baseMessage
        : autoSheet.ok
          ? `${baseMessage} (${autoSheet.type === "INTERNAL" ? "내부" : "외부"} 수선 시트 전송 완료)`
          : `${baseMessage} (${autoSheet.type === "INTERNAL" ? "내부" : "외부"} 수선 시트 전송 실패: ${autoSheet.reason})`;
    if (!overviewSync.ok && !overviewSync.skipped) {
      message += ` (메인시트 갱신 경고: ${overviewSync.reason})`;
    }

    res.json({
      ok: true,
      message,
      result: {
        caseId,
        itemId,
        caseState: nextCaseState,
        decisionType,
        vendorName,
        proposalText,
        autoSheet,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair save error:", error);
    res.status(500).json({ ok: false, message: "수선제안 저장 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/push-external-sheet", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const loginId = String(req.session?.user?.login_id || "admin");
    const pushed = await pushRepairCaseToDecisionSheet({
      conn,
      caseId,
      loginId,
      expectedDecisionType: "EXTERNAL",
    });
    if (!pushed.ok) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: pushed.error });
    }

    await conn.commit();
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "push-external-sheet",
    );
    res.json({
      ok: true,
      message: pushed.created
        ? "외주시트 전송 완료 (신규 행 추가)"
        : "외주시트 전송 완료 (기존 행 갱신)",
      result: {
        caseId,
        barcode: pushed.barcode,
        created: !!pushed.created,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair external push error:", error);
    res.status(500).json({ ok: false, message: "외주시트 전송 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/push-internal-sheet", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const loginId = String(req.session?.user?.login_id || "admin");
    const pushed = await pushRepairCaseToDecisionSheet({
      conn,
      caseId,
      loginId,
      expectedDecisionType: "INTERNAL",
    });
    if (!pushed.ok) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: pushed.error });
    }

    await conn.commit();
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "push-internal-sheet",
    );
    res.json({
      ok: true,
      message: pushed.created
        ? "내부시트 전송 완료 (신규 행 추가)"
        : "내부시트 전송 완료 (기존 행 갱신)",
      result: {
        caseId,
        barcode: pushed.barcode,
        created: !!pushed.created,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair internal push error:", error);
    res.status(500).json({ ok: false, message: "내부시트 전송 실패" });
  } finally {
    conn.release();
  }
});

router.post("/external-sheet/push-pending", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const force = req.body?.force === true;
    const vendorName = String(req.body?.vendorName || "").trim();
    const loginId = String(req.session?.user?.login_id || "admin");

    const where = [
      `rc.decision_type = 'EXTERNAL'`,
      `rc.case_state IN ('DRAFT', 'READY_TO_SEND', 'PROPOSED', 'ACCEPTED')`,
    ];
    const params = [];
    if (!force) {
      where.push(`rc.external_sent_at IS NULL`);
    }
    if (vendorName) {
      where.push(`rc.vendor_name = ?`);
      params.push(vendorName);
    }

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        i.internal_barcode,
        i.external_barcode,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE ${where.join(" AND ")}
      ORDER BY rc.updated_at DESC
      LIMIT 200
      `,
      params,
    );

    let successCount = 0;
    const failed = [];
    for (const row of rows) {
      const barcode = String(
        row.internal_barcode || row.external_barcode || "",
      ).trim();
      if (!barcode) {
        failed.push({ caseId: row.id, reason: "바코드 없음" });
        continue;
      }
      const parsedSheet = parseGoogleSheetLink(row.sheet_url);
      const sheetId = row.sheet_id || parsedSheet.sheetId;
      const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
      if (!sheetId) {
        failed.push({ caseId: row.id, reason: "업체 시트 링크 미등록" });
        continue;
      }
      try {
        const item = await fetchRepairItemWithMeta(conn, row.item_id);
        const pushed = await upsertVendorSheetRow({
          sheetId,
          sheetGid,
          sheetName: VENDOR_ACTIVE_SHEET_NAME,
          barcode,
          bidDate: formatDateForSheet(item?.scheduled_at),
          productTitle: item?.product_title || "",
          customerName: item?.company_name || item?.member_name || "",
          repairNote: row.repair_note || "",
          workPeriod: row.repair_eta || "",
          vendorName: row.vendor_name || "",
          productImage: item?.product_image || "",
          progressFlag:
            String(row.case_state || "").toUpperCase() ===
            REPAIR_CASE_STATES.ACCEPTED
              ? "TRUE"
              : "FALSE",
        });
        if (pushed?.error) {
          failed.push({ caseId: row.id, reason: pushed.error });
          continue;
        }
        const sorted = await sortVendorSheetRowsByBidDate({
          sheetId,
          sheetGid,
          sheetName: VENDOR_ACTIVE_SHEET_NAME,
          fallbackToFirst: true,
        });
        if (!sorted?.ok) {
          failed.push({
            caseId: row.id,
            reason: sorted.error || "시트 정렬 실패",
          });
          continue;
        }
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = NOW(),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, row.id],
        );
        successCount += 1;
      } catch (error) {
        failed.push({
          caseId: row.id,
          reason: error?.message || "알 수 없는 오류",
        });
      }
    }

    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "push-external-sheet-batch",
    );
    res.json({
      ok: true,
      message: `외주시트 일괄전송 완료: 성공 ${successCount}건 / 실패 ${failed.length}건`,
      result: {
        total: rows.length,
        success: successCount,
        failedCount: failed.length,
        failed: failed.slice(0, 20),
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    console.error("repair external batch push error:", error);
    res.status(500).json({ ok: false, message: "외주시트 일괄전송 실패" });
  } finally {
    conn.release();
  }
});

function getBatchReconcileJobSnapshot() {
  return {
    runId: batchReconcileJobState.runId,
    running: !!batchReconcileJobState.running,
    requestedBy: batchReconcileJobState.requestedBy || null,
    startedAt: batchReconcileJobState.startedAt || null,
    finishedAt: batchReconcileJobState.finishedAt || null,
    summary: batchReconcileJobState.summary || null,
    error: batchReconcileJobState.error || null,
  };
}

async function executeBatchReconcile(conn, loginId, options = {}) {
  const targetVendorNames = new Set(
    (Array.isArray(options.vendorNames) ? options.vendorNames : [])
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  );
  const hasVendorFilter = targetVendorNames.size > 0;
  const includeOverviewSync = options.includeOverviewSync !== false;
  const skipCleanup = options.skipCleanup === true;
  const skipSort = options.skipSort === true;
  const cursorIndex = Math.max(0, Number(options.cursorIndex || 0) || 0);
  const maxTargets = Math.max(0, Number(options.maxTargets || 0) || 0);

  await ensureRepairTables(conn);
  await reconcileDoneCasesToRepairDoneZone(conn);

  const [vendorRows] = await conn.query(
    `
    SELECT name, sheet_url, sheet_id, sheet_gid
    FROM wms_repair_vendors
    ORDER BY name ASC
    `,
  );

  const vendorInfoMap = new Map();
  for (const vendorRow of vendorRows) {
    const name = String(vendorRow?.name || "").trim();
    if (!name) continue;
    const parsedSheet = parseGoogleSheetLink(vendorRow?.sheet_url);
    vendorInfoMap.set(name, {
      name,
      sheetId: String(vendorRow?.sheet_id || parsedSheet.sheetId || "").trim(),
      sheetGid: String(
        vendorRow?.sheet_gid || parsedSheet.sheetGid || "",
      ).trim(),
    });
  }
  if (!vendorInfoMap.has(INTERNAL_VENDOR_NAME)) {
    const internalVendor = await resolveRepairVendorSheetInfo(
      conn,
      INTERNAL_VENDOR_NAME,
    );
    vendorInfoMap.set(INTERNAL_VENDOR_NAME, {
      name: INTERNAL_VENDOR_NAME,
      sheetId: String(internalVendor?.sheetId || "").trim(),
      sheetGid: String(internalVendor?.sheetGid || "").trim(),
    });
  }

  const [caseRows] = await conn.query(`
    SELECT
      rc.id AS case_id,
      rc.item_id,
      rc.case_state,
      rc.decision_type,
      rc.vendor_name,
      i.internal_barcode,
      i.external_barcode,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date, rc.updated_at, i.updated_at, i.created_at) AS scheduled_at
    FROM wms_repair_cases rc
    INNER JOIN wms_items i
      ON i.id = rc.item_id
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
    ORDER BY scheduled_at ASC, rc.id ASC
  `);

  const mismatches = [];
  const targets = [];
  const desiredActiveByVendor = new Map();
  const desiredCompletedByVendor = new Map();

  for (const row of caseRows) {
    const caseId = Number(row.case_id || 0);
    const decisionType = String(row.decision_type || "")
      .trim()
      .toUpperCase();
    const caseState = String(row.case_state || "")
      .trim()
      .toUpperCase();
    if (!["INTERNAL", "EXTERNAL"].includes(decisionType)) continue;
    if (
      [REPAIR_CASE_STATES.ARRIVED, REPAIR_CASE_STATES.REJECTED].includes(
        caseState,
      )
    )
      continue;

    const barcodeRaw = String(
      row.internal_barcode || row.external_barcode || "",
    ).trim();
    const barcode = normalizeBarcode(barcodeRaw);
    if (!barcode) {
      mismatches.push({
        code: "missing_barcode",
        caseId,
        reason: "내부바코드가 없어 시트 반영 대상에서 제외",
      });
      continue;
    }
    const vendorName =
      decisionType === "INTERNAL"
        ? INTERNAL_VENDOR_NAME
        : String(row.vendor_name || "").trim();
    if (hasVendorFilter && !targetVendorNames.has(vendorName)) continue;
    if (!vendorName) {
      mismatches.push({
        code: "missing_vendor",
        caseId,
        barcode: barcodeRaw,
        reason: "외부수선인데 업체명이 비어 있음",
      });
      continue;
    }
    const vendorConfig = vendorInfoMap.get(vendorName);
    if (!vendorConfig?.sheetId) {
      mismatches.push({
        code: "missing_sheet_link",
        caseId,
        vendorName,
        barcode: barcodeRaw,
        reason: "업체 시트 링크 없음",
      });
      continue;
    }

    const sheetState = resolveVendorSheetState(caseState);
    if (sheetState === "ACTIVE") {
      let set = desiredActiveByVendor.get(vendorName);
      if (!set) {
        set = new Set();
        desiredActiveByVendor.set(vendorName, set);
      }
      set.add(barcode);
    } else if (sheetState === "COMPLETED") {
      let set = desiredCompletedByVendor.get(vendorName);
      if (!set) {
        set = new Set();
        desiredCompletedByVendor.set(vendorName, set);
      }
      set.add(barcode);
    }
    targets.push({ caseId, decisionType, vendorName, barcode: barcodeRaw });
  }

  const processingTargets =
    maxTargets > 0
      ? targets.slice(cursorIndex, cursorIndex + maxTargets)
      : targets;
  const nextCursorIndex =
    maxTargets > 0 && cursorIndex + processingTargets.length < targets.length
      ? cursorIndex + processingTargets.length
      : null;

  let syncedCount = 0;
  for (const target of processingTargets) {
    try {
      const pushed = await pushRepairCaseToDecisionSheet({
        conn,
        caseId: target.caseId,
        loginId,
        expectedDecisionType: target.decisionType,
        skipSheetSort: true,
      });
      if (pushed?.ok) syncedCount += 1;
      else {
        mismatches.push({
          code: "sheet_upsert_failed",
          caseId: target.caseId,
          vendorName: target.vendorName,
          barcode: target.barcode,
          reason: pushed?.error || "시트 반영 실패",
        });
      }
    } catch (error) {
      mismatches.push({
        code: "sheet_upsert_error",
        caseId: target.caseId,
        vendorName: target.vendorName,
        barcode: target.barcode,
        reason: error?.message || "시트 반영 중 예외",
      });
    }
  }

  let removedCount = 0;
  let sortedSheetCount = 0;
  for (const [vendorName, vendorConfig] of vendorInfoMap.entries()) {
    if (hasVendorFilter && !targetVendorNames.has(vendorName)) continue;
    if (!vendorConfig?.sheetId) continue;

    if (!skipCleanup) {
      const activeAllowed = [
        ...(desiredActiveByVendor.get(vendorName) || new Set()),
      ];
      const completedAllowed = [
        ...(desiredCompletedByVendor.get(vendorName) || new Set()),
      ];

      const cleanedActive = await cleanupVendorSheetRowsByAllowedBarcodes({
        sheetId: vendorConfig.sheetId,
        sheetGid: vendorConfig.sheetGid,
        sheetName: VENDOR_ACTIVE_SHEET_NAME,
        fallbackToFirst: false,
        allowedBarcodes: activeAllowed,
      });
      if (cleanedActive.ok) removedCount += Number(cleanedActive.removed || 0);
      else {
        mismatches.push({
          code: "sheet_cleanup_failed",
          vendorName,
          reason: cleanedActive.error || "진행중 시트 정리 실패",
        });
      }

      const cleanedCompleted = await cleanupVendorSheetRowsByAllowedBarcodes({
        sheetId: vendorConfig.sheetId,
        sheetGid: vendorConfig.sheetGid,
        sheetName: VENDOR_COMPLETED_SHEET_NAME,
        fallbackToFirst: false,
        allowedBarcodes: completedAllowed,
      });
      if (cleanedCompleted.ok)
        removedCount += Number(cleanedCompleted.removed || 0);
      else {
        mismatches.push({
          code: "sheet_cleanup_failed",
          vendorName,
          reason: cleanedCompleted.error || "완료 시트 정리 실패",
        });
      }
    }

    if (!skipSort) {
      const sortedActive = await sortVendorSheetRowsByBidDate({
        sheetId: vendorConfig.sheetId,
        sheetGid: vendorConfig.sheetGid,
        sheetName: VENDOR_ACTIVE_SHEET_NAME,
        fallbackToFirst: false,
      });
      if (sortedActive.ok && sortedActive.sorted) sortedSheetCount += 1;
      if (!sortedActive.ok) {
        mismatches.push({
          code: "sheet_sort_failed",
          vendorName,
          reason: sortedActive.error || "진행중 시트 정렬 실패",
        });
      }

      const sortedCompleted = await sortVendorSheetRowsByBidDate({
        sheetId: vendorConfig.sheetId,
        sheetGid: vendorConfig.sheetGid,
        sheetName: VENDOR_COMPLETED_SHEET_NAME,
        fallbackToFirst: false,
      });
      if (sortedCompleted.ok && sortedCompleted.sorted) sortedSheetCount += 1;
      if (!sortedCompleted.ok) {
        mismatches.push({
          code: "sheet_sort_failed",
          vendorName,
          reason: sortedCompleted.error || "완료 시트 정렬 실패",
        });
      }
    }
  }

  const overviewSync = includeOverviewSync
    ? await syncRepairDailyOverviewSheetSafe(conn, "batch-reconcile")
    : { ok: true, skipped: true, reason: "overview sync skipped" };
  return {
    message: `일괄 업데이트 완료: 적용 ${syncedCount}건 / 정리 ${removedCount}건 / 불일치 ${mismatches.length}건`,
    result: {
      targetCount: targets.length,
      processedTargetCount: processingTargets.length,
      cursorIndex,
      nextCursorIndex,
      hasMore: nextCursorIndex !== null,
      syncedCount,
      removedCount,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 50),
      sortedSheetCount,
      overviewSynced: !!overviewSync.ok,
    },
  };
}

function startBatchReconcileJob({ loginId }) {
  if (batchReconcileJobState.running) {
    return { started: false, job: getBatchReconcileJobSnapshot() };
  }

  batchReconcileJobState.runId += 1;
  const runId = batchReconcileJobState.runId;
  batchReconcileJobState.running = true;
  batchReconcileJobState.requestedBy = String(loginId || "admin");
  batchReconcileJobState.startedAt = new Date().toISOString();
  batchReconcileJobState.finishedAt = null;
  batchReconcileJobState.summary = null;
  batchReconcileJobState.error = null;

  setImmediate(async () => {
    const conn = await pool.getConnection();
    try {
      const summary = await executeBatchReconcile(
        conn,
        batchReconcileJobState.requestedBy,
      );
      if (batchReconcileJobState.runId === runId) {
        batchReconcileJobState.summary = summary;
        batchReconcileJobState.error = null;
      }
    } catch (error) {
      console.error("repair batch reconcile job error:", error);
      if (batchReconcileJobState.runId === runId) {
        batchReconcileJobState.summary = null;
        batchReconcileJobState.error =
          error?.message || "시트 일괄 업데이트 실패";
      }
    } finally {
      conn.release();
      if (batchReconcileJobState.runId === runId) {
        batchReconcileJobState.running = false;
        batchReconcileJobState.finishedAt = new Date().toISOString();
      }
    }
  });

  return { started: true, job: getBatchReconcileJobSnapshot() };
}

router.post("/sheets/batch-reconcile", isAdmin, async (req, res) => {
  const loginId = String(req.session?.user?.login_id || "admin");
  const forceSync =
    String(req.query?.sync || req.body?.sync || "")
      .trim()
      .toLowerCase() === "true" ||
    String(req.query?.sync || req.body?.sync || "").trim() === "1";

  if (forceSync) {
    const conn = await pool.getConnection();
    try {
      const summary = await executeBatchReconcile(conn, loginId);
      return res.json({
        ok: true,
        message: summary.message,
        result: summary.result,
      });
    } catch (error) {
      console.error("repair batch reconcile sync error:", error);
      return res
        .status(500)
        .json({ ok: false, message: "시트 일괄 업데이트 실패" });
    } finally {
      conn.release();
    }
  }

  const kickoff = startBatchReconcileJob({ loginId });
  const statusCode = kickoff.started ? 202 : 200;
  return res.status(statusCode).json({
    ok: true,
    message: kickoff.started
      ? "일괄 업데이트를 시작했습니다. 완료까지 시간이 걸릴 수 있습니다."
      : "이미 일괄 업데이트가 실행 중입니다.",
    result: {
      started: kickoff.started,
      job: kickoff.job,
    },
  });
});

router.get("/sheets/batch-reconcile/status", isAdmin, async (req, res) => {
  return res.json({
    ok: true,
    result: {
      job: getBatchReconcileJobSnapshot(),
    },
  });
});

router.post("/items/:itemId/no-repair-complete", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const itemId = Number(req.params?.itemId);
    if (!itemId) {
      return res
        .status(400)
        .json({ ok: false, message: "item id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [itemRows] = await conn.query(
      `
      SELECT
        id,
        internal_barcode,
        external_barcode,
        current_location_code,
        current_status,
        source_bid_type,
        source_bid_id,
        source_item_id
      FROM wms_items
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const item = itemRows[0];
    if (!item) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }
    if (item.current_location_code !== "DOMESTIC_ARRIVAL_ZONE") {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "국내도착 단계에서만 무수선 완료 처리할 수 있습니다.",
      });
    }

    const [caseRows] = await conn.query(
      `
      SELECT id, case_state
      FROM wms_repair_cases
      WHERE item_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const existing = caseRows[0] || null;
    if (existing?.case_state === REPAIR_CASE_STATES.ACCEPTED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "이미 수선 진행중인 건은 무수선 완료로 바꿀 수 없습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    let caseId = existing?.id || null;
    if (!existing) {
      const [insertResult] = await conn.query(
        `
        INSERT INTO wms_repair_cases (
          item_id,
          case_state,
          decision_type,
          vendor_name,
          repair_note,
          repair_amount,
          proposal_text,
          completed_at,
          created_by,
          updated_by
        ) VALUES (?, ?, 'NONE', '무수선', ?, 0, NULL, NOW(), ?, ?)
        `,
        [itemId, REPAIR_CASE_STATES.DONE, "무수선 진행", loginId, loginId],
      );
      caseId = Number(insertResult.insertId);
    } else {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET case_state = ?,
            decision_type = 'NONE',
            vendor_name = '무수선',
            repair_note = ?,
            repair_amount = 0,
            repair_eta = NULL,
            proposal_text = NULL,
            completed_at = NOW(),
            updated_by = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [REPAIR_CASE_STATES.DONE, "무수선 진행", loginId, existing.id],
      );
      caseId = Number(existing.id);
    }

    await moveItemToZone({
      conn,
      item,
      toZoneCode: "REPAIR_DONE_ZONE",
      actionType: "REPAIR_SKIP_DONE",
      staffName: loginId,
      note: "무수선 완료 처리",
    });
    await syncBidStatusByLocation(conn, item, "REPAIR_DONE_ZONE");

    await conn.commit();
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "no-repair-complete",
    );
    res.json({
      ok: true,
      message: "무수선 완료 처리되었습니다. 수선완료존으로 이동했습니다.",
      result: { caseId, itemId, overviewSynced: !!overviewSync.ok },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair no-repair error:", error);
    res.status(500).json({ ok: false, message: "무수선 완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/sync-external-quote", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_eta,
        i.internal_barcode,
        i.external_barcode,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.decision_type !== "EXTERNAL") {
      await conn.rollback();
      return res
        .status(400)
        .json({ ok: false, message: "외부수선 건만 동기화할 수 있습니다." });
    }
    if (
      String(row.case_state || "")
        .trim()
        .toUpperCase() === REPAIR_CASE_STATES.ARRIVED
    ) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "1단계(국내도착) 건은 외주시트 동기화 대상이 아닙니다.",
      });
    }

    const barcode = String(
      row.internal_barcode || row.external_barcode || "",
    ).trim();
    if (!barcode) {
      await conn.rollback();
      return res
        .status(400)
        .json({
          ok: false,
          message: "내부바코드가 없어 동기화할 수 없습니다.",
        });
    }

    const parsedSheet = parseGoogleSheetLink(row.sheet_url);
    const sheetId = row.sheet_id || parsedSheet.sheetId;
    const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
    if (!sheetId) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message:
          "업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 시트 링크를 등록하세요.",
      });
    }

    const quote = await fetchVendorSheetQuote({
      sheetId,
      sheetGid,
      sheetName: VENDOR_ACTIVE_SHEET_NAME,
      fallbackToFirst: true,
      barcode,
    });
    if (quote?.error) {
      const quoteErrorText = String(quote.error || "");
      const shouldAutoCreateRow =
        (quoteErrorText.includes("시트에서 바코드") &&
          quoteErrorText.includes("행을 찾지 못했습니다")) ||
        quoteErrorText.includes("시트 데이터가 비어 있습니다.") ||
        quoteErrorText.includes("시트 헤더를 찾지 못했습니다");
      if (shouldAutoCreateRow) {
        const item = await fetchRepairItemWithMeta(conn, row.item_id);
        const pushed = await upsertVendorSheetRow({
          sheetId,
          sheetGid,
          sheetName: VENDOR_ACTIVE_SHEET_NAME,
          barcode,
          bidDate: formatDateForSheet(item?.scheduled_at),
          productTitle: item?.product_title || "",
          customerName: item?.company_name || item?.member_name || "",
          repairNote: row.repair_note || "",
          workPeriod: row.repair_eta || "",
          vendorName: row.vendor_name || "",
          productImage: item?.product_image || "",
          progressFlag:
            row.case_state === REPAIR_CASE_STATES.ACCEPTED ? "TRUE" : "FALSE",
        });
        if (pushed?.error) {
          await conn.rollback();
          return res.status(500).json({
            ok: false,
            message: `외주시트 재생성 실패: ${pushed.error}`,
          });
        }

        const loginId = String(req.session?.user?.login_id || "admin");
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = COALESCE(external_sent_at, NOW()),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, caseId],
        );

        await conn.commit();
        const overviewSync = await syncRepairDailyOverviewSheetSafe(
          conn,
          "sync-external-quote-recreate-row",
        );
        return res.json({
          ok: true,
          message:
            "시트가 비어있거나 바코드 행이 없어 자동으로 생성했습니다. 업체가 견적 입력 후 다시 동기화하세요.",
          result: {
            caseId,
            barcode,
            recreated: true,
            overviewSynced: !!overviewSync.ok,
          },
        });
      }
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        message: quote.error,
      });
    }

    const quoteAmountRawText = String(quote.quoteAmountRaw ?? "").trim();
    const quoteAmount = toAmount(quote.quoteAmountRaw);
    if (quoteAmount === null) {
      if (!quoteAmountRawText) {
        const loginId = String(req.session?.user?.login_id || "admin");
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = COALESCE(external_sent_at, NOW()),
              external_synced_at = NOW(),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, caseId],
        );
        await conn.commit();
        const overviewSync = await syncRepairDailyOverviewSheetSafe(
          conn,
          "sync-external-quote-empty-amount",
        );
        return res.json({
          ok: true,
          message:
            "외주시트 행 동기화 완료. 현재 견적이 비어있어 금액 반영은 하지 않았습니다.",
          result: {
            caseId,
            barcode,
            quotePending: true,
            overviewSynced: !!overviewSync.ok,
          },
        });
      }
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "시트 견적금액 형식이 올바르지 않습니다.",
      });
    }

    const addNotes = [];
    if (quote.noteRaw) addNotes.push(String(quote.noteRaw).trim());
    const mergedRepairNote = [String(row.repair_note || "").trim(), ...addNotes]
      .filter(Boolean)
      .join(" / ");
    const mergedRepairEta =
      String(quote.etaRaw || row.repair_eta || "").trim() || null;

    const item = await fetchRepairItemWithMeta(conn, row.item_id);
    const proposalText = buildProposalText({
      companyName: item?.company_name || item?.member_name,
      productTitle: item?.product_title,
      barcode: item?.internal_barcode || item?.external_barcode || barcode,
      repairNote: mergedRepairNote,
      repairAmount: quoteAmount,
      repairEta: mergedRepairEta,
      vendorName: row.vendor_name,
      scheduledAt: item?.scheduled_at,
    });

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET repair_amount = ?,
          repair_note = ?,
          repair_eta = ?,
          proposal_text = ?,
          case_state = CASE
            WHEN case_state IN ('PROPOSED', 'ACCEPTED', 'DONE') THEN case_state
            ELSE 'READY_TO_SEND'
          END,
          external_sent_at = COALESCE(external_sent_at, NOW()),
          external_synced_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        quoteAmount,
        mergedRepairNote || null,
        mergedRepairEta,
        proposalText,
        loginId,
        caseId,
      ],
    );

    await conn.commit();
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "sync-external-quote",
    );

    res.json({
      ok: true,
      message:
        Number(quote?.matchedCount || 0) > 1
          ? `외주 시트 견적을 동기화했습니다. (견적완료/고객전송대기, 동일 바코드 ${quote.matchedCount}행 중 R${quote.pickedRowNumber} 사용)`
          : "외주 시트 견적을 동기화했습니다. (견적완료/고객전송대기)",
      result: {
        caseId,
        caseState: REPAIR_CASE_STATES.READY_TO_SEND,
        quoteAmount,
        eta: quote.etaRaw || null,
        note: quote.noteRaw || null,
        barcode,
        matchedCount: Number(quote?.matchedCount || 0),
        pickedRowNumber: quote?.pickedRowNumber || null,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair external sync error:", error);
    res.status(500).json({ ok: false, message: "외주 시트 동기화 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/accept", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.case_state !== REPAIR_CASE_STATES.PROPOSED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "고객응답대기(PROPOSED) 상태에서만 수락할 수 있습니다.",
      });
    }

    const { zoneCode, actionType } = zoneAndStatusByDecision(row.decision_type);
    const loginId = String(req.session?.user?.login_id || "admin");

    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          accepted_at = NOW(),
          rejected_at = NULL,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.ACCEPTED, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: zoneCode,
      actionType,
      staffName: loginId,
      note:
        row.decision_type === "EXTERNAL"
          ? `외주업체: ${row.vendor_name || "-"}`
          : "내부수선 진행 시작",
    });

    await syncBidStatusByLocation(conn, row, zoneCode);
    await conn.commit();
    let decisionSheetWarning = null;
    if (
      ["INTERNAL", "EXTERNAL"].includes(
        String(row.decision_type || "").toUpperCase(),
      )
    ) {
      try {
        const pushed = await pushRepairCaseToDecisionSheet({
          conn,
          caseId,
          loginId,
          expectedDecisionType: row.decision_type,
        });
        if (!pushed.ok) {
          decisionSheetWarning = `업체시트 동기화 실패: ${pushed.error}`;
        }
      } catch (error) {
        decisionSheetWarning = `업체시트 동기화 실패: ${error?.message || "알 수 없는 오류"}`;
      }
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "accept-case",
    );
    const mergedSheetWarning = decisionSheetWarning || null;

    res.json({
      ok: true,
      message: mergedSheetWarning
        ? `수락 처리되었습니다. 수선 진행 존으로 이동했습니다. (${mergedSheetWarning})`
        : "수락 처리되었습니다. 수선 진행 존으로 이동했습니다.",
      result: {
        caseId,
        zoneCode,
        caseState: REPAIR_CASE_STATES.ACCEPTED,
        sheetProgressWarning: mergedSheetWarning || null,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair accept error:", error);
    res.status(500).json({ ok: false, message: "수선 수락 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/mark-sent", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    const [rows] = await conn.query(
      `
      SELECT id, case_state, decision_type
      FROM wms_repair_cases
      WHERE id = ?
      LIMIT 1
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (
      ![REPAIR_CASE_STATES.READY_TO_SEND, REPAIR_CASE_STATES.REJECTED].includes(
        row.case_state,
      )
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "견적완료/고객전송대기(또는 거절) 단계에서만 전송완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          proposed_at = NOW(),
          rejected_at = NULL,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.PROPOSED, loginId, caseId],
    );
    let decisionSheetSync = null;
    if (
      ["INTERNAL", "EXTERNAL"].includes(
        String(row.decision_type || "").toUpperCase(),
      )
    ) {
      decisionSheetSync = await pushRepairCaseToDecisionSheet({
        conn,
        caseId,
        loginId,
        expectedDecisionType: row.decision_type,
      });
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "mark-sent",
    );

    return res.json({
      ok: true,
      message: "고객 전송완료 처리되었습니다. 고객응답대기로 이동했습니다.",
      result: {
        caseId,
        caseState: REPAIR_CASE_STATES.PROPOSED,
        decisionSheetSync,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    console.error("repair mark-sent error:", error);
    return res.status(500).json({ ok: false, message: "전송완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/reject", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }
    const loginId = String(req.session?.user?.login_id || "admin");

    const [beforeRows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.decision_type,
        rc.vendor_name,
        i.internal_barcode,
        i.external_barcode
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      WHERE rc.id = ?
      LIMIT 1
      `,
      [caseId],
    );
    const before = beforeRows[0] || null;
    if (!before) {
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }

    const [result] = await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          rejected_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.REJECTED, loginId, caseId],
    );
    if (!result.affectedRows) {
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }

    let sheetCleanup = null;
    if (
      ["INTERNAL", "EXTERNAL"].includes(
        String(before.decision_type || "").toUpperCase(),
      )
    ) {
      sheetCleanup = await removeRepairCaseFromVendorSheets({
        conn,
        decisionType: before.decision_type,
        vendorName: before.vendor_name,
        barcode: String(
          before.internal_barcode || before.external_barcode || "",
        ).trim(),
      });
    }

    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "reject-case",
    );
    res.json({
      ok: true,
      message: sheetCleanup?.ok
        ? `수선 제안을 거절 처리했습니다. (시트 행 ${sheetCleanup.removed || 0}건 삭제)`
        : "수선 제안을 거절 처리했습니다.",
      result: {
        caseId,
        sheetCleanup,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    console.error("repair reject error:", error);
    res.status(500).json({ ok: false, message: "수선 거절 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/repair-complete", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.case_state !== REPAIR_CASE_STATES.ACCEPTED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "수락된 수선건만 완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          completed_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.DONE, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: "REPAIR_DONE_ZONE",
      actionType: "REPAIR_DONE",
      staffName: loginId,
      note: "수선완료 처리",
    });
    await syncBidStatusByLocation(conn, row, "REPAIR_DONE_ZONE");

    await conn.commit();
    let decisionSheetSync = null;
    if (
      ["INTERNAL", "EXTERNAL"].includes(
        String(row.decision_type || "").toUpperCase(),
      )
    ) {
      decisionSheetSync = await pushRepairCaseToDecisionSheet({
        conn,
        caseId,
        loginId,
        expectedDecisionType: row.decision_type,
      });
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "repair-complete",
    );
    res.json({
      ok: true,
      message: decisionSheetSync?.ok
        ? "수선완료 처리되었습니다. (업체 시트 완료탭 반영)"
        : "수선완료 처리되었습니다.",
      result: { caseId, decisionSheetSync, overviewSynced: !!overviewSync.ok },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair done error:", error);
    res.status(500).json({ ok: false, message: "수선완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/ship", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res
        .status(400)
        .json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (
      ![REPAIR_CASE_STATES.ACCEPTED, REPAIR_CASE_STATES.DONE].includes(
        row.case_state,
      )
    ) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "진행중/완료 수선건만 출고완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.DONE, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: "OUTBOUND_ZONE",
      actionType: "SHIP_OUTBOUND_DONE",
      staffName: loginId,
      note: "출고완료 처리",
    });
    await syncBidStatusByLocation(conn, row, "OUTBOUND_ZONE");

    await conn.commit();
    let decisionSheetSync = null;
    if (row.case_state && caseId) {
      const [decisionRows] = await conn.query(
        `
        SELECT decision_type
        FROM wms_repair_cases
        WHERE id = ?
        LIMIT 1
        `,
        [caseId],
      );
      const decisionType = String(decisionRows?.[0]?.decision_type || "")
        .trim()
        .toUpperCase();
      if (["INTERNAL", "EXTERNAL"].includes(decisionType)) {
        decisionSheetSync = await pushRepairCaseToDecisionSheet({
          conn,
          caseId,
          loginId,
          expectedDecisionType: decisionType,
        });
      }
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "ship-case",
    );
    res.json({
      ok: true,
      message: "출고완료 처리되었습니다.",
      result: { caseId, decisionSheetSync, overviewSynced: !!overviewSync.ok },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair ship error:", error);
    res.status(500).json({ ok: false, message: "출고완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/items/:itemId/stage", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const itemId = Number(req.params?.itemId);
    const targetStage = normalizeRepairStage(req.body?.stage);
    if (!itemId) {
      return res
        .status(400)
        .json({ ok: false, message: "item id가 필요합니다." });
    }
    if (!targetStage) {
      return res
        .status(400)
        .json({ ok: false, message: "유효한 단계값이 필요합니다." });
    }

    const stageLabelMap = {
      [REPAIR_STAGE_CODES.DOMESTIC]: "1) 국내도착(분기/견적등록)",
      [REPAIR_STAGE_CODES.EXTERNAL_WAITING]: "2) 시트전송완료 / 견적대기(외부)",
      [REPAIR_STAGE_CODES.READY_TO_SEND]: "3) 견적완료 / 고객전송대기",
      [REPAIR_STAGE_CODES.PROPOSED]: "4) 고객응답대기(PROPOSED)",
      [REPAIR_STAGE_CODES.IN_PROGRESS]: "5) 진행중(내부/외부 수선중)",
      [REPAIR_STAGE_CODES.DONE]: "6) 수선완료존",
    };

    await conn.beginTransaction();
    const [itemRows] = await conn.query(
      `
      SELECT
        id,
        internal_barcode,
        external_barcode,
        current_location_code,
        current_status,
        source_bid_type,
        source_bid_id,
        source_item_id
      FROM wms_items
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const item = itemRows[0];
    if (!item) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }

    const [caseRows] = await conn.query(
      `
      SELECT *
      FROM wms_repair_cases
      WHERE item_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const existingCase = caseRows[0] || null;
    const currentStage = deriveRepairStage(
      existingCase?.case_state,
      existingCase?.decision_type,
      item.current_location_code,
    );
    const loginId = String(req.session?.user?.login_id || "admin");
    const previousDecisionType = String(existingCase?.decision_type || "")
      .trim()
      .toUpperCase();
    const previousVendorName = String(existingCase?.vendor_name || "").trim();
    const previousBarcode = String(
      item.internal_barcode || item.external_barcode || "",
    ).trim();

    let targetCaseState = null;
    let targetDecisionType =
      String(existingCase?.decision_type || "")
        .trim()
        .toUpperCase() || "INTERNAL";
    let targetVendorName = String(existingCase?.vendor_name || "").trim();
    let targetZoneCode = "DOMESTIC_ARRIVAL_ZONE";

    switch (targetStage) {
      case REPAIR_STAGE_CODES.DOMESTIC:
        targetCaseState = existingCase ? REPAIR_CASE_STATES.ARRIVED : null;
        targetDecisionType = "";
        targetVendorName = "";
        targetZoneCode = "DOMESTIC_ARRIVAL_ZONE";
        break;
      case REPAIR_STAGE_CODES.EXTERNAL_WAITING:
        targetCaseState = REPAIR_CASE_STATES.DRAFT;
        targetDecisionType = "EXTERNAL";
        targetZoneCode = "DOMESTIC_ARRIVAL_ZONE";
        break;
      case REPAIR_STAGE_CODES.READY_TO_SEND:
        targetCaseState = REPAIR_CASE_STATES.READY_TO_SEND;
        targetDecisionType =
          targetDecisionType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
        targetZoneCode = "DOMESTIC_ARRIVAL_ZONE";
        break;
      case REPAIR_STAGE_CODES.PROPOSED:
        targetCaseState = REPAIR_CASE_STATES.PROPOSED;
        targetDecisionType =
          targetDecisionType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
        targetZoneCode = "DOMESTIC_ARRIVAL_ZONE";
        break;
      case REPAIR_STAGE_CODES.IN_PROGRESS:
        targetCaseState = REPAIR_CASE_STATES.ACCEPTED;
        targetDecisionType =
          targetDecisionType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
        targetZoneCode =
          targetDecisionType === "EXTERNAL"
            ? "EXTERNAL_REPAIR_ZONE"
            : "INTERNAL_REPAIR_ZONE";
        break;
      case REPAIR_STAGE_CODES.DONE:
        targetCaseState = REPAIR_CASE_STATES.DONE;
        targetDecisionType =
          targetDecisionType === "EXTERNAL"
            ? "EXTERNAL"
            : targetDecisionType === "NONE"
              ? "NONE"
              : "INTERNAL";
        targetZoneCode = "REPAIR_DONE_ZONE";
        break;
      default:
        await conn.rollback();
        return res
          .status(400)
          .json({ ok: false, message: "지원하지 않는 단계입니다." });
    }

    if (targetDecisionType === "EXTERNAL") {
      if (!targetVendorName || targetVendorName === INTERNAL_VENDOR_NAME) {
        targetVendorName = "업체미지정";
      }
    } else if (targetDecisionType === "NONE") {
      targetVendorName = "무수선";
    } else {
      targetVendorName = INTERNAL_VENDOR_NAME;
    }

    if (
      ["EXTERNAL", "INTERNAL"].includes(targetDecisionType) &&
      targetVendorName &&
      targetVendorName !== "업체미지정"
    ) {
      await conn.query(
        `
        INSERT INTO wms_repair_vendors (name, is_active)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE
          is_active = 1,
          updated_at = NOW()
        `,
        [targetVendorName],
      );
    }

    if (targetCaseState) {
      const itemMeta = await fetchRepairItemWithMeta(conn, itemId);
      const proposalText =
        targetDecisionType === "NONE"
          ? null
          : buildProposalText({
              companyName: itemMeta?.company_name || itemMeta?.member_name,
              productTitle: itemMeta?.product_title,
              barcode: itemMeta?.internal_barcode || itemMeta?.external_barcode,
              repairNote:
                String(existingCase?.repair_note || "").trim() ||
                "수선 내용 미입력",
              repairAmount: toAmount(existingCase?.repair_amount),
              repairEta: String(existingCase?.repair_eta || "").trim(),
              vendorName: targetVendorName,
              scheduledAt: itemMeta?.scheduled_at,
            });

      if (!existingCase) {
        const [insertResult] = await conn.query(
          `
          INSERT INTO wms_repair_cases (
            item_id,
            case_state,
            decision_type,
            vendor_name,
            repair_note,
            repair_amount,
            repair_eta,
            proposal_text,
            internal_note,
            proposed_at,
            accepted_at,
            rejected_at,
            completed_at,
            created_by,
            updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          `,
          [
            itemId,
            targetCaseState,
            targetDecisionType,
            targetVendorName || null,
            String(existingCase?.repair_note || "").trim() || null,
            toAmount(existingCase?.repair_amount),
            String(existingCase?.repair_eta || "").trim() || null,
            proposalText,
            String(existingCase?.internal_note || "").trim() || null,
            targetCaseState === REPAIR_CASE_STATES.PROPOSED ? new Date() : null,
            targetCaseState === REPAIR_CASE_STATES.ACCEPTED ? new Date() : null,
            targetCaseState === REPAIR_CASE_STATES.DONE ? new Date() : null,
            loginId,
            loginId,
          ],
        );
        stageCaseId = Number(insertResult.insertId || 0) || null;
      } else {
        if (targetCaseState === REPAIR_CASE_STATES.ARRIVED) {
          await conn.query(
            `
            UPDATE wms_repair_cases
            SET case_state = 'ARRIVED',
                decision_type = NULL,
                vendor_name = NULL,
                repair_note = NULL,
                repair_amount = NULL,
                repair_eta = NULL,
                proposal_text = NULL,
                internal_note = NULL,
                proposed_at = NULL,
                accepted_at = NULL,
                rejected_at = NULL,
                completed_at = NULL,
                external_sent_at = NULL,
                external_synced_at = NULL,
                internal_sent_at = NULL,
                internal_synced_at = NULL,
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?
            `,
            [loginId, existingCase.id],
          );
        } else {
          await conn.query(
            `
            UPDATE wms_repair_cases
            SET case_state = ?,
                decision_type = ?,
                vendor_name = ?,
                proposal_text = ?,
                proposed_at = CASE
                  WHEN ? = 'PROPOSED' THEN NOW()
                  ELSE proposed_at
                END,
                accepted_at = CASE
                  WHEN ? = 'ACCEPTED' THEN NOW()
                  ELSE accepted_at
                END,
                rejected_at = CASE
                  WHEN ? = 'PROPOSED' THEN NULL
                  ELSE rejected_at
                END,
                completed_at = CASE
                  WHEN ? = 'DONE' THEN NOW()
                  ELSE completed_at
                END,
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?
            `,
            [
              targetCaseState,
              targetDecisionType,
              targetVendorName || null,
              proposalText,
              targetCaseState,
              targetCaseState,
              targetCaseState,
              targetCaseState,
              loginId,
              existingCase.id,
            ],
          );
        }
        stageCaseId = Number(existingCase.id);
      }
    }

    const normalizedCurrentZone = normalizeLocationCode(
      item.current_location_code,
    );
    if (
      normalizedCurrentZone !== targetZoneCode ||
      String(item.current_status || "") !== statusByZone(targetZoneCode)
    ) {
      await moveItemToZone({
        conn,
        item,
        toZoneCode: targetZoneCode,
        actionType: "REPAIR_STAGE_MANUAL_CHANGE",
        staffName: loginId,
        note: `수선 단계 수동 변경: ${stageLabelMap[targetStage] || targetStage}`,
      });
    } else {
      await conn.query(
        `
        UPDATE wms_items
        SET current_status = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [statusByZone(targetZoneCode), item.id],
      );
    }

    await syncBidStatusByLocation(conn, item, targetZoneCode);
    await conn.commit();
    let domesticSheetCleanup = null;
    if (
      targetStage === REPAIR_STAGE_CODES.DOMESTIC &&
      ["INTERNAL", "EXTERNAL"].includes(previousDecisionType)
    ) {
      domesticSheetCleanup = await removeRepairCaseFromDecisionSheet({
        conn,
        decisionType: previousDecisionType,
        vendorName: previousVendorName,
        barcode: previousBarcode,
      });
    }
    let decisionSheetSync = null;
    if (
      stageCaseId &&
      targetCaseState &&
      targetStage !== REPAIR_STAGE_CODES.DOMESTIC &&
      ["INTERNAL", "EXTERNAL"].includes(targetDecisionType)
    ) {
      try {
        const pushed = await pushRepairCaseToDecisionSheet({
          conn,
          caseId: stageCaseId,
          loginId,
          expectedDecisionType: targetDecisionType,
        });
        decisionSheetSync = pushed;
      } catch (error) {
        decisionSheetSync = {
          ok: false,
          error: error?.message || "시트 동기화 실패",
        };
      }
    }
    const overviewSync = await syncRepairDailyOverviewSheetSafe(
      conn,
      "stage-change",
    );

    return res.json({
      ok: true,
      message: `수선 단계를 ${stageLabelMap[targetStage] || targetStage}(으)로 변경했습니다.${
        targetStage === REPAIR_STAGE_CODES.DOMESTIC && domesticSheetCleanup
          ? domesticSheetCleanup.ok
            ? ` (시트 행 ${domesticSheetCleanup.removed || 0}건 삭제)`
            : ` (시트 삭제 경고: ${domesticSheetCleanup.error})`
          : ""
      }`,
      result: {
        itemId,
        previousStage: currentStage,
        nextStage: targetStage,
        caseState: targetCaseState,
        decisionType: targetDecisionType,
        zoneCode: targetZoneCode,
        caseId: stageCaseId,
        domesticSheetCleanup,
        decisionSheetSync,
        overviewSynced: !!overviewSync.ok,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair stage change error:", error);
    return res.status(500).json({ ok: false, message: "수선 단계 변경 실패" });
  } finally {
    conn.release();
  }
});

router.get("/export.csv", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        i.internal_barcode,
        i.member_name,
        COALESCE(ci.original_title, ci.title) AS product_title,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.completed_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.internal_sent_at,
        rc.internal_synced_at,
        rc.updated_by,
        rc.updated_at
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN crawled_items ci
        ON BINARY ci.item_id = BINARY i.source_item_id
      ORDER BY rc.updated_at DESC
      LIMIT 5000
      `,
    );

    const headers = [
      "case_id",
      "item_id",
      "internal_barcode",
      "member_name",
      "product_title",
      "case_state",
      "decision_type",
      "vendor_name",
      "repair_note",
      "repair_amount",
      "repair_eta",
      "proposal_text",
      "proposed_at",
      "accepted_at",
      "rejected_at",
      "completed_at",
      "external_sent_at",
      "external_synced_at",
      "internal_sent_at",
      "internal_synced_at",
      "updated_by",
      "updated_at",
    ];

    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((key) => esc(row[key])).join(","));
    }

    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=repair_cases_${Date.now()}.csv`,
    );
    res.send(csv);
  } catch (error) {
    console.error("repair export error:", error);
    res.status(500).json({ ok: false, message: "CSV 내보내기 실패" });
  } finally {
    conn.release();
  }
});

module.exports = router;
