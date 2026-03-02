// public/js/admin/instant-purchases.js

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const INSTANT_STATUS_LABELS = {
  pending: "대기",
  completed: "완료",
  cancelled: "취소",
};

const INSTANT_SHIPPING_LABELS = {
  pending: "대기",
  domestic_arrived: "국내도착",
  processing: "작업중",
  shipped: "출고됨",
  completed: "완료",
};

const INSTANT_SHIPPING_STATUSES = new Set([
  "pending",
  "domestic_arrived",
  "processing",
  "shipped",
  "completed",
]);

const INSTANT_WORKFLOW_STATUSES = [
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
];

function getInstantWorkflowStatusOptionsHtml(currentStatus) {
  return INSTANT_WORKFLOW_STATUSES.map(
    (status) =>
      `<option value="${status}"${
        status === currentStatus ? " selected" : ""
      }>${getInstantStatusLabel(status)}</option>`,
  ).join("");
}

const INSTANT_ZONE_SUMMARY_VISIBLE_STATUSES = new Set([
  "domestic_arrived",
  "processing",
]);

function getInstantStatusLabel(status) {
  return (
    INSTANT_STATUS_LABELS[status] || INSTANT_SHIPPING_LABELS[status] || status
  );
}

function getInstantShippingLabel(shippingStatus) {
  return INSTANT_SHIPPING_LABELS[shippingStatus] || shippingStatus || "-";
}

function getInstantZoneDisplayNameByCode(code) {
  const map = {
    DOMESTIC_ARRIVAL_ZONE: "국내도착존",
    REPAIR_TEAM_CHECK_ZONE: "수선팀검수중존",
    INTERNAL_REPAIR_ZONE: "내부수선존",
    EXTERNAL_REPAIR_ZONE: "외부수선존",
    REPAIR_DONE_ZONE: "수선완료존",
    AUTH_ZONE: "감정출력존",
    HOLD_ZONE: "HOLD존",
    OUTBOUND_ZONE: "출고존",
    REPAIR_ZONE: "수선존",
    INSPECT_ZONE: "검수존",
    SHIPPED_ZONE: "출고존",
  };
  return map[code] || "";
}

function getInstantProcessingStatusLabel(item) {
  const zoneName = getInstantZoneDisplayNameByCode(item.wms_location_code);
  if (zoneName) return `작업중(${zoneName})`;
  return "작업중";
}

