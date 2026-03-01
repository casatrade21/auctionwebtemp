// public/js/admin/all-bids.js

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

class UnifiedAuctionManager {
  constructor() {
    this.liveData = [];
    this.directData = [];
    this.instantData = [];
    this.currentFilter = "all";
    this.currentResultType = "all";
    this.searchTimeout = null;
    this.highValueThreshold = 100000; // 10만엔 이상을 고액으로 설정
    this.itemsPerPage = 100;
  }

  // 초기화
  async init() {
    this.setupEventListeners();
    await this.loadInitialData();
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 통합 검색
    document
      .getElementById("unifiedSearchInput")
      .addEventListener("input", () => {
        this.handleSearchInput();
      });
    document
      .getElementById("unifiedSearchBtn")
      .addEventListener("click", () => {
        this.executeUnifiedSearch();
      });
    document
      .getElementById("clearUnifiedSearchBtn")
      .addEventListener("click", () => {
        this.clearSearch();
      });

    // 결과 탭
    document.querySelectorAll(".result-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const el = e.currentTarget || e.target.closest(".result-tab");
        if (el?.dataset?.type) this.switchResultTab(el.dataset.type);
      });
    });

    // 더보기 버튼
    document.getElementById("loadMoreBtn").addEventListener("click", () => {
      this.loadMoreResults();
    });

    const pageSizeSelect = document.getElementById("unifiedPageSize");
    if (pageSizeSelect) {
      pageSizeSelect.value = String(this.itemsPerPage);
      pageSizeSelect.addEventListener("change", (e) => {
        const nextSize = Number(e.target.value);
        if (!Number.isFinite(nextSize) || nextSize <= 0) return;
        this.itemsPerPage = nextSize;
        this.refreshByCurrentFilter();
      });
    }

    // 모달 닫기
    document.querySelectorAll(".close-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.closeModal();
      });
    });
  }

  // 초기 데이터 로드
  async loadInitialData() {
    try {
      await this.loadDashboardData();
      await this.loadDefaultResults();
    } catch (error) {
      console.error("초기 데이터 로드 실패:", error);
      this.showError("데이터를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 대시보드 데이터 로드
  async loadDashboardData() {
    try {
      const [liveData, directData, instantData] = await Promise.all([
        fetchLiveBids("", 1, 0), // 전체 조회
        fetchDirectBids("", false, 1, 0), // 전체 조회
        fetchInstantPurchases("", 1, 0), // 전체 조회
      ]);

      this.updateStatusCards(liveData, directData, instantData);
      await this.updateUrgentItems();
      this.updateQuickActionCounts();
    } catch (error) {
      console.error("대시보드 데이터 로드 실패:", error);
    }
  }

  // 상태 카드 업데이트
  updateStatusCards(liveData, directData, instantData) {
    if (!document.getElementById("liveActiveCount")) return;

    // 현장 경매 상태 집계
    const liveStats = this.calculateStats(liveData.bids, "live");
    document.getElementById("liveActiveCount").textContent = liveStats.active;
    document.getElementById("liveCompletedCount").textContent =
      liveStats.completed;
    document.getElementById("liveCancelledCount").textContent =
      liveStats.cancelled;

    // 직접 경매 상태 집계
    const directStats = this.calculateStats(directData.bids, "direct");
    document.getElementById("directActiveCount").textContent =
      directStats.active;
    document.getElementById("directCompletedCount").textContent =
      directStats.completed;
    document.getElementById("directCancelledCount").textContent =
      directStats.cancelled;

    // 바로 구매 상태 집계
    if (instantData && instantData.purchases) {
      const instantStats = this.calculateStats(
        instantData.purchases,
        "instant",
      );
      const el = document.getElementById("instantCompletedCount");
      if (el) el.textContent = instantStats.completed;
    }
  }

  // 상태 집계 계산
  calculateStats(bids, type) {
    if (!bids || !Array.isArray(bids)) {
      return { active: 0, completed: 0, cancelled: 0 };
    }

    const stats = { active: 0, completed: 0, cancelled: 0 };

    bids.forEach((bid) => {
      if (type === "live") {
        // 현장 경매: first, second, final을 active로 분류
        if (["first", "second", "final"].includes(bid.status)) {
          stats.active++;
        } else if (bid.status === "completed") {
          stats.completed++;
        } else if (bid.status === "cancelled") {
          stats.cancelled++;
        }
      } else {
        // 직접 경매 / 바로 구매: active, completed, cancelled 그대로
        if (bid.status === "active" || bid.status === "completed") {
          if (bid.status === "active") stats.active++;
          else stats.completed++;
        } else if (bid.status === "cancelled") {
          stats.cancelled++;
        }
      }
    });

    return stats;
  }

  // 긴급 항목 업데이트
  async updateUrgentItems() {
    await this.updateTodayDeadlines();
    await this.updateUnsubmittedItems();
  }

  // 오늘 마감 예정 업데이트
  async updateTodayDeadlines() {
    try {
      const today = new Date().toISOString().split("T")[0];

      const [liveToday, directToday, instantToday] = await Promise.all([
        fetchLiveBids(
          "",
          1,
          20,
          "original_scheduled_date",
          "asc",
          today,
          today,
        ),
        fetchDirectBids(
          "active",
          false,
          1,
          20,
          "original_scheduled_date",
          "asc",
          today,
          today,
        ),
        fetchInstantPurchases("", 1, 20, "created_at", "desc", today, today),
      ]);

      const totalCount =
        (liveToday.bids?.length || 0) +
        (directToday.bids?.length || 0) +
        (instantToday.purchases?.length || 0);
      const todayDeadlineCountEl =
        document.getElementById("todayDeadlineCount");
      if (todayDeadlineCountEl) todayDeadlineCountEl.textContent = totalCount;
      const quickTodayCountEl = document.getElementById("quickTodayCount");
      if (quickTodayCountEl) quickTodayCountEl.textContent = totalCount;

      this.renderUrgentList(
        "todayDeadlineList",
        [
          ...(liveToday.bids || []),
          ...(directToday.bids || []),
          ...(instantToday.purchases || []),
        ],
        "deadline",
      );
    } catch (error) {
      console.error("오늘 마감 데이터 로드 실패:", error);
      const todayDeadlineListEl = document.getElementById("todayDeadlineList");
      if (todayDeadlineListEl) {
        todayDeadlineListEl.innerHTML =
          '<div class="error">데이터 로드 실패</div>';
      }
    }
  }

  // 플랫폼 미반영 업데이트
  async updateUnsubmittedItems() {
    try {
      const directCompleted = await fetchDirectBids(
        "completed",
        false,
        1,
        50,
        "updated_at",
        "desc",
      );
      const unsubmitted =
        directCompleted.bids?.filter((bid) => !bid.submitted_to_platform) || [];

      const unsubmittedCountEl = document.getElementById("unsubmittedCount");
      if (unsubmittedCountEl)
        unsubmittedCountEl.textContent = unsubmitted.length;
      const quickUnsubmittedCountEl = document.getElementById(
        "quickUnsubmittedCount",
      );
      if (quickUnsubmittedCountEl)
        quickUnsubmittedCountEl.textContent = unsubmitted.length;

      this.renderUrgentList(
        "unsubmittedList",
        unsubmitted.slice(0, 5),
        "unsubmitted",
      );
    } catch (error) {
      console.error("미반영 데이터 로드 실패:", error);
      const unsubmittedListEl = document.getElementById("unsubmittedList");
      if (unsubmittedListEl) {
        unsubmittedListEl.innerHTML =
          '<div class="error">데이터 로드 실패</div>';
      }
    }
  }

  // 긴급 리스트 렌더링
  renderUrgentList(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = '<div class="no-items">항목이 없습니다</div>';
      return;
    }

    const html = items
      .slice(0, 5)
      .map((item) => {
        const timeInfo =
          type === "deadline"
            ? this.calculateTimeRemaining(item.item?.original_scheduled_date)
            : this.calculateTimeSince(item.updated_at);

        return `
        <div class="urgent-item">
          <div class="urgent-item-info">
            <span class="urgent-item-id">${item.item_id}</span>
            <span class="urgent-item-title">${
              item.item?.original_title || "-"
            }</span>
          </div>
          <div class="urgent-item-time ${timeInfo.className}">${
            timeInfo.text
          }</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = html;
  }

  // 남은 시간 계산
  calculateTimeRemaining(scheduledDate) {
    if (!scheduledDate) return { text: "-", className: "" };

    const now = new Date();
    const deadline = new Date(scheduledDate);
    const diff = deadline - now;

    if (diff <= 0) {
      return { text: "마감됨", className: "expired" };
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 1) {
      return { text: `${minutes}분 남음`, className: "urgent" };
    } else if (hours < 6) {
      return { text: `${hours}시간 ${minutes}분 남음`, className: "warning" };
    } else {
      return { text: `${hours}시간 남음`, className: "" };
    }
  }

  // 경과 시간 계산
  calculateTimeSince(date) {
    if (!date) return { text: "-", className: "" };

    const now = new Date();
    const past = new Date(date);
    const diff = now - past;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) {
      return { text: `${days}일 전`, className: days > 3 ? "warning" : "" };
    } else if (hours > 0) {
      return { text: `${hours}시간 전`, className: "" };
    } else {
      return { text: "방금 전", className: "" };
    }
  }

  // 빠른 작업 카운트 업데이트
  updateQuickActionCounts() {
    // 2차 제안 대기 카운트는 별도로 계산 필요
    this.updateSecondProposalCount();
    this.updateHighValueCount();
  }

  // 2차 제안 대기 카운트 업데이트
  async updateSecondProposalCount() {
    try {
      const liveSecond = await fetchLiveBids("first", 1, 0);
      const quickSecondCountEl = document.getElementById("quickSecondCount");
      if (quickSecondCountEl)
        quickSecondCountEl.textContent = liveSecond.total || 0;
    } catch (error) {
      console.error("2차 제안 카운트 로드 실패:", error);
    }
  }

  // 고액 입찰 카운트 업데이트
  async updateHighValueCount() {
    try {
      // 이 부분은 실제 구현 시 가격 조건을 추가해야 함
      const quickHighValueCountEl = document.getElementById(
        "quickHighValueCount",
      );
      if (quickHighValueCountEl) quickHighValueCountEl.textContent = "0";
    } catch (error) {
      console.error("고액 입찰 카운트 로드 실패:", error);
    }
  }

  // 기본 결과 로드 (최근 업데이트된 항목들)
  async loadDefaultResults() {
    try {
      const limit = this.itemsPerPage;
      const [liveRecent, directRecent, instantRecent] = await Promise.all([
        fetchLiveBids("", 1, limit, "updated_at", "desc"),
        fetchDirectBids("", false, 1, limit, "updated_at", "desc"),
        fetchInstantPurchases("", 1, limit, "created_at", "desc"),
      ]);

      this.liveData = liveRecent.bids || [];
      this.directData = directRecent.bids || [];
      this.instantData = instantRecent.purchases || [];

      this.renderUnifiedResults();
    } catch (error) {
      console.error("기본 결과 로드 실패:", error);
      this.showError("결과를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 검색 입력 처리 (디바운스)
  handleSearchInput() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.executeUnifiedSearch();
    }, 300);
  }

  // 통합 검색 실행
  async executeUnifiedSearch() {
    const searchTerm = document
      .getElementById("unifiedSearchInput")
      .value.trim();

    if (!searchTerm) {
      await this.loadDefaultResults();
      return;
    }

    try {
      this.showLoading();
      const limit = this.itemsPerPage;

      const [liveResults, directResults, instantResults] = await Promise.all([
        fetchLiveBids("", 1, limit, "updated_at", "desc", "", "", searchTerm),
        fetchDirectBids(
          "",
          false,
          1,
          limit,
          "updated_at",
          "desc",
          "",
          "",
          searchTerm,
        ),
        fetchInstantPurchases(
          "",
          1,
          limit,
          "created_at",
          "desc",
          "",
          "",
          searchTerm,
        ),
      ]);

      this.liveData = liveResults.bids || [];
      this.directData = directResults.bids || [];
      this.instantData = instantResults.purchases || [];
      this.currentFilter = "search";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("검색 실패:", error);
      this.showError("검색 중 오류가 발생했습니다.");
    }
  }

  // 검색 초기화
  clearSearch() {
    document.getElementById("unifiedSearchInput").value = "";
    this.loadDefaultResults();
  }

  // 빠른 작업 함수들
  async showTodayDeadlines() {
    try {
      this.showLoading();
      const today = new Date().toISOString().split("T")[0];
      const limit = this.itemsPerPage;

      const [liveToday, directToday] = await Promise.all([
        fetchLiveBids(
          "",
          1,
          limit,
          "original_scheduled_date",
          "asc",
          today,
          today,
        ),
        fetchDirectBids(
          "active",
          false,
          1,
          limit,
          "original_scheduled_date",
          "asc",
          today,
          today,
        ),
      ]);

      this.liveData = liveToday.bids || [];
      this.directData = directToday.bids || [];
      this.instantData = [];
      this.currentFilter = "today-deadlines";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("오늘 마감 조회 실패:", error);
      this.showError("오늘 마감 예정 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showUnsubmitted() {
    try {
      this.showLoading();
      const limit = this.itemsPerPage;
      const directCompleted = await fetchDirectBids(
        "completed",
        false,
        1,
        limit,
        "original_scheduled_date",
        "asc",
      );
      const unsubmitted =
        directCompleted.bids?.filter((bid) => !bid.submitted_to_platform) || [];

      this.liveData = [];
      this.directData = unsubmitted;
      this.instantData = [];
      this.currentFilter = "unsubmitted";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("미반영 조회 실패:", error);
      this.showError("플랫폼 미반영 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showSecondProposals() {
    try {
      this.showLoading();
      const limit = this.itemsPerPage;
      const liveSecond = await fetchLiveBids(
        "first",
        1,
        limit,
        "updated_at",
        "desc",
      );

      this.liveData = liveSecond.bids || [];
      this.directData = [];
      this.instantData = [];
      this.currentFilter = "second-proposals";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("2차 제안 조회 실패:", error);
      this.showError("2차 제안 대기 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showHighValue() {
    try {
      this.showLoading();
      const limit = this.itemsPerPage;
      // 모든 활성 입찰을 가져와서 프론트엔드에서 필터링
      const [liveActive, directActive, instantAll] = await Promise.all([
        fetchLiveBids("first,second,final", 1, limit, "updated_at", "desc"),
        fetchDirectBids("active", false, 1, limit, "updated_at", "desc"),
        fetchInstantPurchases("", 1, limit, "created_at", "desc"),
      ]);

      // 고액 입찰 필터링
      this.liveData = (liveActive.bids || []).filter((bid) => {
        const price =
          bid.final_price || bid.second_price || bid.first_price || 0;
        return price >= this.highValueThreshold;
      });

      this.directData = (directActive.bids || []).filter((bid) => {
        return (bid.current_price || 0) >= this.highValueThreshold;
      });

      this.instantData = (instantAll.purchases || []).filter((p) => {
        return (p.purchase_price || 0) >= this.highValueThreshold;
      });

      this.currentFilter = "high-value";
      this.renderUnifiedResults();
    } catch (error) {
      console.error("고액 입찰 조회 실패:", error);
      this.showError("고액 입찰 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showCompleted() {
    try {
      this.showLoading();
      const limit = this.itemsPerPage;
      const [liveCompleted, directCompleted, instantCompleted] =
        await Promise.all([
          fetchLiveBids("completed", 1, limit, "updated_at", "desc"),
          fetchDirectBids("completed", false, 1, limit, "updated_at", "desc"),
          fetchInstantPurchases("completed", 1, limit, "created_at", "desc"),
        ]);

      this.liveData = liveCompleted.bids || [];
      this.directData = directCompleted.bids || [];
      this.instantData = instantCompleted.purchases || [];
      this.currentFilter = "completed";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("완료 항목 조회 실패:", error);
      this.showError("완료 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  resetFilters() {
    this.currentFilter = "all";
    this.loadDefaultResults();
  }

  // 결과 탭 전환
  switchResultTab(type) {
    this.currentResultType = type;

    // 탭 활성화 상태 변경
    document.querySelectorAll(".result-tab").forEach((tab) => {
      tab.classList.remove("active");
    });
    document.querySelector(`[data-type="${type}"]`).classList.add("active");

    this.renderUnifiedResults();
  }

  // 통합 결과 렌더링
  renderUnifiedResults() {
    const tbody = document.getElementById("unifiedResults");
    let liveToShow = this.liveData || [];
    let directToShow = this.directData || [];
    let instantToShow = this.instantData || [];

    // 결과 탭에 따라 필터링
    if (this.currentResultType === "live") {
      directToShow = [];
      instantToShow = [];
    } else if (this.currentResultType === "direct") {
      liveToShow = [];
      instantToShow = [];
    } else if (this.currentResultType === "instant") {
      liveToShow = [];
      directToShow = [];
    }

    let html = "";

    // 현장 경매 렌더링
    liveToShow.forEach((bid) => {
      html += this.renderLiveBidRow(bid);
    });

    // 직접 경매 렌더링
    directToShow.forEach((bid) => {
      html += this.renderDirectBidRow(bid);
    });

    // 바로 구매 렌더링
    instantToShow.forEach((purchase) => {
      html += this.renderInstantPurchaseRow(purchase);
    });

    if (html === "") {
      html =
        '<tr><td colspan="8" class="text-center">결과가 없습니다.</td></tr>';
    }

    tbody.innerHTML = html;
    this.updateResultCounts(liveToShow, directToShow, instantToShow);
  }

  // 현장 경매 행 렌더링
  renderLiveBidRow(bid) {
    const timeInfo = this.calculateTimeRemaining(
      bid.item?.original_scheduled_date,
    );

    return `
      <tr class="live-bid-row" data-bid-type="live" data-bid-id="${bid.id}">
        <td><span class="badge badge-type-live">현장</span></td>
        <td>${this.renderItemInfo(bid)}</td>
        <td>${bid.login_id || bid.user_id}<br>(${bid.company_name || "-"})</td>
        <td>${this.renderLiveBidPrices(bid)}</td>
        <td>${this.renderLiveStatus(bid)}</td>
        <td>${this.renderAppraisalBadge(bid)}</td>
        <td>
          <div class="date-info">
            <div>${this.formatScheduledDate(
              bid.item?.original_scheduled_date,
            )}</div>
            <div class="time-remaining ${timeInfo.className}">${
              timeInfo.text
            }</div>
          </div>
        </td>
        <td>${this.renderLiveActions(bid)}</td>
      </tr>
    `;
  }

  // 직접 경매 행 렌더링
  renderDirectBidRow(bid) {
    return `
      <tr class="direct-bid-row" data-bid-type="direct" data-bid-id="${bid.id}">
        <td><span class="badge badge-type-direct">직접</span></td>
        <td>${this.renderItemInfo(bid)}</td>
        <td>${bid.login_id || bid.user_id}<br>(${bid.company_name || "-"})</td>
        <td>${this.renderDirectBidPrices(bid)}</td>
        <td>${this.renderDirectStatus(bid)}</td>
        <td>${this.renderAppraisalBadge(bid)}</td>
        <td>
          <div class="date-info">
            <div>${formatDate(bid.updated_at)}</div>
          </div>
        </td>
        <td>${this.renderDirectActions(bid)}</td>
      </tr>
    `;
  }

  // 바로 구매 행 렌더링
  renderInstantPurchaseRow(purchase) {
    // instant purchase API returns flat data (not nested item)
    const imageUrl = purchase.image || "/images/no-image.png";
    const itemId = purchase.item_id || "-";
    const aucNum = purchase.auc_num || 2;
    const itemUrl = this.getItemUrl({
      item_id: itemId,
      item: { auc_num: aucNum, additional_info: purchase.additional_info },
    });
    const scheduled = this.formatScheduledDate(
      purchase.original_scheduled_date || purchase.scheduled_date,
    );

    const itemInfoHtml = `
      <div class="item-info">
        <img src="${imageUrl}" alt="${purchase.original_title || ""}" class="item-thumbnail" />
        <div class="item-details">
          <div class="item-id">
            <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="item-id-link"
              onclick="return openAllProductDetail(event, this);"
              data-item-id="${escapeHtml(itemId)}"
              data-bid-type="instant"
              data-bid-status="${escapeHtml(purchase.status || "")}"
              data-auc-num="${escapeHtml(String(aucNum))}"
              data-image="${escapeHtml(imageUrl)}"
              data-title="${escapeHtml(purchase.original_title || "-")}"
              data-brand="${escapeHtml(purchase.brand || "-")}"
              data-category="${escapeHtml(purchase.category || "-")}"
              data-rank="${escapeHtml(purchase.rank || "-")}"
              data-accessory-code="-"
              data-scheduled="${escapeHtml(scheduled || "-")}"
              data-origin-url="${escapeHtml(itemUrl || "#")}"
            >${escapeHtml(itemId)}</a>
          </div>
          <div class="item-title">${purchase.original_title || purchase.title || "-"}</div>
          <div class="item-meta">
            <span>브랜드: ${purchase.brand || "-"}</span>
            <span>등급: ${purchase.rank || "-"}</span>
          </div>
        </div>
      </div>
    `;

    return `
      <tr class="instant-bid-row" data-bid-type="instant" data-bid-id="${purchase.id}">
        <td><span class="badge badge-type-instant">바로구매</span></td>
        <td>${itemInfoHtml}</td>
        <td>${purchase.login_id || purchase.user_id}<br>(${purchase.company_name || "-"})</td>
        <td>${this.renderInstantPrices(purchase)}</td>
        <td>${this.renderInstantStatus(purchase)}</td>
        <td>${this.renderAppraisalBadge(purchase)}</td>
        <td>
          <div class="date-info">
            <div>${formatDate(purchase.created_at)}</div>
          </div>
        </td>
        <td>${this.renderInstantActions(purchase)}</td>
      </tr>
    `;
  }

  // 바로 구매 가격 렌더링
  renderInstantPrices(purchase) {
    let html = '<div class="bid-prices">';
    if (purchase.purchase_price) {
      html += `<div class="price-item winning">구매가: ${formatCurrency(purchase.purchase_price, "JPY")}</div>`;
      if (purchase.auc_num && purchase.category) {
        const totalPrice = calculateTotalPrice(
          purchase.purchase_price,
          purchase.auc_num,
          purchase.category,
        );
        html += `<div class="price-item total">총액: ${formatCurrency(totalPrice, "KRW")}</div>`;
      }
    }
    html += "</div>";
    return html;
  }

  // 바로 구매 상태 렌더링
  renderInstantStatus(purchase) {
    const statusMap = {
      completed: { text: "완료", className: "badge-success" },
      cancelled: { text: "취소", className: "badge-secondary" },
    };
    const status = statusMap[purchase.status] || {
      text: purchase.status || "-",
      className: "badge",
    };
    let badge = `<span class="badge ${status.className}">${status.text}</span>`;
    if (purchase.shipping_status) {
      const shippingMap = {
        domestic_arrived: "국내도착",
        in_progress: "작업중",
        shipped: "출고됨",
      };
      badge += ` <span class="badge badge-info">${shippingMap[purchase.shipping_status] || purchase.shipping_status}</span>`;
    }
    return badge;
  }

  // 바로 구매 작업 버튼 렌더링
  renderInstantActions(purchase) {
    let html = '<div class="quick-actions-cell">';
    if (purchase.status === "completed" && !purchase.shipping_status) {
      html += `<button class="btn btn-sm btn-secondary" onclick="unifiedManager.quickAction('cancel-instant', ${purchase.id})">취소</button>`;
    }
    html += `<button class="btn btn-sm btn-outline" onclick="unifiedManager.goToDetailPage('instant', ${purchase.id})">상세 관리</button>`;
    html += "</div>";
    return html;
  }

  // 상품 정보 렌더링
  renderItemInfo(bid) {
    const imageUrl = bid.item?.image || "/images/no-image.png";
    const itemUrl = this.getItemUrl(bid);
    const scheduled = this.formatScheduledDate(
      bid.item?.original_scheduled_date || bid.item?.scheduled_date,
    );

    return `
      <div class="item-info">
        <img src="${imageUrl}" alt="${
          bid.item?.original_title || ""
        }" class="item-thumbnail" />
        <div class="item-details">
          <div class="item-id">
            <a
              href="${escapeHtml(itemUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="item-id-link"
              onclick="return openAllProductDetail(event, this);"
              data-item-id="${escapeHtml(bid.item_id || "")}"
              data-bid-type="${escapeHtml(bid.bid_type || "")}"
              data-bid-status="${escapeHtml(bid.status || "")}"
              data-auc-num="${escapeHtml(bid.item?.auc_num || "")}"
              data-image="${escapeHtml(imageUrl)}"
              data-title="${escapeHtml(bid.item?.original_title || "-")}"
              data-brand="${escapeHtml(bid.item?.brand || "-")}"
              data-category="${escapeHtml(bid.item?.category || "-")}"
              data-rank="${escapeHtml(bid.item?.rank || "-")}"
              data-accessory-code="${escapeHtml(bid.item?.accessory_code || "-")}"
              data-scheduled="${escapeHtml(scheduled || "-")}"
              data-origin-url="${escapeHtml(itemUrl || "#")}"
            >${escapeHtml(bid.item_id || "-")}</a>
          </div>
          <div class="item-title">${bid.item?.original_title || "-"}</div>
          <div class="item-meta">
            <span>브랜드: ${bid.item?.brand || "-"}</span>
            <span>등급: ${bid.item?.rank || "-"}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 상품 URL 생성
  getItemUrl(bid) {
    const linkFunc = {
      1: (itemId) =>
        `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
      2: (itemId) =>
        `https://bid.brand-auc.com/items/detail?uketsukeBng=${itemId}`,
      3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`,
      4: (itemId, additionalInfo) =>
        `https://auction.mekiki.ai/en/auction/${additionalInfo?.event_id}/${itemId}`,
      5: (itemId) => `https://penguin-auction.jp/product/detail/${itemId}/`,
    };

    let additionalInfo = bid.item?.additional_info || {};
    if (typeof additionalInfo === "string") {
      try {
        additionalInfo = JSON.parse(additionalInfo);
      } catch (e) {
        additionalInfo = {};
      }
    }

    if (bid.item?.auc_num && linkFunc[bid.item.auc_num]) {
      return linkFunc[bid.item.auc_num](bid.item_id, additionalInfo);
    }
    return "#";
  }

  // 현장 경매 가격 렌더링
  renderLiveBidPrices(bid) {
    let html = '<div class="bid-prices">';

    if (bid.first_price) {
      html += `<div class="price-item">1차: ${formatCurrency(
        bid.first_price,
        "JPY",
      )}</div>`;
    }
    if (bid.second_price) {
      html += `<div class="price-item">2차: ${formatCurrency(
        bid.second_price,
        "JPY",
      )}</div>`;
    }
    if (bid.final_price) {
      html += `<div class="price-item">최종: ${formatCurrency(
        bid.final_price,
        "JPY",
      )}</div>`;
    }
    if (bid.winning_price) {
      html += `<div class="price-item winning">낙찰: ${formatCurrency(
        bid.winning_price,
        "JPY",
      )}</div>`;
    }

    html += "</div>";
    return html;
  }

  // 직접 경매 가격 렌더링
  renderDirectBidPrices(bid) {
    let html = '<div class="bid-prices">';

    if (bid.current_price) {
      html += `<div class="price-item">입찰: ${formatCurrency(
        bid.current_price,
        "JPY",
      )}</div>`;

      // 수수료 포함 가격 계산
      if (bid.item?.auc_num && bid.item?.category) {
        const totalPrice = calculateTotalPrice(
          bid.current_price,
          bid.item.auc_num,
          bid.item.category,
        );
        html += `<div class="price-item total">총액: ${formatCurrency(
          totalPrice,
          "KRW",
        )}</div>`;
      }
    }

    if (bid.winning_price) {
      html += `<div class="price-item winning">낙찰: ${formatCurrency(
        bid.winning_price,
        "JPY",
      )}</div>`;
    }

    // 플랫폼 반영 상태
    const submittedBadge = bid.submitted_to_platform
      ? '<span class="badge badge-success">반영됨</span>'
      : '<span class="badge badge-warning">미반영</span>';
    html += `<div class="platform-status">${submittedBadge}</div>`;

    html += "</div>";
    return html;
  }

  // 현장 경매 상태 렌더링
  renderLiveStatus(bid) {
    const statusMap = {
      first: { text: "1차 입찰", className: "badge-info" },
      second: { text: "2차 제안", className: "badge-warning" },
      final: { text: "최종 입찰", className: "badge-danger" },
      completed: { text: "완료", className: "badge-success" },
      cancelled: { text: "낙찰 실패", className: "badge-secondary" },
    };

    const status = statusMap[bid.status] || {
      text: bid.status,
      className: "badge",
    };
    return `<span class="badge ${status.className}">${status.text}</span>`;
  }

  // 직접 경매 상태 렌더링
  renderDirectStatus(bid) {
    const statusMap = {
      active: { text: "활성", className: "badge-info" },
      completed: { text: "완료", className: "badge-success" },
      cancelled: { text: "낙찰 실패", className: "badge-secondary" },
    };

    const status = statusMap[bid.status] || {
      text: bid.status,
      className: "badge",
    };
    return `<span class="badge ${status.className}">${status.text}</span>`;
  }

  // 감정서 발급 여부 렌더링
  renderAppraisalBadge(bid) {
    if (bid.appr_id) {
      return '<span class="badge badge-success">발급됨</span>';
    } else {
      return '<span class="badge badge-secondary">미발급</span>';
    }
  }

  // 현장 경매 작업 버튼 렌더링
  renderLiveActions(bid) {
    let html = '<div class="quick-actions-cell">';

    if (bid.status === "first") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('propose-second', ${bid.id})">2차 제안</button>`;
    } else if (bid.status === "final") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('complete-live', ${bid.id})">낙찰 완료</button>`;
      html += `<button class="btn btn-sm btn-secondary" onclick="unifiedManager.quickAction('cancel-live', ${bid.id})">낙찰 실패</button>`;
    }

    html += `<button class="btn btn-sm btn-outline" onclick="unifiedManager.goToDetailPage('live', ${bid.id})">상세 관리</button>`;
    html += "</div>";

    return html;
  }

  // 직접 경매 작업 버튼 렌더링
  renderDirectActions(bid) {
    let html = '<div class="quick-actions-cell">';

    if (bid.status === "active") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('complete-direct', ${bid.id})">낙찰 완료</button>`;
      html += `<button class="btn btn-sm btn-secondary" onclick="unifiedManager.quickAction('cancel-direct', ${bid.id})">낙찰 실패</button>`;
    }

    if (!bid.submitted_to_platform && bid.status === "completed") {
      html += `<button class="btn btn-sm btn-warning" onclick="unifiedManager.quickAction('mark-submitted', ${bid.id})">반영 표시</button>`;
    }

    html += `<button class="btn btn-sm btn-outline" onclick="unifiedManager.goToDetailPage('direct', ${bid.id})">상세 관리</button>`;
    html += "</div>";

    return html;
  }

  // 빠른 작업 실행
  quickAction(action, bidId) {
    this.showQuickActionModal(action, bidId);
  }

  // 빠른 작업 모달 표시
  showQuickActionModal(action, bidId) {
    const actionNames = {
      "propose-second": "2차 제안가 제안",
      "complete-live": "현장 경매 낙찰 완료",
      "cancel-live": "현장 경매 낙찰 실패",
      "complete-direct": "직접 경매 낙찰 완료",
      "cancel-direct": "직접 경매 낙찰 실패",
      "cancel-instant": "바로 구매 취소",
      "mark-submitted": "플랫폼 반영 표시",
    };

    document.getElementById("quickActionTitle").textContent =
      actionNames[action] || "작업 확인";
    const executeHereActions = [
      "complete-live",
      "complete-direct",
      "cancel-live",
      "cancel-direct",
      "cancel-instant",
      "mark-submitted",
    ];
    const shouldExecuteHere = executeHereActions.includes(action);
    document.getElementById("quickActionMessage").textContent =
      shouldExecuteHere
        ? `${actionNames[action]}을 현재 화면에서 바로 처리할까요?`
        : `${actionNames[action]}을 위해 상세 관리 페이지로 이동하시겠습니까?`;

    document.getElementById("confirmQuickAction").onclick = async () => {
      this.closeModal();
      if (shouldExecuteHere) {
        await this.executeQuickAction(action, bidId);
        return;
      }
      if (action.includes("live")) {
        this.goToDetailPage("live", bidId);
      } else if (action.includes("instant")) {
        this.goToDetailPage("instant", bidId);
      } else {
        this.goToDetailPage("direct", bidId);
      }
    };

    this.openModal("quickActionModal");
  }

  async executeQuickAction(action, bidId) {
    try {
      if (action === "complete-live") {
        const bid = (this.liveData || []).find(
          (b) => Number(b.id) === Number(bidId),
        );
        const defaultPrice =
          Number(
            bid?.winning_price ||
              bid?.final_price ||
              bid?.second_price ||
              bid?.first_price ||
              0,
          ) || "";
        const input = prompt(
          "낙찰가(엔)를 입력하세요. 비워두면 현재 값으로 처리됩니다.",
          defaultPrice,
        );
        if (input === null) return;
        const winningPrice = String(input).trim()
          ? Number(String(input).replace(/,/g, ""))
          : undefined;
        if (
          winningPrice !== undefined &&
          (!Number.isFinite(winningPrice) || winningPrice < 0)
        ) {
          alert("낙찰가는 숫자로 입력해주세요.");
          return;
        }
        await completeBid(Number(bidId), winningPrice);
      } else if (action === "complete-direct") {
        const bid = (this.directData || []).find(
          (b) => Number(b.id) === Number(bidId),
        );
        const defaultPrice =
          Number(bid?.winning_price || bid?.current_price || 0) || "";
        const input = prompt(
          "낙찰가(엔)를 입력하세요. 비워두면 현재 값으로 처리됩니다.",
          defaultPrice,
        );
        if (input === null) return;
        const winningPrice = String(input).trim()
          ? Number(String(input).replace(/,/g, ""))
          : undefined;
        if (
          winningPrice !== undefined &&
          (!Number.isFinite(winningPrice) || winningPrice < 0)
        ) {
          alert("낙찰가는 숫자로 입력해주세요.");
          return;
        }
        await completeDirectBid(Number(bidId), winningPrice);
      } else if (action === "cancel-live") {
        await cancelBid(Number(bidId));
        alert("현장 경매 낙찰 실패 처리되었습니다.");
      } else if (action === "cancel-direct") {
        await cancelDirectBid(Number(bidId));
        alert("직접 경매 낙찰 실패 처리되었습니다.");
      } else if (action === "cancel-instant") {
        await cancelInstantPurchase(Number(bidId));
        alert("바로 구매가 취소되었습니다.");
      } else if (action === "mark-submitted") {
        await markDirectBidAsSubmitted(Number(bidId));
        alert("플랫폼 반영 완료로 표시했습니다.");
      } else {
        return;
      }

      await this.loadDashboardData();
      await this.refreshByCurrentFilter();
    } catch (error) {
      console.error("빠른 작업 실행 실패:", error);
      alert("처리 중 오류가 발생했습니다.");
    }
  }

  async refreshByCurrentFilter() {
    const filter = this.currentFilter;
    if (filter === "today-deadlines") return this.showTodayDeadlines();
    if (filter === "unsubmitted") return this.showUnsubmitted();
    if (filter === "second-proposals") return this.showSecondProposals();
    if (filter === "high-value") return this.showHighValue();
    if (filter === "completed") return this.showCompleted();
    if (filter === "search") return this.executeUnifiedSearch();
    return this.loadDefaultResults();
  }

  // 상세 관리 페이지로 이동
  goToDetailPage(type, bidId) {
    if (type === "live") {
      window.location.href = `/admin/live-bids?highlight=${bidId}`;
    } else if (type === "instant") {
      window.location.href = `/admin/instant-purchases?highlight=${bidId}`;
    } else {
      window.location.href = `/admin/direct-bids?highlight=${bidId}`;
    }
  }

  // 결과 카운트 업데이트
  updateResultCounts(
    liveRows = this.liveData,
    directRows = this.directData,
    instantRows = this.instantData,
  ) {
    const liveCount = liveRows?.length || 0;
    const directCount = directRows?.length || 0;
    const instantCount = instantRows?.length || 0;
    const totalCount = liveCount + directCount + instantCount;

    document.getElementById("allResultCount").textContent = totalCount;
    document.getElementById("liveResultCount").textContent = liveCount;
    document.getElementById("directResultCount").textContent = directCount;
    const instantEl = document.getElementById("instantResultCount");
    if (instantEl) instantEl.textContent = instantCount;

    // 결과 정보 업데이트
    let filterText = "";
    switch (this.currentFilter) {
      case "search":
        filterText = "검색 결과";
        break;
      case "today-deadlines":
        filterText = "오늘 마감 예정";
        break;
      case "unsubmitted":
        filterText = "플랫폼 미반영";
        break;
      case "second-proposals":
        filterText = "2차 제안 대기";
        break;
      case "high-value":
        filterText = "고액 입찰";
        break;
      case "completed":
        filterText = "완료 항목";
        break;
      default:
        filterText = "전체 결과";
    }

    document.getElementById("resultsCount").textContent =
      `${filterText}: 총 ${totalCount}건 (현장 ${liveCount}건, 직접 ${directCount}건, 바로구매 ${instantCount}건)`;
  }

  // 날짜 포맷팅 - 공통 함수 활용
  formatScheduledDate(dateString) {
    if (!dateString) return "-";
    return window.formatDateTime(dateString);
  }

  // 더보기 기능 (향후 구현 시 사용)
  loadMoreResults() {
    // 현재는 구현하지 않음
    console.log("더보기 기능은 향후 구현 예정");
  }

  // 로딩 표시
  showLoading() {
    document.getElementById("unifiedResults").innerHTML =
      '<tr><td colspan="8" class="text-center">데이터를 불러오는 중입니다...</td></tr>';
  }

  // 에러 표시
  showError(message) {
    document.getElementById("unifiedResults").innerHTML =
      `<tr><td colspan="8" class="text-center error">${message}</td></tr>`;
  }

  // 모달 열기 - 공통 함수 활용
  openModal(modalId) {
    const modal = window.setupModal(modalId);
    modal.show();
  }

  // 모달 닫기 - 공통 함수 활용
  closeModal() {
    document.querySelectorAll(".modal-overlay").forEach((modal) => {
      modal.classList.remove("active");
    });
  }
}

