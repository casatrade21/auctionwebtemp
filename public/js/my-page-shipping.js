// public/js/my-page-shipping.js - 마이페이지 배송 조회 탭
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

  const STATUS_ICONS = {
    ready: "fas fa-box",
    slip_issued: "fas fa-barcode",
    order_registered: "fas fa-clipboard-list",
    picked_up: "fas fa-dolly",
    in_transit: "fas fa-shipping-fast",
    out_for_delivery: "fas fa-motorcycle",
    delivered: "fas fa-check-circle",
    failed: "fas fa-exclamation-circle",
    returned: "fas fa-undo",
  };

  let loaded = false;

  window.MyPageShipping = {
    load: async function () {
      const loadingEl = document.getElementById("shipping-loading");
      const contentEl = document.getElementById("shipping-content");

      if (loaded) {
        loadingEl.style.display = "none";
        contentEl.style.display = "block";
        return;
      }

      loadingEl.style.display = "block";
      contentEl.style.display = "none";

      try {
        const res = await fetch("/api/shipping/my");
        const data = await res.json();

        if (!data.success) {
          loadingEl.innerHTML = '<p style="color:red;">배송 정보 로드 실패</p>';
          return;
        }

        renderStats(data.shipments || []);
        renderList(data.shipments || []);
        loaded = true;

        loadingEl.style.display = "none";
        contentEl.style.display = "block";
      } catch (e) {
        console.error("배송 조회 에러:", e);
        loadingEl.innerHTML =
          '<p style="color:red;">배송 정보를 불러오지 못했습니다.</p>';
      }

      // 모달 닫기
      document
        .getElementById("shipTrackClose")
        ?.addEventListener("click", () => {
          document.getElementById("shipping-track-modal").style.display =
            "none";
        });
    },
  };

  function renderStats(shipments) {
    const total = shipments.length;
    const transit = shipments.filter((s) =>
      ["picked_up", "in_transit", "out_for_delivery"].includes(s.status),
    ).length;
    const delivered = shipments.filter((s) => s.status === "delivered").length;

    document.getElementById("ship-total").textContent = total;
    document.getElementById("ship-transit").textContent = transit;
    document.getElementById("ship-delivered").textContent = delivered;
  }

  function renderList(shipments) {
    const listEl = document.getElementById("shipping-list");
    const emptyEl = document.getElementById("shipping-empty");

    if (!shipments.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    listEl.innerHTML = shipments
      .map((s) => {
        const statusLabel = STATUS_LABELS[s.status] || s.status;
        const icon = STATUS_ICONS[s.status] || "fas fa-box";
        const date = s.created_at
          ? new Date(s.created_at).toLocaleDateString("ko-KR")
          : "-";
        const courier = s.courier_name || "로젠택배";
        const trackNo = s.tracking_number || s.logen_slip_no || "-";
        const lastStatus = s.tracking_last_status || "-";

        return `<div class="bid-result-item" style="cursor:pointer;" onclick="MyPageShipping.openTrack(${s.id})">
          <div class="item-image" style="display:flex;align-items:center;justify-content:center;background:#f8f9fa;min-width:80px;">
            <i class="${icon}" style="font-size:28px;color:#6c757d;"></i>
          </div>
          <div class="item-info" style="flex:1;">
            <div class="item-brand">${esc(courier)}</div>
            <div class="item-title">${esc(s.item_name || "배송 상품")}</div>
            <div class="item-category" style="color:#888;">수신: ${esc(s.receiver_name)} | 송장: <code>${esc(trackNo)}</code></div>
          </div>
          <div class="result-status" style="text-align:right;">
            <div class="status-badge status-${s.status}" style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;
              background:${getStatusBg(s.status)};color:${getStatusColor(s.status)};">
              ${statusLabel}
            </div>
            <div class="result-date" style="margin-top:4px;font-size:12px;color:#888;">${date}</div>
            ${lastStatus !== "-" ? `<div style="font-size:11px;color:#666;margin-top:2px;">${esc(lastStatus)}</div>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  window.MyPageShipping.openTrack = async function (id) {
    const modal = document.getElementById("shipping-track-modal");
    const infoEl = document.getElementById("shipTrackInfo");
    const timelineEl = document.getElementById("shipTrackTimeline");

    modal.style.display = "flex";
    infoEl.innerHTML = "조회 중...";
    timelineEl.innerHTML = "";

    try {
      const res = await fetch(`/api/shipping/my/${id}/track`);
      const data = await res.json();

      if (!data.success) {
        infoEl.innerHTML = `<p style="color:red;">${data.message || "조회 실패"}</p>`;
        return;
      }

      const s = data.shipment;
      const statusLabel = STATUS_LABELS[s.status] || s.status;
      infoEl.innerHTML = `
        <p><strong>택배사:</strong> ${esc(s.courier_name || "로젠택배")}</p>
        <p><strong>송장번호:</strong> ${s.tracking_number || s.logen_slip_no || "-"}</p>
        <p><strong>수신자:</strong> ${esc(s.receiver_name)}</p>
        <p><strong>상품:</strong> ${esc(s.item_name || "-")}</p>
        <p><strong>상태:</strong> <span style="padding:3px 8px;border-radius:10px;font-size:12px;font-weight:600;
          background:${getStatusBg(s.status)};color:${getStatusColor(s.status)};">${statusLabel}</span></p>
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
            return `<li style="padding:8px 0;border-bottom:1px solid #eee;">
              <span style="font-size:12px;color:#888;">${dt} ${tm}</span><br/>
              <strong>${esc(d.statusName)}</strong>
              <span style="color:#666;font-size:13px;">${esc(d.branchName || "")} ${esc(d.salesName || "")}</span>
            </li>`;
          })
          .join("");
      } else {
        timelineEl.innerHTML =
          '<li style="padding:16px 0;text-align:center;color:#999;">추적 내역이 없습니다.</li>';
      }
    } catch (e) {
      infoEl.innerHTML = `<p style="color:red;">추적 에러: ${e.message}</p>`;
    }
  };

  function getStatusBg(status) {
    const map = {
      ready: "#fff3e0",
      slip_issued: "#e3f2fd",
      order_registered: "#e8f5e9",
      picked_up: "#e0f7fa",
      in_transit: "#e8eaf6",
      out_for_delivery: "#fce4ec",
      delivered: "#e8f5e9",
      failed: "#fbe9e7",
      returned: "#f3e5f5",
    };
    return map[status] || "#f5f5f5";
  }

  function getStatusColor(status) {
    const map = {
      ready: "#e65100",
      slip_issued: "#1565c0",
      order_registered: "#2e7d32",
      picked_up: "#00838f",
      in_transit: "#283593",
      out_for_delivery: "#c62828",
      delivered: "#1b5e20",
      failed: "#bf360c",
      returned: "#6a1b9a",
    };
    return map[status] || "#333";
  }

  function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