function renderProcessingZoneSummary(items) {
  const wrap = document.getElementById("processingZoneSummary");
  const grid = document.getElementById("processingZoneGrid");
  const title = wrap?.querySelector(".title");
  if (!wrap || !grid) return;

  if (!INSTANT_ZONE_SUMMARY_VISIBLE_STATUSES.has(currentStatus)) {
    currentProcessingZoneCode = "";
    wrap.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  if (title) {
    const label = currentStatus ? getInstantStatusLabel(currentStatus) : "전체";
    title.textContent = `${label} 존별 현황`;
  }

  const zoneCountMap = (items || []).reduce((acc, item) => {
    const code = item.wms_location_code || "UNKNOWN_ZONE";
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  const entries = Object.entries(zoneCountMap).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    wrap.style.display = "block";
    grid.innerHTML = `<div class="processing-zone-item"><div class="name">존 데이터 없음</div><div class="count">0</div></div>`;
    return;
  }

  const totalCount = entries.reduce((sum, [, count]) => sum + count, 0);
  const allCard = `<div class="processing-zone-item ${
    !currentProcessingZoneCode ? "is-active" : ""
  }" data-zone-code=""><div class="name">전체</div><div class="count">${totalCount}</div></div>`;
  const zoneCards = entries
    .map(([code, count]) => {
      const zoneName =
        code === "UNKNOWN_ZONE"
          ? "존 미지정"
          : getInstantZoneDisplayNameByCode(code) || code;
      return `<div class="processing-zone-item ${
        currentProcessingZoneCode === code ? "is-active" : ""
      }" data-zone-code="${code}"><div class="name">${zoneName}</div><div class="count">${count}</div></div>`;
    })
    .join("");
  grid.innerHTML = allCard + zoneCards;
  grid
    .querySelectorAll(".processing-zone-item[data-zone-code]")
    .forEach((el) => {
      el.addEventListener("click", () => {
        currentProcessingZoneCode = el.dataset.zoneCode || "";
        updateURLState();
        renderProcessingZoneSummary(currentPurchasesData);
        renderInstantPurchasesTable(filterByZone(currentPurchasesData));
      });
    });
  wrap.style.display = "block";
}

// --- State ---
let currentStatus = "";
let currentPage = 1;
let itemsPerPage = 100;
let totalPages = 1;
let currentSortBy = "created_at";
let currentSortOrder = "desc";
let currentProcessingZoneCode = "";
let fromDate = "";
let toDate = "";
let currentSearch = "";
let currentPurchasesData = [];
let instantDetailImages = [];
let instantDetailImageIndex = 0;
let searchTimeout = null;

// --- Realtime ---
const InstantPurchasesRealtimeManager = (function () {
  let socket = null;
  function initializeSocket() {
    if (typeof io === "undefined") return null;
    socket = io({ reconnectionAttempts: 5, timeout: 10000 });
    socket.on("connect_error", () => setupFallbackPolling());
    socket.on("data-updated", (data) => {
      const visible = currentPurchasesData.map((p) => p.item_id);
      if (data.itemIds.some((id) => visible.includes(id))) {
        debouncedLoad();
      }
    });
    return socket;
  }
  function setupFallbackPolling() {
    setInterval(() => debouncedLoad(), 30000);
  }
  return { initializeSocket };
})();

let loadDebounceTimer = null;
function debouncedLoad() {
  if (loadDebounceTimer) clearTimeout(loadDebounceTimer);
  loadDebounceTimer = setTimeout(() => loadInstantPurchases(), 300);
}

// --- URL State ---
const urlStateManager = window.URLStateManager;
const defaultState = {
  page: 1,
  sort: "created_at",
  order: "desc",
  search: "",
  status: "",
  zone: "",
};

function updateURLState() {
  if (!urlStateManager) return;
  const state = {};
  if (currentPage !== defaultState.page) state.page = currentPage;
  if (currentSortBy !== defaultState.sort) state.sort = currentSortBy;
  if (currentSortOrder !== defaultState.order) state.order = currentSortOrder;
  if (currentSearch) state.search = currentSearch;
  if (currentStatus) state.status = currentStatus;
  if (currentProcessingZoneCode) state.zone = currentProcessingZoneCode;
  if (fromDate) state.fromDate = fromDate;
  if (toDate) state.toDate = toDate;
  if (itemsPerPage !== 100) state.pageSize = itemsPerPage;
  urlStateManager.updateURL(state);
}

function restoreURLState() {
  if (!urlStateManager) return;
  const params = urlStateManager.getURLParams();
  currentPage = parseInt(params.get("page")) || defaultState.page;
  currentSortBy = params.get("sort") || defaultState.sort;
  currentSortOrder = params.get("order") || defaultState.order;
  currentSearch = params.get("search") || defaultState.search;
  currentStatus = params.get("status") || defaultState.status;
  currentProcessingZoneCode = params.get("zone") || "";
  fromDate = params.get("fromDate") || "";
  toDate = params.get("toDate") || "";
  itemsPerPage = parseInt(params.get("pageSize")) || 100;
}

// --- Filter ---
async function filterByStatus(status) {
  currentStatus = status;
  currentPage = 1;
  updateURLState();
  await loadInstantPurchases();
}

function filterByZone(items) {
  if (!currentProcessingZoneCode) return items;
  return items.filter(
    (i) =>
      (i.wms_location_code || "UNKNOWN_ZONE") === currentProcessingZoneCode,
  );
}

function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  updateURLState();
  loadInstantPurchases();
}

// --- Load Data ---
async function loadInstantPurchases() {
  try {
    const params = new URLSearchParams();
    params.set("page", currentPage);
    params.set("limit", itemsPerPage);
    params.set("sortBy", currentSortBy);
    params.set("sortOrder", currentSortOrder);
    if (currentStatus) params.set("status", currentStatus);
    if (currentSearch) params.set("search", currentSearch);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate + " 23:59:59");

    const response = await fetchAPI(`/instant-purchases?${params.toString()}`);

    currentPurchasesData = response.data || [];
    totalPages = response.totalPages || 1;
    currentPage = response.currentPage || 1;

    renderProcessingZoneSummary(currentPurchasesData);
    renderInstantPurchasesTable(filterByZone(currentPurchasesData));
    renderPagination();

    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.status === currentStatus);
    });
  } catch (error) {
    console.error("바로 구매 데이터 로드 실패:", error);
    const tbody = document.getElementById("instantPurchasesTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center">데이터 로드 실패: ${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

// --- Render Table ---
function renderInstantPurchasesTable(items) {
  const tbody = document.getElementById("instantPurchasesTableBody");
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="text-center">데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map((item) => {
      const brand = escapeHtml(item.brand || "-");
      const title = escapeHtml(
        item.title || item.original_title || "제목 없음",
      );
      const truncTitle =
        title.length > 30 ? title.substring(0, 30) + "..." : title;
      const image = item.image || "/images/no-image.png";
      const companyName = escapeHtml(item.company_name || "-");
      const loginId = escapeHtml(item.login_id || "-");
      const purchasePrice = Number(item.purchase_price || 0);
      const purchasePriceFormatted = purchasePrice
        ? cleanNumberFormat(purchasePrice) + "¥"
        : "-";

      let krwPrice = "";
      if (purchasePrice && item.auc_num && item.category) {
        try {
          krwPrice =
            cleanNumberFormat(
              calculateTotalPrice(purchasePrice, item.auc_num, item.category),
            ) + "₩";
        } catch (e) {
          /* ignore */
        }
      }

      const createdAt = item.created_at
        ? new Date(item.created_at).toLocaleString("ko-KR")
        : "-";
      const updatedAt = item.updated_at
        ? new Date(item.updated_at).toLocaleString("ko-KR")
        : "-";

      const status = item.status || "pending";
      const shippingStatus = item.shipping_status || "pending";

      let statusDisplay = "";
      let statusClass = "";
      if (status === "completed") {
        const ss = shippingStatus || "pending";
        if (ss === "domestic_arrived") {
          statusDisplay = "국내도착";
          statusClass = "badge-warning";
        } else if (ss === "processing") {
          statusDisplay = getInstantProcessingStatusLabel(item);
          statusClass = "badge-dark";
        } else if (ss === "shipped") {
          statusDisplay = "출고됨";
          statusClass = "badge-primary";
        } else {
          statusDisplay = "완료";
          statusClass = "badge-success";
        }
      } else if (status === "cancelled") {
        statusDisplay = "취소";
        statusClass = "badge-secondary";
      } else {
        statusDisplay = "대기";
        statusClass = "badge-info";
      }

      let shippingDisplay = getInstantShippingLabel(shippingStatus);

      // 감정서
      const hasAppr = item.appr_id
        ? '<span class="badge badge-success">발급됨</span>'
        : '<span class="badge badge-secondary">미발급</span>';

      // 수선
      let repairHtml = "-";
      if (
        status === "completed" ||
        shippingStatus === "domestic_arrived" ||
        shippingStatus === "processing" ||
        shippingStatus === "shipped"
      ) {
        if (item.repair_requested_at) {
          repairHtml = `<button class="btn btn-sm btn-success"
            data-bid-id="${item.id}"
            data-bid-type="instant"
            data-repair-details="${escapeHtml(item.repair_details || "")}"
            data-repair-fee="${item.repair_fee || 0}"
            data-repair-requested-at="${item.repair_requested_at || ""}"
            onclick="openRepairModalFromButton(this)">접수됨</button>`;
        } else {
          repairHtml = `<button class="btn btn-sm btn-secondary" onclick="openRepairModal(${item.id}, 'instant')">수선 접수</button>`;
        }
      }

      // 작업 버튼
      let actionsHtml = '<div class="action-buttons-row">';
      if (status === "completed") {
        actionsHtml += `
          <select class="form-control form-control-sm status-target-select" id="instantStatusTarget-${item.id}" data-current-status="${shippingStatus || "completed"}">
            ${getInstantWorkflowStatusOptionsHtml(shippingStatus || "completed")}
          </select>
          <button class="btn btn-info btn-sm" onclick="moveInstantPurchaseStatus(${item.id})">상태 변경</button>`;
      }
      if (status !== "cancelled") {
        actionsHtml += `<button class="btn btn-sm btn-danger" onclick="openCancelModal(${item.id})">취소</button> `;
      }
      actionsHtml += `<button class="btn btn-sm btn-ghost" onclick="openDetailModalById(${item.id})">상세</button>`;
      actionsHtml += "</div>";

      // 상품 정보 - 일관된 item-info 레이아웃
      const scheduledDate = item.completed_at
        ? new Date(item.completed_at).toLocaleString("ko-KR")
        : item.created_at
          ? new Date(item.created_at).toLocaleString("ko-KR")
          : "-";

      const itemUrl = `https://bid.brand-auc.com/items/detail?uketsukeBng=${item.item_id}`;

      return `<tr data-purchase-id="${item.id}">
        <td><input type="checkbox" class="bid-checkbox" value="${item.id}" data-status="${status}" data-shipping-status="${shippingStatus}" /></td>
        <td>${item.id}</td>
        <td>
          <div class="item-info">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" class="item-thumbnail" />
            <div class="item-details">
              <div>
                <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="item-id-link"
                  onclick="return openInstantProductDetail(event, this);"
                  data-item-id="${escapeHtml(item.item_id || "")}"
                  data-auc-num="${escapeHtml(String(item.auc_num || 2))}"
                  data-image="${escapeHtml(image)}"
                  data-title="${escapeHtml(title || "-")}"
                  data-brand="${escapeHtml(item.brand || "-")}"
                  data-category="${escapeHtml(item.category || "-")}"
                  data-rank="${escapeHtml(item.rank || "-")}"
                  data-accessory-code="-"
                  data-scheduled="${escapeHtml(scheduledDate || "-")}"
                  data-origin-url="${escapeHtml(itemUrl || "#")}"
                >${escapeHtml(item.item_id || "-")}</a>
              </div>
              <div class="item-meta">
                <span>내부바코드: ${item.wms_internal_barcode || "-"}</span>
                <span>제목: ${truncTitle}</span>
                <span>경매번호: ${item.auc_num || "-"}</span>
                <span>카테고리: ${item.category || "-"}</span>
                <span>브랜드: ${brand}</span>
                <span>등급: ${item.rank || "-"}</span>
                <span>상품가: ${item.starting_price ? cleanNumberFormat(item.starting_price) + "¥" : "-"}</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <div>${companyName}</div>
          <small>${loginId}</small>
        </td>
        <td>
          <div>${purchasePriceFormatted}</div>
          ${krwPrice ? `<small>${krwPrice}</small>` : ""}
        </td>
        <td>${createdAt}</td>
        <td>${updatedAt}</td>
        <td><span class="badge ${statusClass}">${statusDisplay}</span></td>
        <td><span class="badge badge-${shippingStatus === "completed" ? "success" : shippingStatus === "shipped" ? "primary" : shippingStatus === "processing" ? "dark" : shippingStatus === "domestic_arrived" ? "warning" : "info"}">${shippingDisplay}</span></td>
        <td>${hasAppr}</td>
        <td>${repairHtml}</td>
        <td>${actionsHtml}</td>
      </tr>`;
    })
    .join("");

  updateBulkSelectionUI();
}

// --- Pagination ---
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="changePage(${currentPage - 1})">‹</button>`;
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1)
    html += `<button class="page-btn" onclick="changePage(1)">1</button>`;
  if (startPage > 2) html += `<span class="page-dots">…</span>`;

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn${i === currentPage ? " active" : ""}" onclick="changePage(${i})">${i}</button>`;
  }

  if (endPage < totalPages - 1) html += `<span class="page-dots">…</span>`;
  if (endPage < totalPages)
    html += `<button class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;

  if (currentPage < totalPages) {
    html += `<button class="page-btn" onclick="changePage(${currentPage + 1})">›</button>`;
  }

  container.innerHTML = html;
}

// --- Bulk Actions ---
function updateBulkSelectionUI() {
  const checkboxes = document.querySelectorAll(".bid-checkbox:checked");
  const count = checkboxes.length;
  const hint = document.getElementById("bulkSelectionHint");
  const btn = document.getElementById("bulkShipBtn");
  if (hint) hint.textContent = `선택 ${count}건`;
  if (btn) btn.disabled = count === 0;
}

async function bulkChangeStatus() {
  const target = document.getElementById("bulkStatusTarget")?.value;
  if (!target) return;

  const ids = [...document.querySelectorAll(".bid-checkbox:checked")].map(
    (cb) => parseInt(cb.value),
  );
  if (!ids.length) return alert("선택된 항목이 없습니다.");

  if (
    !confirm(
      `${ids.length}건을 "${getInstantStatusLabel(target)}" 상태로 변경하시겠습니까?`,
    )
  )
    return;

  let successCount = 0;
  for (const id of ids) {
    try {
      if (target === "cancelled") {
        await fetchAPI(`/instant-purchases/cancel`, {
          method: "PUT",
          body: JSON.stringify({ ids: [id] }),
        });
      } else {
        await fetchAPI(`/instant-purchases/shipping-status`, {
          method: "PUT",
          body: JSON.stringify({ ids: [id], shippingStatus: target }),
        });
      }
      successCount++;
    } catch (e) {
      console.error(`ID ${id} 변경 실패:`, e);
    }
  }
  alert(`${successCount}/${ids.length}건 변경 완료`);
  await loadInstantPurchases();
}

// --- Modals ---
function openCancelModal(id) {
  document.getElementById("cancelPurchaseId").value = id;
  document.getElementById("cancelModal").classList.add("active");
}

async function submitCancel() {
  const id = document.getElementById("cancelPurchaseId").value;
  try {
    await fetchAPI(`/instant-purchases/cancel`, {
      method: "PUT",
      body: JSON.stringify({ ids: [parseInt(id)] }),
    });
    alert("구매가 취소되었습니다.");
    document.getElementById("cancelModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert("취소 실패: " + e.message);
  }
}

function openShippingModal(id, current) {
  document.getElementById("shippingPurchaseId").value = id;
  document.getElementById("shippingStatus").value = current || "pending";
  document.getElementById("shippingModal").classList.add("active");
}

async function submitShipping() {
  const id = document.getElementById("shippingPurchaseId").value;
  const status = document.getElementById("shippingStatus").value;
  try {
    await fetchAPI(`/instant-purchases/shipping-status`, {
      method: "PUT",
      body: JSON.stringify({ ids: [parseInt(id)], shippingStatus: status }),
    });
    alert("배송 상태가 변경되었습니다.");
    document.getElementById("shippingModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert("상태 변경 실패: " + e.message);
  }
}

// 인라인 워크플로우 상태 변경
async function moveInstantPurchaseStatus(purchaseId) {
  const select = document.getElementById(`instantStatusTarget-${purchaseId}`);
  const targetStatus = select?.value;
  const currentRowStatus = select?.dataset.currentStatus || "";

  if (!targetStatus) {
    alert("변경할 상태를 선택해주세요.");
    return;
  }

  if (targetStatus === currentRowStatus) {
    alert("현재 상태와 동일합니다.");
    return;
  }

  if (
    !confirm(
      `이 구매를 ${getInstantStatusLabel(targetStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await fetchAPI(`/instant-purchases/shipping-status`, {
      method: "PUT",
      body: JSON.stringify({
        ids: [parseInt(purchaseId)],
        shippingStatus: targetStatus,
      }),
    });
    alert(`상태가 ${getInstantStatusLabel(targetStatus)}으로 변경되었습니다.`);
    await loadInstantPurchases();
  } catch (error) {
    alert("상태 변경 중 오류가 발생했습니다: " + error.message);
  }
}

// 수선 모달 - 버튼에서 열기 (live/direct와 동일 패턴)
function openRepairModalFromButton(button) {
  const bidId = button.dataset.bidId;
  const bidType = button.dataset.bidType || "instant";
  const repairData = {
    repair_details: button.dataset.repairDetails || "",
    repair_fee: button.dataset.repairFee || 0,
    repair_requested_at: button.dataset.repairRequestedAt || null,
  };
  openRepairModal(bidId, bidType, repairData);
}

// 수선 모달 열기 (신규 접수 또는 수정)
function openRepairModal(bidId, bidType, repairData = null) {
  document.getElementById("repairPurchaseId").value = bidId;
  const detailsEl = document.getElementById("repairDetails");
  const feeEl = document.getElementById("repairFee");
  const requestedGroup = document.getElementById("repairRequestedAtGroup");
  const requestedAt = document.getElementById("repairRequestedAt");
  const cancelBtn = document.getElementById("cancelRepair");
  const submitBtn = document.getElementById("submitRepair");

  if (repairData && repairData.repair_requested_at) {
    // 수정 모드
    document.querySelector("#repairModal .modal-title").textContent =
      "수선 정보 수정";
    requestedGroup.style.display = "block";
    requestedAt.textContent = new Date(
      repairData.repair_requested_at,
    ).toLocaleString("ko-KR");
    detailsEl.value = repairData.repair_details || "";
    feeEl.value = repairData.repair_fee || "";
    cancelBtn.style.display = "inline-block";
    submitBtn.textContent = "수정하기";
  } else {
    // 신규 접수 모드
    document.querySelector("#repairModal .modal-title").textContent =
      "수선 접수";
    requestedGroup.style.display = "none";
    detailsEl.value = "";
    feeEl.value = "";
    cancelBtn.style.display = "none";
    submitBtn.textContent = "접수하기";
  }

  detailsEl.disabled = false;
  feeEl.disabled = false;
  submitBtn.style.display = "inline-block";

  document.getElementById("repairModal").classList.add("active");
}

async function submitRepair() {
  const id = document.getElementById("repairPurchaseId").value;
  const details = document.getElementById("repairDetails").value.trim();
  const fee = document.getElementById("repairFee").value;
  const isEdit =
    document.getElementById("submitRepair").textContent === "수정하기";

  if (!details) {
    alert("수선 내용을 입력해주세요.");
    return;
  }

  try {
    await fetchAPI(`/bid-results/instant/${id}/request-repair`, {
      method: "POST",
      body: JSON.stringify({
        repair_details: details,
        repair_fee: fee ? parseInt(fee) : null,
      }),
    });
    alert(
      isEdit ? "수선 정보가 수정되었습니다." : "수선 접수가 완료되었습니다.",
    );
    document.getElementById("repairModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert((isEdit ? "수선 정보 수정" : "수선 접수") + " 실패: " + e.message);
  }
}

async function cancelRepair() {
  const id = document.getElementById("repairPurchaseId").value;
  if (!confirm("수선 접수를 취소하시겠습니까?")) return;
  try {
    await fetchAPI(`/bid-results/instant/${id}/repair`, {
      method: "DELETE",
    });
    alert("수선 접수가 취소되었습니다.");
    document.getElementById("repairModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert("수선 취소 실패: " + e.message);
  }
}

// --- Detail Modal ---

function setInstantDetailText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value || "-";
}

function setInstantDetailOrigin(url) {
  const link = document.getElementById("instantDetailOriginLink");
  if (!link) return;
  const safeUrl = url && url !== "#" ? url : "";
  link.href = safeUrl || "#";
  link.style.pointerEvents = safeUrl ? "auto" : "none";
  link.style.opacity = safeUrl ? "1" : "0.5";
}

function applyInstantDetailData(data = {}) {
  setInstantDetailText("instantDetailItemId", data.itemId || "-");
  setInstantDetailText("instantDetailTitle", data.title || "-");
  setInstantDetailText("instantDetailBrand", data.brand || "-");
  setInstantDetailText("instantDetailCategory", data.category || "-");
  setInstantDetailText("instantDetailRank", data.rank || "-");
  setInstantDetailText("instantDetailScheduled", data.scheduled || "-");
  setInstantDetailText("instantDetailAccessoryCode", data.accessoryCode || "-");
  setInstantDetailText("instantDetailDescription", data.description || "-");
  setInstantDetailOrigin(data.originUrl || "#");
  const mainImg = document.getElementById("instantDetailMainImage");
  if (mainImg) mainImg.src = data.image || "/images/no-image.png";
}

function setInstantDetailImages(images) {
  const normalized = Array.isArray(images)
    ? images.filter((x) => String(x || "").trim())
    : [];
  instantDetailImages = normalized.length
    ? normalized
    : ["/images/no-image.png"];
  instantDetailImageIndex = 0;
  const mainImg = document.getElementById("instantDetailMainImage");
  if (mainImg) mainImg.src = instantDetailImages[0];
  renderInstantDetailThumbs();
}

async function openInstantProductDetail(event, anchorEl) {
  if (event) event.preventDefault();
  const anchor = anchorEl;
  if (!anchor) return false;

  const itemId = String(anchor.dataset.itemId || "").trim();
  const aucNum = String(anchor.dataset.aucNum || "").trim();
  const modal = window.setupModal("instantProductDetailModal");
  if (!modal || !itemId) return false;

  applyInstantDetailData({
    itemId,
    title: anchor.dataset.title || "-",
    brand: anchor.dataset.brand || "-",
    category: anchor.dataset.category || "-",
    rank: anchor.dataset.rank || "-",
    scheduled: anchor.dataset.scheduled || "-",
    description: "상세 정보를 불러오는 중입니다...",
    image: anchor.dataset.image || "/images/no-image.png",
    originUrl: anchor.dataset.originUrl || "#",
    accessoryCode: anchor.dataset.accessoryCode || "-",
  });
  setInstantDetailImages([anchor.dataset.image || "/images/no-image.png"]);
  modal.show();

  try {
    const detail = await window.API.fetchAPI(
      `/detail/item-details/${encodeURIComponent(itemId)}`,
      {
        method: "POST",
        body: JSON.stringify({ aucNum, translateDescription: "ko" }),
      },
    );

    let detailImage =
      detail?.image || anchor.dataset.image || "/images/no-image.png";
    let detailImages = [detailImage];
    if (detail?.additional_images) {
      try {
        const extra = JSON.parse(detail.additional_images);
        if (Array.isArray(extra) && extra.length > 0 && extra[0]) {
          detailImage = extra[0];
          detailImages = [detailImage, ...extra.slice(1)];
        }
      } catch (e) {
        /* ignore json parse error */
      }
    }
    setInstantDetailImages(detailImages);

    applyInstantDetailData({
      itemId,
      title: detail?.title || anchor.dataset.title || "-",
      brand: detail?.brand || anchor.dataset.brand || "-",
      category: detail?.category || anchor.dataset.category || "-",
      rank: detail?.rank || anchor.dataset.rank || "-",
      accessoryCode:
        detail?.accessory_code || anchor.dataset.accessoryCode || "-",
      scheduled: anchor.dataset.scheduled || "-",
      description:
        detail?.description_ko ||
        detail?.description ||
        "설명 정보가 없습니다.",
      image: detailImage,
      originUrl: anchor.dataset.originUrl || "#",
    });
  } catch (error) {
    console.error("상품 상세 조회 실패:", error);
    setInstantDetailText(
      "instantDetailDescription",
      "상세 정보를 불러오지 못했습니다.",
    );
  }
  return false;
}

// 상세 버튼에서 ID로 열기 (액션 버튼용)
function openDetailModalById(id) {
  const item = currentPurchasesData.find((p) => p.id === id);
  if (!item) return;

  const scheduled = item.completed_at
    ? new Date(item.completed_at).toLocaleString("ko-KR")
    : item.created_at
      ? new Date(item.created_at).toLocaleString("ko-KR")
      : "-";
  const itemUrl = `https://bid.brand-auc.com/items/detail?uketsukeBng=${item.item_id}`;

  // 가짜 앵커 객체를 만들어서 openInstantProductDetail에 전달
  const fakeAnchor = {
    dataset: {
      itemId: item.item_id || "",
      aucNum: String(item.auc_num || 2),
      image: item.image || "/images/no-image.png",
      title: item.title || item.original_title || "-",
      brand: item.brand || "-",
      category: item.category || "-",
      rank: item.rank || "-",
      accessoryCode: "-",
      scheduled: scheduled,
      originUrl: itemUrl,
    },
  };
  openInstantProductDetail(null, fakeAnchor);
}

function renderInstantDetailThumbs() {
  const container = document.getElementById("instantDetailThumbs");
  if (!container) return;
  container.innerHTML = instantDetailImages
    .map(
      (src, i) =>
        `<img src="${escapeHtml(src)}" class="live-detail-thumb${i === instantDetailImageIndex ? " active" : ""}" onclick="setInstantDetailImage(${i})" onerror="this.src='/images/no-image.png'" />`,
    )
    .join("");
}

function setInstantDetailImage(idx) {
  instantDetailImageIndex = idx;
  document.getElementById("instantDetailMainImage").src =
    instantDetailImages[idx] || "/images/no-image.png";
  renderInstantDetailThumbs();
}

function bindInstantDetailGalleryControls() {
  document
    .getElementById("instantDetailPrevBtn")
    ?.addEventListener("click", () => {
      if (instantDetailImageIndex > 0)
        setInstantDetailImage(instantDetailImageIndex - 1);
    });
  document
    .getElementById("instantDetailNextBtn")
    ?.addEventListener("click", () => {
      if (instantDetailImageIndex < instantDetailImages.length - 1)
        setInstantDetailImage(instantDetailImageIndex + 1);
    });
}

function bindInstantDetailImageZoomControls() {
  const wrap = document.getElementById("instantDetailMainImageWrap");
  const img = document.getElementById("instantDetailMainImage");
  if (!wrap || !img) return;

  const setZoomByPointer = (event) => {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    const xPct = (x / rect.width) * 100;
    const yPct = (y / rect.height) * 100;
    img.style.transformOrigin = `${xPct}% ${yPct}%`;
  };

  wrap.addEventListener("mouseenter", () => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    img.classList.add("zoom-active");
  });

  wrap.addEventListener("mousemove", (event) => {
    if (!img.classList.contains("zoom-active")) return;
    setZoomByPointer(event);
  });

  wrap.addEventListener("mouseleave", () => {
    img.classList.remove("zoom-active");
    img.style.transformOrigin = "center center";
  });
}

// --- Init ---
document.addEventListener("DOMContentLoaded", function () {
  restoreURLState();

  // 갤러리 & 줌 컨트롤 바인딩
  bindInstantDetailGalleryControls();
  bindInstantDetailImageZoomControls();

  // Apply restored state to UI
  const searchInput = document.getElementById("searchInput");
  if (searchInput && currentSearch) searchInput.value = currentSearch;

  const sortByEl = document.getElementById("sortBy");
  if (sortByEl) sortByEl.value = currentSortBy;

  const sortOrderEl = document.getElementById("sortOrder");
  if (sortOrderEl) sortOrderEl.value = currentSortOrder;

  const pageSizeEl = document.getElementById("pageSize");
  if (pageSizeEl) pageSizeEl.value = itemsPerPage;

  const fromDateEl = document.getElementById("fromDate");
  if (fromDateEl && fromDate) fromDateEl.value = fromDate;

  const toDateEl = document.getElementById("toDate");
  if (toDateEl && toDate) toDateEl.value = toDate;

  // Filter tabs
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => filterByStatus(tab.dataset.status));
  });

  // Search
  document.getElementById("searchBtn")?.addEventListener("click", () => {
    currentSearch = document.getElementById("searchInput")?.value || "";
    currentPage = 1;
    updateURLState();
    loadInstantPurchases();
  });

  document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
    const input = document.getElementById("searchInput");
    if (input) input.value = "";
    currentSearch = "";
    currentPage = 1;
    updateURLState();
    loadInstantPurchases();
  });

  document.getElementById("searchInput")?.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      currentSearch = e.target.value;
      currentPage = 1;
      updateURLState();
      loadInstantPurchases();
    }
  });

  // Filters
  document.getElementById("applyDateFilter")?.addEventListener("click", () => {
    currentSortBy = document.getElementById("sortBy")?.value || "created_at";
    currentSortOrder = document.getElementById("sortOrder")?.value || "desc";
    itemsPerPage = parseInt(document.getElementById("pageSize")?.value) || 100;
    fromDate = document.getElementById("fromDate")?.value || "";
    toDate = document.getElementById("toDate")?.value || "";
    currentPage = 1;
    updateURLState();
    loadInstantPurchases();
  });

  document.getElementById("resetDateFilter")?.addEventListener("click", () => {
    document.getElementById("sortBy").value = "created_at";
    document.getElementById("sortOrder").value = "desc";
    document.getElementById("pageSize").value = "100";
    document.getElementById("fromDate").value = "";
    document.getElementById("toDate").value = "";
    currentSortBy = "created_at";
    currentSortOrder = "desc";
    itemsPerPage = 100;
    fromDate = "";
    toDate = "";
    currentPage = 1;
    updateURLState();
    loadInstantPurchases();
  });

  // Quick dates
  document.querySelectorAll(".btn-pill[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range;
      const now = new Date();
      let start = new Date();
      if (range === "today") {
        start = now;
      } else if (range === "week") {
        start.setDate(now.getDate() - now.getDay());
      } else if (range === "month") {
        start.setDate(1);
      }
      document.getElementById("fromDate").value = start
        .toISOString()
        .split("T")[0];
      document.getElementById("toDate").value = now.toISOString().split("T")[0];
    });
  });

  // Bulk actions
  document.getElementById("selectAllBids")?.addEventListener("change", (e) => {
    document.querySelectorAll(".bid-checkbox").forEach((cb) => {
      cb.checked = e.target.checked;
    });
    updateBulkSelectionUI();
  });

  document
    .getElementById("instantPurchasesTableBody")
    ?.addEventListener("change", (e) => {
      if (e.target.classList.contains("bid-checkbox")) updateBulkSelectionUI();
    });

  document
    .getElementById("bulkShipBtn")
    ?.addEventListener("click", bulkChangeStatus);

  // Modals close
  document.querySelectorAll(".close-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay")?.classList.remove("active");
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("active");
    });
  });

  // Modal submit
  document
    .getElementById("submitCancel")
    ?.addEventListener("click", submitCancel);
  document
    .getElementById("submitShipping")
    ?.addEventListener("click", submitShipping);
  document
    .getElementById("submitRepair")
    ?.addEventListener("click", submitRepair);
  document
    .getElementById("cancelRepair")
    ?.addEventListener("click", cancelRepair);

  // Detail image nav는 bindInstantDetailGalleryControls()에서 처리됨

  // Logout
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/signin";
    } catch (e) {
      window.location.href = "/signin";
    }
  });

  // Socket
  InstantPurchasesRealtimeManager.initializeSocket();

  // Initial load
  loadInstantPurchases();
});
