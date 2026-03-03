async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: method === "GET" ? "no-store" : options.cache,
    ...options,
  });
  const contentType = res.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    const text = await res.text();
    const snippet = String(text || "").slice(0, 200);
    throw new Error(
      `API가 JSON이 아닌 응답을 반환했습니다 (${res.status}). 로그인 만료 또는 서버 재시작 필요. 응답 일부: ${snippet}`,
    );
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `API Error: ${res.status}`);
  }
  return data;
}

function el(id) {
  return document.getElementById(id);
}

let auctionRows = [];
let locationOptions = [];
let currentStationZone = null;
let scanInFlight = false;
let boardItems = [];
let selectedBoardZoneCode = "";
let boardPollingInFlight = false;
let boardPollingTimer = null;
let lastBoardRenderSignature = "";
let selectedDomesticPrefix = "";
const BOARD_POLL_INTERVAL_MS = 8000;
const LEADING_ITEM_CODE_RE =
  /^(?:\(\s*\d+(?:[_-]\d+)+\s*\)|\[\s*\d+(?:[_-]\d+)+\s*\]|\d+(?:[_-]\d+)+)\s*/;

function getScanMode() {
  return el("scanMode")?.value || "two_step";
}

function shortZoneCode(zoneCode) {
  const map = {
    DOMESTIC_ARRIVAL_ZONE: "DAZ",
    INTERNAL_REPAIR_ZONE: "IRP",
    EXTERNAL_REPAIR_ZONE: "ERP",
    REPAIR_DONE_ZONE: "RDN",
    HOLD_ZONE: "HLD",
    OUTBOUND_ZONE: "OBD",
  };
  return map[normalizeZoneCode(zoneCode)] || zoneCode;
}

function zoneCodeFromShort(shortCode) {
  const map = {
    DAZ: "DOMESTIC_ARRIVAL_ZONE",
    RTC: "INTERNAL_REPAIR_ZONE",
    AUT: "OUTBOUND_ZONE",
    IRP: "INTERNAL_REPAIR_ZONE",
    ERP: "EXTERNAL_REPAIR_ZONE",
    RDN: "REPAIR_DONE_ZONE",
    HLD: "HOLD_ZONE",
    OBD: "OUTBOUND_ZONE",
  };
  return map[shortCode] || null;
}

function normalizeZoneCode(zoneCode) {
  if (zoneCode === "AUTH_ZONE") return "OUTBOUND_ZONE";
  if (zoneCode === "REPAIR_TEAM_CHECK_ZONE") return "INTERNAL_REPAIR_ZONE";
  return zoneCode;
}

function getLocationNameByCode(code) {
  const normalizedCode = normalizeZoneCode(code);
  const found = (locationOptions || []).find((l) => l.code === normalizedCode);
  if (!found && normalizedCode === "OUTBOUND_ZONE") return "출고존";
  if (!found && normalizedCode === "INTERNAL_REPAIR_ZONE") return "내부수선존";
  return found?.name || code;
}

function getStatusNameByCode(status) {
  const map = {
    NEW: "신규",
    DOMESTIC_ARRIVED: "국내도착",
    DOMESTIC_ARRIVAL_IN_PROGRESS: "국내도착처리중",
    REPAIR_TEAM_CHECK: "내부수선중",
    REPAIR_TEAM_CHECKING: "내부수선중",
    REPAIR_TEAM_CHECK_IN_PROGRESS: "내부수선중",
    REPAIR_IN_PROGRESS: "수선중",
    REPAIR_DONE: "수선완료",
    AUTH_REQUIRED: "출고준비",
    AUTH_IN_PROGRESS: "출고준비",
    HOLD: "보류",
    OUTBOUND_READY: "출고준비",
    READY_TO_SHIP: "출고준비",
    SHIPPED: "출고됨",
    COMPLETED: "완료(운영 제외)",
    CANCELLED: "취소",
  };
  return map[String(status || "").toUpperCase()] || status || "-";
}

function updateStationStatus() {
  const box = el("stationStatus");
  if (!box) return;
  if (!currentStationZone) {
    box.innerHTML = `현재 존: <strong>미설정</strong> (직원모드에서는 먼저 존 코드를 스캔하세요)`;
    return;
  }
  box.innerHTML = `현재 존: <strong>${escapeHtmlText(getLocationNameByCode(
    currentStationZone,
  ))}</strong> (${escapeHtmlText(currentStationZone)})`;
}

