// public/js/admin/shipping.js - 출고/배송 관리 프론트엔드
(function () {
  "use strict";

  const STATUS_LABELS = {
    ready: "출고준비",
    slip_issued: "송장채번",
    order_registered: "주문등록",
    picked_up: "집하",
    in_transit: "배송중",
    out_for_delivery: "배달중",
    delivered: "배달완료",
    failed: "배달실패",
    returned: "반송",
  };

  let currentPage = 1;
  const PAGE_SIZE = 50;

  // ── 초기화 ────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    checkApiStatus();
    loadOutboundReady();
    bindEvents();
  });

  function bindEvents() {
    // 탭
    document.querySelectorAll(".shipping-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".shipping-tabs button")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document
          .querySelectorAll(".tab-content")
          .forEach((t) => (t.style.display = "none"));
        document.getElementById(`tab-${btn.dataset.tab}`).style.display =
          "block";
        if (btn.dataset.tab === "all") loadShipmentsList();
      });
    });

    // 출고 대기
    document
      .getElementById("btnRefreshOutbound")
      .addEventListener("click", loadOutboundReady);
    document
      .getElementById("checkAllOutbound")
      .addEventListener("change", (e) => {
        document
          .querySelectorAll("#outboundBody input[type=checkbox]")
          .forEach((cb) => (cb.checked = e.target.checked));
      });

    // 전체 배송
    document.getElementById("btnSearchAll").addEventListener("click", () => {
      currentPage = 1;
      loadShipmentsList();
    });
    document.getElementById("searchInput").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        currentPage = 1;
        loadShipmentsList();
      }
    });
    document.getElementById("statusFilter").addEventListener("change", () => {
      currentPage = 1;
      loadShipmentsList();
    });
    document
      .getElementById("btnRefreshAll")
      .addEventListener("click", refreshAllStatuses);
    document
      .getElementById("btnBulkPdf")
      .addEventListener("click", bulkPrintPdf);
    document
      .getElementById("checkAllShipments")
      .addEventListener("change", (e) => {
        document
          .querySelectorAll("#shipmentsBody input[type=checkbox]")
          .forEach((cb) => (cb.checked = e.target.checked));
      });

    // 등록 모달
    document
      .getElementById("registerModalClose")
      .addEventListener("click", closeRegisterModal);
    document
      .getElementById("registerCancelBtn")
      .addEventListener("click", closeRegisterModal);
    document
      .getElementById("registerSubmitBtn")
      .addEventListener("click", submitRegister);
    // 주소 blur 시 배송점 조회
    document
      .getElementById("reg-receiver-address")
      .addEventListener("blur", lookupAddress);

    // 추적 모달
    document
      .getElementById("trackingModalClose")
      .addEventListener("click", () => {
        document.getElementById("trackingModal").classList.remove("show");
      });
  }

  // ── API 상태 ──────────────────────────────────

  async function checkApiStatus() {
    try {
      const res = await fetch("/api/shipping/status");
      const data = await res.json();
      const el = document.getElementById("apiStatus");
      if (data.configured) {
        el.className = "api-status configured";
        el.innerHTML = `✅ 로젠 API 연동됨 (${data.isTest ? "개발계" : "운영계"}) | 업체코드: ${data.userId} | 거래처: ${data.custCd}`;
      } else {
        el.className = "api-status not-configured";
        el.innerHTML = `⚠️ 로젠 API 미설정 - .env에 LOGEN_USER_ID, LOGEN_CUST_CD 추가 필요. 현재는 DB 저장만 동작합니다.`;
      }
    } catch (e) {
      console.error("API 상태 확인 실패:", e);
    }
  }

  // ── 출고 대기 ─────────────────────────────────

  async function loadOutboundReady() {
    const tbody = document.getElementById("outboundBody");
    const emptyEl = document.getElementById("outboundEmpty");
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;">로딩 중...</td></tr>';
    emptyEl.style.display = "none";

    try {
      const res = await fetch("/api/shipping/outbound-ready");
      const data = await res.json();
      if (!data.success || !data.items?.length) {
        tbody.innerHTML = "";
        emptyEl.style.display = "block";
        return;
      }

      tbody.innerHTML = data.items
        .map((item) => {
          const meta = item.metadata_text ? tryParse(item.metadata_text) : {};
          const title = meta.title || item.original_title || "-";
          const addr = item.company_address || "-";
          const bidLabel =
            item.bid_type === "direct"
              ? "직접"
              : item.bid_type === "instant"
                ? "바로"
                : "현장";
          return `<tr>
            <td><input type="checkbox" data-wms-id="${item.wms_item_id}" /></td>
            <td>${item.wms_item_id}</td>
            <td><code>${item.internal_barcode || "-"}</code></td>
            <td>${esc(item.company_name || item.member_name || "-")}</td>
            <td title="${esc(title)}">${esc(truncate(title, 30))}</td>
            <td title="${esc(addr)}">${esc(truncate(addr, 25))}</td>
            <td>${bidLabel}</td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="openRegisterModal(${JSON.stringify(item).replace(/"/g, "&quot;")})">
                송장 등록
              </button>
            </td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      console.error("출고 대기 목록 에러:", e);
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:red;">로드 실패</td></tr>';
    }
  }

  // ── 전체 배송 목록 ────────────────────────────

  async function loadShipmentsList() {
    const tbody = document.getElementById("shipmentsBody");
    const emptyEl = document.getElementById("shipmentsEmpty");
    tbody.innerHTML =
      '<tr><td colspan="10" style="text-align:center;">로딩 중...</td></tr>';
    emptyEl.style.display = "none";

    const search = document.getElementById("searchInput").value;
    const status = document.getElementById("statusFilter").value;

    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: PAGE_SIZE,
        status,
        search,
      });
      const res = await fetch(`/api/shipping/list?${params}`);
      const data = await res.json();

      if (!data.success || !data.shipments?.length) {
        tbody.innerHTML = "";
        emptyEl.style.display = "block";
        document.getElementById("shipmentsPagination").innerHTML = "";
        return;
      }

      tbody.innerHTML = data.shipments
        .map((s) => {
          const slipDisplay = s.tracking_number || "-";
          const statusClass = `status-${s.status}`;
          const statusLabel = STATUS_LABELS[s.status] || s.status;
          const lastTrack = s.tracking_last_status || "-";
          const date = s.created_at
            ? new Date(s.created_at).toLocaleDateString("ko-KR")
            : "-";
          return `<tr>
            <td><input type="checkbox" data-id="${s.id}" /></td>
            <td>${s.id}</td>
            <td><code>${slipDisplay}</code></td>
            <td>${esc(s.receiver_name)}</td>
            <td title="${esc(s.item_name || "")}">${esc(truncate(s.item_name || "-", 20))}</td>
            <td>${esc(s.company_name || s.username || "-")}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>${esc(lastTrack)}</td>
            <td>${date}</td>
            <td>
              <button class="btn btn-sm btn-secondary" onclick="openTracking(${s.id})">추적</button>
              ${s.logen_slip_no ? `<button class="btn btn-sm btn-secondary" onclick="printPdf(${s.id})">출력</button>` : ""}
            </td>
          </tr>`;
        })
        .join("");

      renderPagination(data.pagination);
    } catch (e) {
      console.error("배송 목록 에러:", e);
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:red;">로드 실패</td></tr>';
    }
  }

  function renderPagination(pg) {
    const container = document.getElementById("shipmentsPagination");
    if (pg.totalPages <= 1) {
      container.innerHTML = "";
      return;
    }
    let html = "";
    for (let i = 1; i <= pg.totalPages; i++) {
      html += `<button class="${i === pg.page ? "active" : ""}" onclick="goPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
  }

  window.goPage = function (page) {
    currentPage = page;
    loadShipmentsList();
  };

  // ── 송장 등록 모달 ────────────────────────────

  window.openRegisterModal = function (item) {
    const meta = item.metadata_text ? tryParse(item.metadata_text) : {};
    document.getElementById("reg-bid-type").value = item.bid_type || "";
    document.getElementById("reg-bid-id").value = item.bid_id || "";
    document.getElementById("reg-wms-item-id").value = item.wms_item_id || "";
    document.getElementById("reg-user-id").value = item.user_id || "";
    document.getElementById("reg-receiver-name").value =
      item.company_name || item.member_name || "";
    document.getElementById("reg-receiver-phone").value = item.phone || "";
    document.getElementById("reg-receiver-cell").value = "";
    document.getElementById("reg-receiver-address").value =
      item.company_address || "";
    document.getElementById("reg-receiver-address-detail").value = "";
    document.getElementById("reg-item-name").value =
      meta.title || item.original_title || "";
    document.getElementById("reg-goods-amount").value = 0;
    document.getElementById("reg-admin-memo").value = "";
    document.getElementById("addrInfo").style.display = "none";
    document.getElementById("registerModal").classList.add("show");

    // 주소가 있으면 자동 조회
    if (item.company_address) lookupAddress();
  };

  function closeRegisterModal() {
    document.getElementById("registerModal").classList.remove("show");
  }

  async function lookupAddress() {
    const address = document
      .getElementById("reg-receiver-address")
      .value.trim();
    const infoEl = document.getElementById("addrInfo");
    if (!address) {
      infoEl.style.display = "none";
      return;
    }

    try {
      const res = await fetch("/api/shipping/lookup-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        const d = data.data;
        let html = `배송점: ${d.branCd} | 분류: ${d.classCd} | 우편번호: ${d.zipCd} | 영업소: ${d.salesNm}`;
        if (d.jejuRegYn) html += ' <span class="badge badge-jeju">제주</span>';
        if (d.shipYn) html += ' <span class="badge badge-island">도서</span>';
        if (d.montYn) html += ' <span class="badge badge-mountain">산간</span>';
        infoEl.innerHTML = html;
        infoEl.style.display = "block";
      } else {
        infoEl.innerHTML = "⚠️ 주소 조회 실패: " + (data.message || "");
        infoEl.style.display = "block";
      }
    } catch (e) {
      infoEl.innerHTML = "⚠️ 로젠 API 미설정 (주소 조회 불가)";
      infoEl.style.display = "block";
    }
  }

  async function submitRegister() {
    const btn = document.getElementById("registerSubmitBtn");
    btn.disabled = true;
    btn.textContent = "등록 중...";

    const body = {
      bid_type: document.getElementById("reg-bid-type").value,
      bid_id: Number(document.getElementById("reg-bid-id").value),
      wms_item_id:
        Number(document.getElementById("reg-wms-item-id").value) || null,
      user_id: Number(document.getElementById("reg-user-id").value),
      receiver_name: document.getElementById("reg-receiver-name").value.trim(),
      receiver_phone: document
        .getElementById("reg-receiver-phone")
        .value.trim(),
      receiver_cell_phone: document
        .getElementById("reg-receiver-cell")
        .value.trim(),
      receiver_address: document
        .getElementById("reg-receiver-address")
        .value.trim(),
      receiver_address_detail: document
        .getElementById("reg-receiver-address-detail")
        .value.trim(),
      item_name: document.getElementById("reg-item-name").value.trim(),
      goods_amount:
        Number(document.getElementById("reg-goods-amount").value) || 0,
      admin_memo: document.getElementById("reg-admin-memo").value.trim(),
    };

    if (!body.receiver_name || !body.receiver_phone || !body.receiver_address) {
      alert("수신자명, 전화번호, 주소는 필수입니다.");
      btn.disabled = false;
      btn.textContent = "송장 등록";
      return;
    }

    try {
      const res = await fetch("/api/shipping/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        alert(`✅ ${data.message}\n송장번호: ${data.slip_no || "(미채번)"}`);
        closeRegisterModal();
        loadOutboundReady();
      } else {
        alert("❌ " + (data.message || "등록 실패"));
      }
    } catch (e) {
      alert("❌ 네트워크 에러: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "송장 등록";
    }
  }

  // ── 배송 추적 ─────────────────────────────────

  window.openTracking = async function (id) {
    const infoEl = document.getElementById("trackingInfo");
    const timelineEl = document.getElementById("trackingTimeline");
    infoEl.innerHTML = "로딩 중...";
    timelineEl.innerHTML = "";
    document.getElementById("trackingModal").classList.add("show");

    try {
      const res = await fetch(`/api/shipping/track/${id}`);
      const data = await res.json();

      if (!data.success) {
        infoEl.innerHTML = `<p style="color:red;">${data.message || "조회 실패"}</p>`;
        return;
      }

      const s = data.shipment;
      const statusLabel = STATUS_LABELS[s.status] || s.status;
      infoEl.innerHTML = `
        <p><strong>송장번호:</strong> ${s.tracking_number || s.logen_slip_no || "-"}</p>
        <p><strong>수신자:</strong> ${esc(s.receiver_name)} | <strong>상태:</strong> <span class="status-badge status-${s.status}">${statusLabel}</span></p>
        <p><strong>상품:</strong> ${esc(s.item_name || "-")}</p>
        ${data.message ? `<p style="color:#888;font-size:12px;">${data.message}</p>` : ""}
      `;

      const tracking = data.tracking;
      if (tracking?.details?.length) {
        timelineEl.innerHTML = tracking.details
          .map((d) => {
            const dt = d.scanDate
              ? `${d.scanDate.slice(0, 4)}-${d.scanDate.slice(4, 6)}-${d.scanDate.slice(6, 8)}`
              : "";
            const tm = d.scanTime
              ? `${d.scanTime.slice(0, 2)}:${d.scanTime.slice(2, 4)}`
              : "";
            return `<li>
              <span class="time">${dt} ${tm}</span>
              <span class="desc">${esc(d.statusName)}</span>
              <span class="loc">${esc(d.branchName || "")} ${esc(d.salesName || "")}</span>
            </li>`;
          })
          .join("");
      } else {
        timelineEl.innerHTML = "<li>추적 내역이 없습니다.</li>";
      }
    } catch (e) {
      infoEl.innerHTML = `<p style="color:red;">추적 에러: ${e.message}</p>`;
    }
  };

  // ── 일괄 갱신 ─────────────────────────────────

  async function refreshAllStatuses() {
    const btn = document.getElementById("btnRefreshAll");
    btn.disabled = true;
    btn.textContent = "갱신 중...";
    try {
      const res = await fetch("/api/shipping/refresh-all", { method: "POST" });
      const data = await res.json();
      alert(
        `갱신 완료: ${data.updated || 0}건 업데이트 (총 ${data.total || 0}건 대상)`,
      );
      loadShipmentsList();
    } catch (e) {
      alert("갱신 실패: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "배송상태 일괄 갱신";
    }
  }

  // ── PDF ────────────────────────────────────────

  window.printPdf = function (id) {
    window.open(`/api/shipping/invoice-pdf/${id}`, "_blank");
  };

  function bulkPrintPdf() {
    const ids = [];
    document
      .querySelectorAll("#shipmentsBody input[type=checkbox]:checked")
      .forEach((cb) => {
        ids.push(Number(cb.dataset.id));
      });
    if (ids.length === 0) {
      alert("출력할 배송을 선택하세요.");
      return;
    }

    // POST → Blob → window.open
    fetch("/api/shipping/invoice-pdf-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("PDF 생성 실패");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      })
      .catch((e) => alert("PDF 에러: " + e.message));
  }

  // ── 유틸 ──────────────────────────────────────

  function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str) return "";
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  function tryParse(json) {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
})();
