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

      let statusDisplay = getInstantStatusLabel(status);
      let statusClass = `status-${status}`;
      if (status === "completed" && shippingStatus === "processing") {
        statusDisplay = getInstantProcessingStatusLabel(item);
        statusClass = "status-processing";
      }

      let shippingDisplay = getInstantShippingLabel(shippingStatus);

      // 바코드 표시
      const barcode = item.wms_internal_barcode || "";
      const barcodeHtml = barcode
        ? `<div class="barcode-tag">${escapeHtml(barcode)}</div>`
        : "";

      // 감정서
      const hasAppr = item.appr_id ? "✅" : "-";

      // 수선
      let repairHtml = "-";
      if (item.repair_requested_at) {
        repairHtml = `<button class="btn btn-xs btn-outline" onclick="openRepairModal(${item.id})">수선 접수됨</button>`;
      } else if (status === "completed") {
        repairHtml = `<button class="btn btn-xs btn-ghost" onclick="openRepairModal(${item.id})">수선</button>`;
      }

      // 작업 버튼
      let actionsHtml = "";
      if (status === "completed") {
        actionsHtml += `<button class="btn btn-xs" onclick="openShippingModal(${item.id}, '${shippingStatus}')">배송</button> `;
      }
      if (status !== "cancelled") {
        actionsHtml += `<button class="btn btn-xs btn-danger" onclick="openCancelModal(${item.id})">취소</button> `;
      }
      actionsHtml += `<button class="btn btn-xs btn-ghost" onclick="openDetailModal(${item.id})">상세</button>`;

      return `<tr data-purchase-id="${item.id}">
        <td><input type="checkbox" class="bid-checkbox" value="${item.id}" /></td>
        <td>${item.id}</td>
        <td>
          <div class="product-info-cell" style="cursor:pointer" onclick="openDetailModal(${item.id})">
            <img src="${escapeHtml(image)}" alt="" class="product-thumb" onerror="this.src='/images/no-image.png'" />
            <div class="product-text">
              <div class="product-brand">${brand}</div>
              <div class="product-title" title="${escapeHtml(title)}">${truncTitle}</div>
              <div class="product-id">${escapeHtml(item.item_id || "-")}</div>
              ${barcodeHtml}
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
        <td><span class="badge status-${shippingStatus}">${shippingDisplay}</span></td>
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

function openRepairModal(id) {
  const item = currentPurchasesData.find((p) => p.id === id);
  document.getElementById("repairPurchaseId").value = id;
  const detailsEl = document.getElementById("repairDetails");
  const feeEl = document.getElementById("repairFee");
  const requestedGroup = document.getElementById("repairRequestedAtGroup");
  const requestedAt = document.getElementById("repairRequestedAt");
  const cancelBtn = document.getElementById("cancelRepair");
  const submitBtn = document.getElementById("submitRepair");

  if (item?.repair_requested_at) {
    requestedGroup.style.display = "block";
    requestedAt.textContent = new Date(item.repair_requested_at).toLocaleString(
      "ko-KR",
    );
    detailsEl.value = item.repair_details || "";
    feeEl.value = item.repair_fee || "";
    cancelBtn.style.display = "inline-block";
    submitBtn.textContent = "수정하기";
  } else {
    requestedGroup.style.display = "none";
    detailsEl.value = "";
    feeEl.value = "";
    cancelBtn.style.display = "none";
    submitBtn.textContent = "접수하기";
  }
  document.getElementById("repairModal").classList.add("active");
}

async function submitRepair() {
  const id = document.getElementById("repairPurchaseId").value;
  const details = document.getElementById("repairDetails").value;
  const fee = document.getElementById("repairFee").value;

  try {
    await fetchAPI(`/bid-results/instant/${id}/request-repair`, {
      method: "POST",
      body: JSON.stringify({
        repairDetails: details,
        repairFee: Number(fee) || 0,
      }),
    });
    alert("수선이 접수되었습니다.");
    document.getElementById("repairModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert("수선 접수 실패: " + e.message);
  }
}

async function cancelRepair() {
  const id = document.getElementById("repairPurchaseId").value;
  if (!confirm("수선 접수를 취소하시겠습니까?")) return;
  try {
    await fetchAPI(`/bid-results/instant/${id}/repair`, {
      method: "DELETE",
    });
    alert("수선이 취소되었습니다.");
    document.getElementById("repairModal").classList.remove("active");
    await loadInstantPurchases();
  } catch (e) {
    alert("수선 취소 실패: " + e.message);
  }
}

// --- Detail Modal ---
async function openDetailModal(id) {
  const item = currentPurchasesData.find((p) => p.id === id);
  if (!item) return;

  const modal = document.getElementById("instantProductDetailModal");
  const itemId = item.item_id;

  document.getElementById("instantDetailItemId").textContent = itemId || "-";
  document.getElementById("instantDetailTitle").textContent =
    item.title || item.original_title || "-";
  document.getElementById("instantDetailBrand").textContent = item.brand || "-";
  document.getElementById("instantDetailCategory").textContent =
    item.category || "-";
  document.getElementById("instantDetailRank").textContent = item.rank || "-";
  document.getElementById("instantDetailScheduled").textContent =
    item.scheduled_date
      ? new Date(item.scheduled_date).toLocaleString("ko-KR")
      : "-";
  document.getElementById("instantDetailAccessoryCode").textContent =
    item.additional_info || "-";
  document.getElementById("instantDetailDescription").textContent =
    "로딩 중...";

  const mainImg = document.getElementById("instantDetailMainImage");
  mainImg.src = item.image || "/images/no-image.png";

  instantDetailImages = [item.image || "/images/no-image.png"];
  instantDetailImageIndex = 0;

  modal.classList.add("active");

  // Fetch full details
  try {
    const details = await window.API.fetchAPI(
      `/detail/item-details/${itemId}`,
      { method: "POST", body: JSON.stringify({ aucNum: item.auc_num }) },
    );
    document.getElementById("instantDetailDescription").textContent =
      details.description || "설명 없음";
    document.getElementById("instantDetailAccessoryCode").textContent =
      details.accessory_code || "-";

    if (details.additional_images) {
      try {
        const imgs = JSON.parse(details.additional_images);
        instantDetailImages = [item.image || "/images/no-image.png", ...imgs];
        renderInstantDetailThumbs();
      } catch (e) {
        /* ignore */
      }
    }

    if (details.origin_link) {
      const link = document.getElementById("instantDetailOriginLink");
      link.href = details.origin_link;
    }
  } catch (e) {
    document.getElementById("instantDetailDescription").textContent =
      "상세 정보 로드 실패";
  }
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

// --- Init ---
document.addEventListener("DOMContentLoaded", function () {
  restoreURLState();

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

  // Detail image nav
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