function setStationZone(zoneCode) {
  const normalizedZoneCode = normalizeZoneCode(zoneCode);
  currentStationZone = normalizedZoneCode;
  el("toLocationCode").value = normalizedZoneCode;
  updateStationStatus();
}

function parseZoneCode(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const upper = text.toUpperCase().replace(/\s+/g, "");
  const normalized = upper.replace(/[^A-Z0-9:_-]/g, "");
  const knownZones = [
    "DOMESTIC_ARRIVAL_ZONE",
    "REPAIR_TEAM_CHECK_ZONE",
    "AUTH_ZONE",
    "REPAIR_ZONE",
    "INTERNAL_REPAIR_ZONE",
    "EXTERNAL_REPAIR_ZONE",
    "REPAIR_DONE_ZONE",
    "HOLD_ZONE",
    "OUTBOUND_ZONE",
  ];

  for (const z of knownZones) {
    if (normalized.includes(z)) return normalizeZoneCode(z);
  }

  for (const short of ["DAZ", "RTC", "AUT", "IRP", "ERP", "RDN", "HLD", "OBD"]) {
    if (normalized.includes(`Z:${short}`) || normalized === short || normalized.endsWith(short)) {
      const mapped = zoneCodeFromShort(short);
      if (mapped) return normalizeZoneCode(mapped);
    }
  }

  if (normalized.startsWith("ZONE:") || normalized.startsWith("Z:")) {
    const code = normalized.startsWith("Z:")
      ? normalized.slice(2).trim()
      : normalized.slice(5).trim();
    const fromShort = zoneCodeFromShort(code);
    if (fromShort) return normalizeZoneCode(fromShort);
    const normalizedCode = normalizeZoneCode(code);
    return locationOptions.some((l) => l.code === normalizedCode)
      ? normalizedCode
      : null;
  }
  const fromShortOnly = zoneCodeFromShort(normalized);
  if (fromShortOnly) return normalizeZoneCode(fromShortOnly);
  const normalizedCode = normalizeZoneCode(normalized);
  return locationOptions.some((l) => l.code === normalizedCode)
    ? normalizedCode
    : null;
}

function renderModeState() {
  const isTwoStep = getScanMode() === "two_step";
  el("toLocationCode").disabled = isTwoStep;
  const hintText = isTwoStep
    ? "바코드 리더기 모드 활성: 존 코드 스캔 후 물건 바코드를 스캔하세요."
    : "수동모드 활성: 존 선택 후 물건 바코드를 스캔하세요.";
  el("scanResult").textContent = hintText;
  updateStationStatus();
}

function todayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadLocations() {
  const data = await api("/api/wms/locations");
  locationOptions = data.locations || [];
  const select = el("toLocationCode");
  select.innerHTML = locationOptions
    .map((loc) => `<option value="${loc.code}">${loc.name}</option>`)
    .join("");
  if (!currentStationZone && locationOptions.length > 0) {
    currentStationZone = locationOptions[0].code;
  }
  renderModeState();
}

function renderBoard(board) {
  el("boardGrid").innerHTML = board
    .map(
      (z) => `
      <div class="zone zone-clickable ${selectedBoardZoneCode === z.code ? "zone-active" : ""}" data-zone-code="${z.code}">
        <div class="name">${z.name}</div>
        <div class="count">${z.count}</div>
      </div>
    `,
    )
    .join("");
  Array.from(document.querySelectorAll(".zone-clickable")).forEach((node) => {
    node.addEventListener("click", () => {
      const code = node.dataset.zoneCode || "";
      selectedBoardZoneCode = selectedBoardZoneCode === code ? "" : code;
      renderBoard(board);
      renderItems(getFilteredBoardItems());
      updateBoardFilterHint();
    });
  });
}