let allDetailImages = [];
let allDetailImageIndex = 0;

function setAllDetailText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value || "-";
}

function setAllDetailImage(src) {
  const img = document.getElementById("allDetailMainImage");
  if (!img) return;
  img.classList.remove("zoom-active");
  img.style.transformOrigin = "center center";
  img.src = src || "/images/no-image.png";
}

function setAllDetailOrigin(url) {
  const link = document.getElementById("allDetailOriginLink");
  if (!link) return;
  const safeUrl = url && url !== "#" ? url : "";
  link.href = safeUrl || "#";
  link.style.pointerEvents = safeUrl ? "auto" : "none";
  link.style.opacity = safeUrl ? "1" : "0.5";
}

function applyAllDetailData(data = {}) {
  setAllDetailText("allDetailItemId", data.itemId || "-");
  setAllDetailText("allDetailTitle", data.title || "-");
  setAllDetailText("allDetailBrand", data.brand || "-");
  setAllDetailText("allDetailCategory", data.category || "-");
  setAllDetailText("allDetailRank", data.rank || "-");
  setAllDetailText("allDetailScheduled", data.scheduled || "-");
  setAllDetailText("allDetailAccessoryCode", data.accessoryCode || "-");
  setAllDetailText("allDetailDescription", data.description || "-");
  setAllDetailOrigin(data.originUrl || "#");
  setAllDetailImage(data.image || "/images/no-image.png");
}