function formatDateTimeText(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function formatYmd(dateLike) {
  const dt = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(base, offset) {
  const dt = new Date(base);
  dt.setDate(dt.getDate() + offset);
  return dt;
}

function extractBarcodePrefix(barcode) {
  const raw = String(barcode || "").trim();
  if (!raw) return "";
  const noCb = raw.toUpperCase().startsWith("CB-") ? raw.slice(3) : raw;
  const parts = noCb.split("-").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return parts[0] || "";
}

function getRecentDomesticItems() {
  return (boardItems || []).filter(
    (item) => normalizeZoneCode(item.current_location_code) === "DOMESTIC_ARRIVAL_ZONE",
  );
}

function getFilteredRecentDomesticItems() {
  const base = getRecentDomesticItems();
  if (!selectedDomesticPrefix) return base;
  return base.filter(
    (item) =>
      extractBarcodePrefix(item.internal_barcode || item.external_barcode) ===
      selectedDomesticPrefix,
  );
}

function renderDomesticPrefixChips(items) {
  const node = el("domesticPrefixChips");
  if (!node) return;
  const countMap = new Map();
  items.forEach((item) => {
    const prefix = extractBarcodePrefix(item.internal_barcode || item.external_barcode);
    if (!prefix) return;
    countMap.set(prefix, (countMap.get(prefix) || 0) + 1);
  });
  const chips = Array.from(countMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([prefix, count]) => ({ prefix, count }));

  if (!chips.length) {
    node.innerHTML = "";
    selectedDomesticPrefix = "";
    return;
  }
  if (
    selectedDomesticPrefix &&
    !chips.some((chip) => chip.prefix === selectedDomesticPrefix)
  ) {
    selectedDomesticPrefix = "";
  }

  node.innerHTML = `
    <button
      type="button"
      class="domestic-prefix-chip ${selectedDomesticPrefix ? "" : "active"}"
      data-prefix=""
    >
      전체
    </button>
    ${chips
      .map(
        (chip) => `
      <button
        type="button"
        class="domestic-prefix-chip ${selectedDomesticPrefix === chip.prefix ? "active" : ""}"
        data-prefix="${escapeHtmlText(chip.prefix)}"
      >
        ${escapeHtmlText(chip.prefix)}- (${chip.count})
      </button>
    `,
      )
      .join("")}
  `;

  node.querySelectorAll(".domestic-prefix-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDomesticPrefix = btn.dataset.prefix || "";
      renderRecentDomesticSection();
    });
  });
}

function renderRecentDomesticList(items) {
  const node = el("recentDomesticList");
  if (!node) return;
  if (!items.length) {
    node.innerHTML = '<div class="recent-domestic-empty">해당 조건의 국내도착 물건이 없습니다.</div>';
    return;
  }
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.domestic_arrived_at || b.updated_at || 0).getTime() -
      new Date(a.domestic_arrived_at || a.updated_at || 0).getTime(),
  );
  node.innerHTML = sorted
    .map((item) => {
      const barcode = item.internal_barcode || item.external_barcode || "-";
      const lotNo = item.product_item_no || "-";
      return `
      <div class="recent-domestic-item">
        <img
          class="recent-domestic-photo"
          src="${escapeHtmlText(item.product_image || "/images/no-image.png")}"
          alt="상품 사진"
          loading="lazy"
        />
        <div class="recent-domestic-meta">
          <div class="recent-domestic-title">${escapeHtmlText(item.product_title || "-")}</div>
          <div class="recent-domestic-line"><strong>내부바코드:</strong> ${escapeHtmlText(barcode)}</div>
          <div class="recent-domestic-line"><strong>품번:</strong> ${escapeHtmlText(lotNo)}</div>
        </div>
      </div>
      `;
    })
    .join("");
}

function renderRecentDomesticSection() {
  const baseItems = getRecentDomesticItems();
  renderDomesticPrefixChips(baseItems);
  renderRecentDomesticList(getFilteredRecentDomesticItems());
}

function formatElapsedHours(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  const diffMs = Date.now() - dt.getTime();
  if (diffMs < 0) return "0분";
  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return `${mins}분`;
}

function getBidTypeLabel(bidType) {
  const normalized = String(bidType || "").toLowerCase();
  if (normalized === "live") return "현장경매";
  if (normalized === "direct") return "직접경매";
  return "-";
}

function getBidTypeBadgeClass(bidType) {
  const normalized = String(bidType || "").toLowerCase();
  if (normalized === "live") return "is-live";
  if (normalized === "direct") return "is-direct";
  return "";
}