function renderAllDetailThumbs() {
  const wrap = document.getElementById("allDetailThumbs");
  if (!wrap) return;
  wrap.innerHTML = "";
  allDetailImages.forEach((src, idx) => {
    const activeClass = idx === allDetailImageIndex ? "active" : "";
    wrap.insertAdjacentHTML(
      "beforeend",
      `
        <button type="button" class="live-detail-thumb ${activeClass}" data-index="${idx}">
          <img src="${escapeHtml(src)}" alt="썸네일 ${idx + 1}" />
        </button>
      `,
    );
  });
  wrap.querySelectorAll(".live-detail-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index || 0);
      showAllDetailImageAt(idx);
    });
  });
}

function updateAllDetailNavState() {
  const prevBtn = document.getElementById("allDetailPrevBtn");
  const nextBtn = document.getElementById("allDetailNextBtn");
  if (prevBtn) prevBtn.disabled = allDetailImageIndex <= 0;
  if (nextBtn)
    nextBtn.disabled = allDetailImageIndex >= allDetailImages.length - 1;
}

function showAllDetailImageAt(index) {
  if (!allDetailImages.length) return;
  if (index < 0 || index >= allDetailImages.length) return;
  allDetailImageIndex = index;
  setAllDetailImage(allDetailImages[allDetailImageIndex]);
  renderAllDetailThumbs();
  updateAllDetailNavState();
}