function renderItems(items) {
  const body = el("itemsBody");
  body.innerHTML = items
    .map(
      (i) => `
      <tr>
        <td>${i.id}</td>
        <td class="photo-cell">
          ${
            i.product_image
              ? `<img class="wms-item-thumb" src="${escapeHtmlText(i.product_image)}" alt="상품 이미지" loading="lazy" />`
              : '<span class="thumb-empty">-</span>'
          }
        </td>
        <td>
          <span class="bid-type-badge ${getBidTypeBadgeClass(i.source_bid_type)}">
            ${escapeHtmlText(getBidTypeLabel(i.source_bid_type))}
          </span>
        </td>
        <td>${escapeHtmlText(i.internal_barcode || i.external_barcode || "-")}</td>
        <td>${escapeHtmlText(i.product_title || i.source_item_id || "-")}</td>
        <td>${escapeHtmlText(i.company_name || i.member_name || "-")}</td>
        <td>${escapeHtmlText(getStatusNameByCode(i.current_status))}</td>
        <td>${escapeHtmlText(getLocationNameByCode(i.current_location_code) || i.current_location_code || "-")}</td>
        <td>${formatElapsedHours(i.domestic_arrived_at)}</td>
        <td>${formatElapsedHours(i.last_scan_at || i.updated_at)}</td>
        <td>${formatDateTimeText(i.updated_at)}</td>
      </tr>
    `,
    )
    .join("");
}

function getFilteredBoardItems() {
  if (!selectedBoardZoneCode) return boardItems;
  return (boardItems || []).filter(
    (item) => item.current_location_code === selectedBoardZoneCode,
  );
}

function updateBoardFilterHint() {
  const hintNode = el("boardFilterHint");
  if (!hintNode) return;
  if (!selectedBoardZoneCode) {
    hintNode.textContent = "숫자를 클릭하면 해당 존 물건만 아래 목록에 표시됩니다.";
    return;
  }
  hintNode.textContent = `필터 적용됨: ${getLocationNameByCode(selectedBoardZoneCode)} (${selectedBoardZoneCode})`;
}

async function loadBoard() {
  const data = await api(`/api/wms/board?_ts=${Date.now()}`);
  const nextBoardItems = data.items || [];
  const board = data.board || [];
  const nextSignature = JSON.stringify({
    board: board.map((z) => [z.code, Number(z.count || 0)]),
    items: nextBoardItems.map((i) => [
      i.id,
      i.current_location_code,
      i.current_status,
      i.internal_barcode || i.external_barcode || "",
      i.updated_at || "",
      i.last_scan_at || "",
      i.domestic_arrived_at || "",
    ]),
  });

  boardItems = nextBoardItems;
  if (
    selectedBoardZoneCode &&
    !board.some((z) => z.code === selectedBoardZoneCode)
  ) {
    selectedBoardZoneCode = "";
  }

  if (nextSignature === lastBoardRenderSignature) {
    return;
  }
  lastBoardRenderSignature = nextSignature;

  renderBoard(board);
  renderItems(getFilteredBoardItems());
  updateBoardFilterHint();
  renderRecentDomesticSection();
}

async function refreshBoardSafely() {
  if (document.hidden) return;
  if (boardPollingInFlight) return;
  boardPollingInFlight = true;
  try {
    await loadBoard();
  } catch (e) {
    // keep UI stable even if one polling call fails
    console.warn("WMS board polling warning:", e.message);
  } finally {
    boardPollingInFlight = false;
  }
}

function startBoardPolling() {
  if (boardPollingTimer) return;
  boardPollingTimer = setInterval(refreshBoardSafely, BOARD_POLL_INTERVAL_MS);
}

function renderAuctionRows(items) {
  auctionRows = items || [];
  const body = el("auctionItemsBody");
  body.innerHTML = auctionRows
    .map(
      (r, idx) => `
      <tr>
        <td><input type="checkbox" class="auction-row-check" data-idx="${idx}" /></td>
        <td>${r.bid_type}</td>
        <td>${r.bid_id}</td>
        <td>${r.auc_num || "-"}</td>
        <td>${r.item_id || "-"}</td>
        <td>${r.original_title || "-"}</td>
        <td>${r.company_name || "-"}</td>
        <td>${r.status || "-"}</td>
        <td>${r.internal_barcode || "-"}</td>
      </tr>
    `,
    )
    .join("");
}

function getSelectedAuctionRows() {
  const checks = Array.from(document.querySelectorAll(".auction-row-check:checked"));
  return checks
    .map((c) => Number(c.dataset.idx))
    .filter((n) => Number.isInteger(n) && auctionRows[n])
    .map((n) => auctionRows[n]);
}

async function searchCompletedItems() {
  const scheduledDate = el("searchScheduledDate").value;
  const aucNum = el("searchAucNum").value.trim();
  if (!scheduledDate) {
    alert("예정일시(날짜)를 선택하세요.");
    return;
  }

  const qs = new URLSearchParams({ scheduledDate });
  if (aucNum) qs.set("aucNum", aucNum);

  const data = await api(`/api/wms/auction-completed?${qs.toString()}`);
  renderAuctionRows(data.items || []);
}

function escapeHtmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeLabelTitle(title) {
  let value = String(title || "").trim();
  while (true) {
    const next = value.replace(LEADING_ITEM_CODE_RE, "").trim();
    if (next === value) break;
    value = next;
  }
  return value || "-";
}

function printLabels(labels) {
  if (!labels.length) {
    alert("출력할 라벨이 없습니다.");
    return;
  }

  const html = labels
    .map(
      (l, idx) => {
        const customerName = l.customer_name || l.company_name || "-";
        const title = sanitizeLabelTitle(l.original_title);
        const hasAppraisal =
          Boolean(l.has_appraisal) ||
          Number(l.request_type) === 1 ||
          Number(l.request_type) === 3;
        return `
      <div class="label-page">
        <div class="label">
          <div class="code">${escapeHtmlText(l.internal_barcode)}</div>
          <div class="request">고객명: ${escapeHtmlText(customerName)}${hasAppraisal ? "*" : ""}</div>
          <div class="title">${escapeHtmlText(title)}</div>
          <div class="barcode-wrap">
            <svg class="barcode" id="item-barcode-${idx}" data-value="${escapeHtmlText(
              l.internal_barcode,
            )}"></svg>
          </div>
        </div>
      </div>
    `;
      },
    )
    .join("");

  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) {
    alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.");
    return;
  }

  win.document.write(`
    <html>
      <head>
        <title>WMS 라벨 출력</title>
        <style>
          @page { size: 50mm 30mm; margin: 0; }
          html, body {
            margin: 0;
            padding: 0;
            width: 50mm;
            min-width: 50mm;
            font-family: Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .sheet {
            margin: 0;
            width: 50mm;
          }
          .label-page {
            width: 50mm;
            height: 30mm;
            display: block;
            overflow: hidden;
            position: relative;
            page-break-after: always;
            break-after: page;
          }
          .label-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .label {
            width: 49mm;
            height: 29mm;
            margin: 0.5mm;
            border: 1px solid #000;
            padding: 0.35mm 0.35mm;
            box-sizing: border-box;
            background: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .code {
            font-size: 3.6mm;
            line-height: 0.98;
            font-weight: 900;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: clip;
            text-align: left;
            margin-bottom: 0.25mm;
          }
          .request {
            font-size: 2.2mm;
            line-height: 1;
            font-weight: 700;
            margin-bottom: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .title {
            font-size: 2.2mm;
            line-height: 1;
            font-weight: 700;
            margin-bottom: 0.2mm;
            height: 2.5mm;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .barcode-wrap {
            width: 100%;
            border: 0;
            padding: 0;
            background: #fff;
            box-sizing: border-box;
            margin-top: 0.1mm;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            flex: 1;
            min-height: 0;
          }
          .barcode {
            width: 94%;
            max-width: 46.2mm;
            height: 15.8mm;
            display: block;
            margin: 0 auto;
          }
          @media print {
            body { margin: 0; }
          }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      </head>
      <body>
        <div class="sheet">${html}</div>
        <script>
          (function waitRenderThenPrint() {
            const startedAt = Date.now();
            function run() {
              if (typeof JsBarcode !== "function") {
                if (Date.now() - startedAt < 5000) return setTimeout(run, 80);
                window.focus();
                window.print();
                return;
              }
              const nodes = document.querySelectorAll(".barcode");
              nodes.forEach((node) => {
                const value = node.getAttribute("data-value") || "";
                if (!value) return;
                JsBarcode(node, value, {
                  format: "CODE128",
                  lineColor: "#000",
                  width: 1.35,
                  height: 58,
                  displayValue: false,
                  textMargin: 0,
                  margin: 0,
                });
              });
              setTimeout(() => {
                window.focus();
                window.print();
              }, 150);
            }
            if (document.readyState === "loading") {
              document.addEventListener("DOMContentLoaded", run);
            } else {
              run();
            }
          })();
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

async function generateAndPrintLabels() {
  const selected = getSelectedAuctionRows();
  if (!selected.length) {
    alert("선택된 항목이 없습니다.");
    return;
  }

  const data = await api("/api/wms/auction-labels", {
    method: "POST",
    body: JSON.stringify({ items: selected }),
  });

  const labels = data.labels || [];
  if (!labels.length) {
    alert("생성된 라벨이 없습니다.");
    return;
  }

  await loadBoard();
  await searchCompletedItems();
  printLabels(labels);
}

async function printZoneBarcodes() {
  const data = await api("/api/wms/locations");
  const locations = data.locations || [];
  if (!locations.length) {
    alert("출력할 존이 없습니다.");
    return;
  }

  const labelsPerPage = 4;
  let html = "";
  for (let i = 0; i < locations.length; i += labelsPerPage) {
    const pageItems = locations.slice(i, i + labelsPerPage);
    const pageHtml = pageItems
      .map(
        (loc, innerIdx) => `
        <div class="label">
          <div class="name">${escapeHtmlText(loc.name)}</div>
          <div class="meta">${escapeHtmlText(loc.code)}</div>
          <div class="barcode-wrap">
            <svg class="barcode" id="zone-barcode-${i + innerIdx}" data-value="${escapeHtmlText(
              shortZoneCode(loc.code),
            )}"></svg>
          </div>
          <div class="raw">스캔값: ${escapeHtmlText(shortZoneCode(loc.code))}</div>
          <div class="raw">호환: Z:${escapeHtmlText(shortZoneCode(loc.code))}</div>
        </div>
      `,
      )
      .join("");
    html += `
      <div class="a4-page">
        <div class="grid">${pageHtml}</div>
      </div>
    `;
  }

  const win = window.open("", "_blank", "width=1100,height=900");
  if (!win) {
    alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.");
    return;
  }

  win.document.write(`
    <html>
      <head>
        <title>WMS 존 바코드 출력</title>
        <style>
          @page { size: A4; margin: 0; }
          body { font-family: Arial, sans-serif; margin: 0; }
          .sheet { margin: 0; }
          .a4-page {
            width: 210mm;
            height: 297mm;
            box-sizing: border-box;
            padding: 12mm 10mm;
            page-break-after: always;
          }
          .a4-page:last-child { page-break-after: auto; }
          .grid {
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            gap: 8mm;
          }
          .label {
            width: 100%;
            border: 1px solid #111;
            padding: 8mm 6mm;
            text-align: center;
            background: #fff;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .name { font-size: 34px; font-weight: 800; margin-bottom: 8px; line-height: 1.1; }
          .meta { font-size: 16px; margin-bottom: 10px; color: #333; font-weight: 600; }
          .barcode-wrap { border: 1px solid #ddd; padding: 6px; margin-bottom: 8px; }
          .barcode { width: 100%; height: 115px; }
          .raw { font-size: 14px; color: #666; word-break: break-all; }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      </head>
      <body>
        <div class="sheet">${html}</div>
        <script>
          (function waitRenderThenPrint() {
            const startedAt = Date.now();
            function run() {
              if (typeof JsBarcode !== "function") {
                if (Date.now() - startedAt < 5000) return setTimeout(run, 80);
                window.focus();
                window.print();
                return;
              }
              const nodes = document.querySelectorAll(".barcode");
              nodes.forEach((node) => {
                const value = node.getAttribute("data-value") || "";
                if (!value) return;
                JsBarcode(node, value, {
                  format: "CODE128",
                  lineColor: "#000",
                  width: 2.6,
                  height: 92,
                  displayValue: true,
                  fontSize: 20,
                  margin: 0,
                });
              });
              setTimeout(() => {
                window.focus();
                window.print();
              }, 150);
            }
            if (document.readyState === "loading") {
              document.addEventListener("DOMContentLoaded", run);
            } else {
              run();
            }
          })();
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

async function scanItem() {
  if (scanInFlight) return;

  const mode = getScanMode();
  const barcodeInput = el("scanBarcode").value.trim();
  if (!barcodeInput) {
    alert("바코드를 입력/스캔하세요.");
    return;
  }

  scanInFlight = true;
  try {
  if (mode === "two_step") {
    const zoneCode = parseZoneCode(barcodeInput);
    if (zoneCode) {
      setStationZone(zoneCode);
      el("scanBarcode").value = "";
      el("scanResult").textContent = `현재 존 설정 완료: ${getLocationNameByCode(zoneCode)}`;
      el("scanBarcode").focus();
      return;
    }
    // 존코드 스캔이 깨져 들어온 경우(한글 IME/잘못된 입력) 물건 스캔으로 오인되지 않게 막는다.
    if (barcodeInput.includes(":")) {
      el("scanBarcode").value = "";
      el("scanResult").textContent =
        "존 코드 인식 실패: 영문(ABC) 입력 상태로 존 바코드를 다시 스캔하세요.";
      alert("존 코드 인식 실패: 영문(ABC) 상태에서 다시 스캔하세요.");
      el("scanBarcode").focus();
      return;
    }
    if (!currentStationZone) {
      alert("먼저 존 코드를 스캔해 현재 존을 설정하세요.");
      return;
    }
  }

  const targetLocationCode =
    mode === "two_step" ? currentStationZone : el("toLocationCode").value;

  const payload = {
    barcode: barcodeInput,
    toLocationCode: targetLocationCode,
    staffName: el("staffName").value.trim() || null,
    note: el("scanNote").value.trim() || null,
  };

  const data = await api("/api/wms/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const zoneName = getLocationNameByCode(data.item.current_location_code);
  const statusName = getStatusNameByCode(data.item.current_status);
  el("scanResult").textContent = `처리 완료: ${data.item.internal_barcode || data.item.external_barcode} -> ${zoneName} (${statusName})`;
  el("scanBarcode").value = "";
  el("scanBarcode").focus();
  await loadBoard();
  } finally {
    scanInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  renderRecentDomesticSection();
  if (el("searchScheduledDate")) {
    el("searchScheduledDate").value = todayYmd();
  }

  el("btnScan")?.addEventListener("click", async () => {
    try {
      await scanItem();
    } catch (e) {
      alert(e.message);
    }
  });

  el("scanMode")?.addEventListener("change", () => {
    renderModeState();
  });

  el("btnClearStation")?.addEventListener("click", () => {
    currentStationZone = null;
    updateStationStatus();
    el("scanResult").textContent = "현재 존을 초기화했습니다. 존 코드를 다시 스캔하세요.";
    el("scanBarcode").focus();
  });

  el("btnPrintZoneBarcodes")?.addEventListener("click", async () => {
    try {
      await printZoneBarcodes();
    } catch (e) {
      alert(e.message);
    }
  });

  el("btnClearBoardFilter")?.addEventListener("click", () => {
    selectedBoardZoneCode = "";
    renderItems(getFilteredBoardItems());
    updateBoardFilterHint();
    loadBoard().catch(() => {});
  });

  el("scanBarcode")?.addEventListener("keydown", async (evt) => {
    if (evt.key !== "Enter") return;
    evt.preventDefault();
    try {
      await scanItem();
    } catch (e) {
      alert(e.message);
    }
  });

  // 일부 리더기는 엔터를 안 붙여서 keydown 트리거가 안 됨.
  // 직원모드에서 존 코드가 입력되면 즉시 현재 존으로 반영.
  el("scanBarcode")?.addEventListener("input", () => {
    if (getScanMode() !== "two_step") return;
    const raw = el("scanBarcode").value || "";
    const zoneCode = parseZoneCode(raw);
    if (!zoneCode) return;
    setStationZone(zoneCode);
    el("scanBarcode").value = "";
    el("scanResult").textContent = `현재 존 설정 완료: ${getLocationNameByCode(zoneCode)}`;
  });

  el("btnSearchCompleted")?.addEventListener("click", async () => {
    try {
      await searchCompletedItems();
    } catch (e) {
      alert(e.message);
    }
  });

  el("btnGenerateLabels")?.addEventListener("click", async () => {
    try {
      await generateAndPrintLabels();
    } catch (e) {
      alert(e.message);
    }
  });

  el("selectAllAuctionRows")?.addEventListener("change", (evt) => {
    const checked = evt.target.checked;
    document.querySelectorAll(".auction-row-check").forEach((c) => {
      c.checked = checked;
    });
  });

  startBoardPolling();
  window.addEventListener("focus", () => {
    refreshBoardSafely().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshBoardSafely().catch(() => {});
    }
  });

  try {
    await loadLocations();
    await loadBoard();
    await searchCompletedItems();
    renderModeState();
  } catch (e) {
    console.warn(e.message);
    el("scanResult").textContent = `초기 로딩 경고: ${e.message}`;
  }
});