function setAllDetailImages(images) {
  const normalized = Array.isArray(images)
    ? images.filter((x) => String(x || "").trim())
    : [];
  allDetailImages = normalized.length ? normalized : ["/images/no-image.png"];
  allDetailImageIndex = 0;
  showAllDetailImageAt(0);
}

function bindAllDetailGalleryControls() {
  document.getElementById("allDetailPrevBtn")?.addEventListener("click", () => {
    showAllDetailImageAt(allDetailImageIndex - 1);
  });
  document.getElementById("allDetailNextBtn")?.addEventListener("click", () => {
    showAllDetailImageAt(allDetailImageIndex + 1);
  });
}

function bindAllDetailImageZoomControls() {
  const wrap = document.getElementById("allDetailMainImageWrap");
  const img = document.getElementById("allDetailMainImage");
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

async function openAllProductDetail(event, anchorEl) {
  if (event) event.preventDefault();
  const anchor = anchorEl;
  if (!anchor) return false;

  const itemId = String(anchor.dataset.itemId || "").trim();
  const aucNum = String(anchor.dataset.aucNum || "").trim();
  const modal = window.setupModal("allProductDetailModal");
  if (!modal || !itemId) return false;

  applyAllDetailData({
    itemId,
    title: anchor.dataset.title || "-",
    brand: anchor.dataset.brand || "-",
    category: anchor.dataset.category || "-",
    rank: anchor.dataset.rank || "-",
    accessoryCode: anchor.dataset.accessoryCode || "-",
    scheduled: anchor.dataset.scheduled || "-",
    description: "상세 정보를 불러오는 중입니다...",
    image: anchor.dataset.image || "/images/no-image.png",
    originUrl: anchor.dataset.originUrl || "#",
  });
  setAllDetailImages([anchor.dataset.image || "/images/no-image.png"]);
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
        // ignore json parse error
      }
    }
    setAllDetailImages(detailImages);

    applyAllDetailData({
      itemId,
      title: detail?.title || anchor.dataset.title || "-",
      brand: detail?.brand || anchor.dataset.brand || "-",
      category: detail?.category || anchor.dataset.category || "-",
      rank: detail?.rank || anchor.dataset.rank || "-",
      accessoryCode:
        detail?.accessory_code || anchor.dataset.accessoryCode || "-",
      scheduled: detail?.scheduled_date
        ? formatDateTime(detail.scheduled_date, true)
        : anchor.dataset.scheduled || "-",
      description:
        detail?.description_ko ||
        detail?.description ||
        "설명 정보가 없습니다.",
      image: detailImage,
      originUrl: anchor.dataset.originUrl || "#",
    });
  } catch (error) {
    console.error("상품 상세 조회 실패:", error);
    setAllDetailText(
      "allDetailDescription",
      "상세 정보를 불러오지 못했습니다.",
    );
  }
  return false;
}

// 전역 변수로 매니저 인스턴스 생성
let unifiedManager;

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  bindAllDetailGalleryControls();
  bindAllDetailImageZoomControls();
  unifiedManager = new UnifiedAuctionManager();
  unifiedManager.init();
});

// 전역 함수들 (HTML에서 직접 호출)
function showTodayDeadlines() {
  unifiedManager.showTodayDeadlines();
}

function showUnsubmitted() {
  unifiedManager.showUnsubmitted();
}

function showSecondProposals() {
  unifiedManager.showSecondProposals();
}

function showHighValue() {
  unifiedManager.showHighValue();
}

function showCompleted() {
  unifiedManager.showCompleted();
}

function resetFilters() {
  unifiedManager.resetFilters();
}
