// public/js/bid-products.js

// 상태 관리
window.state = {
  bidType: "live", // 경매 타입: live, direct, instant
  status: "all", // 상태: all, active(진행 중), completed, cancelled(낙찰 실패), higher-bid(직접경매용)
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 10, // 페이지당 아이템 수
  sortBy: "updated_at", // 정렬 기준
  sortOrder: "desc", // 정렬 순서
  keyword: "", // 검색 키워드
  liveBids: [], // 현장 경매 데이터
  directBids: [], // 직접 경매 데이터
  instantPurchases: [], // 바로 구매 데이터
  combinedResults: [], // 결합된 결과
  filteredResults: [], // 필터링된 결과
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
};

// Core 모듈 참조
const core = window.BidProductsCore;

// 초기화 함수
async function initialize() {
  try {
    // API 초기화
    await window.API.initialize();

    // 환율 정보 가져오기
    await fetchExchangeRate();

    // 인증 상태 확인
    window.state.isAuthenticated = await window.AuthManager.checkAuthStatus();

    if (!window.state.isAuthenticated) {
      window.AuthManager.redirectIfNotAuthenticated();
      return;
    }

    // Core에 페이지 상태 전달
    core.setPageState(window.state);

    // URL 파라미터에서 초기 상태 로드
    const stateKeys = [
      "bidType",
      "status",
      "dateRange",
      "currentPage",
      "sortBy",
      "sortOrder",
      "keyword",
    ];
    const urlState = window.URLStateManager.loadFromURL(
      window.state,
      stateKeys,
    );
    Object.assign(window.state, urlState);

    updateUIFromState();
    updateStatusFilterUI();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 초기 데이터 로드
    await fetchProducts();

    // BidManager 초기화
    if (window.BidManager) {
      window.BidManager.initialize(
        window.state.isAuthenticated,
        window.state.filteredResults.map((item) => item.item),
      );
    }

    // 입찰 이벤트 리스너 설정
    setupBidEventListeners();

    // 타이머 업데이트 시작
    if (window.BidManager) {
      window.BidManager.startTimerUpdates();
    }
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// 입찰 이벤트 리스너 설정
function setupBidEventListeners() {
  window.addEventListener("bidSuccess", async function (e) {
    const { itemId, type } = e.detail;
    await fetchProducts();

    // 상세 모달이 열려있는 경우 해당 항목 업데이트
    const modal = document.getElementById("detailModal");
    if (modal && modal.style.display === "flex") {
      const modalItemId =
        document.querySelector(".modal-title")?.dataset?.itemId;
      if (modalItemId === itemId) {
        core.showProductDetails(itemId);
      }
    }
  });
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.checked = radio.value === window.state.bidType;
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.checked = radio.value === window.state.status;
  });

  // 날짜 범위 선택
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = window.state.dateRange;

  // 검색어 입력 필드
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = window.state.keyword;

  // 정렬 버튼 업데이트
  core.updateSortButtonsUI();
}

// 상품 데이터 가져오기
async function fetchProducts() {
  if (!window.state.isAuthenticated) {
    return;
  }

  core.setPageState(window.state);
  core.toggleLoading(true);

  try {
    // 상태 파라미터 준비
    let statusParam;
    switch (window.state.status) {
      case "first":
        // 현장경매: 1차 입찰
        statusParam = "first";
        break;
      case "second":
        // 현장경매: 2차 제안
        statusParam = "second";
        break;
      case "final":
        // 현장경매: 최종 입찰
        statusParam = "final";
        break;
      case "active":
        // 직접경매: 입찰 진행중
        statusParam = "active";
        break;
      case "higher-bid":
        // 직접경매: cancelled만
        statusParam = "cancelled";
        break;
      case "completed":
        statusParam = core.STATUS_GROUPS.COMPLETED.join(",");
        break;
      case "cancelled":
        // 낙찰 실패: 모든 상태 (클라이언트에서 마감 여부로 필터링)
        statusParam = core.STATUS_GROUPS.ALL.join(",");
        break;
      case "all":
      default:
        statusParam = core.STATUS_GROUPS.ALL.join(",");
        break;
    }

    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - window.state.dateRange);
    const fromDate = formatDate(dateLimit);

    // 전체 데이터 요청 (페이지네이션은 클라이언트에서)
    const params = {
      status: statusParam,
      fromDate: fromDate,
      page: 1,
      limit: 0, // 전체 데이터
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
    };

    if (window.state.keyword?.trim()) {
      params.search = window.state.keyword.trim();
    }

    const queryString = window.API.createURLParams(params);

    // 경매 타입에 따라 API 호출
    if (window.state.bidType === "direct") {
      const directResults = await window.API.fetchAPI(
        `/direct-bids?${queryString}`,
      );
      window.state.directBids = directResults.bids || [];
      window.state.liveBids = [];
      window.state.instantPurchases = [];
    } else if (window.state.bidType === "instant") {
      const instantResults = await window.API.fetchAPI(
        `/instant-purchases?${queryString}`,
      );
      window.state.instantPurchases = instantResults.purchases || [];
      window.state.liveBids = [];
      window.state.directBids = [];
    } else {
      window.state.bidType = "live";
      document.getElementById("bidType-live").checked = true;

      const liveResults = await window.API.fetchAPI(
        `/live-bids?${queryString}`,
      );
      window.state.liveBids = liveResults.bids || [];
      window.state.directBids = [];
      window.state.instantPurchases = [];
    }

    // 타입 정보 추가
    const liveBidsWithType = window.state.liveBids
      .filter((bid) => bid.item && bid.item.item_id) // null 제거
      .map((bid) => ({
        ...bid,
        type: "live",
        displayStatus: bid.status,
      }));

    const directBidsWithType = window.state.directBids
      .filter((bid) => bid.item && bid.item.item_id) // null 제거
      .map((bid) => ({
        ...bid,
        type: "direct",
        displayStatus: bid.status,
      }));

    const instantWithType = window.state.instantPurchases
      .filter((p) => p.item && p.item.item_id)
      .map((p) => ({
        ...p,
        type: "instant",
        displayStatus: p.status,
        winning_price: p.purchase_price,
      }));

    window.state.combinedResults = [
      ...liveBidsWithType,
      ...directBidsWithType,
      ...instantWithType,
    ];

    // 클라이언트 필터링은 displayProducts에서 수행됨
    // totalItems와 totalPages는 applyClientFilters에서 계산됨

    // BidManager 업데이트
    if (window.BidManager) {
      window.BidManager.updateBidData(
        window.state.liveBids,
        window.state.directBids,
        window.state.instantPurchases,
      );
    }

    // URL 업데이트
    const defaultState = {
      bidType: "live",
      status: "all",
      dateRange: 30,
      currentPage: 1,
      sortBy: "updated_at",
      sortOrder: "desc",
      keyword: "",
    };
    window.URLStateManager.updateURL(window.state, defaultState);

    // 결과 표시 (여기서 필터링 + 페이지네이션)
    core.displayProducts();

    // 페이지네이션 업데이트
    core.updatePagination(handlePageChange);

    core.updateSortButtonsUI();

    if (window.BidManager) {
      // filteredResults의 item만 추출하여 currentData 업데이트
      const items = window.state.filteredResults
        .map((result) => result.item)
        .filter((item) => item && item.item_id);

      window.BidManager.updateCurrentData(items);
      window.BidManager.startTimerUpdates();
      window.BidManager.initializePriceCalculators();
    }
  } catch (error) {
    console.error("상품 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("productList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    core.toggleLoading(false);
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      window.state.bidType = e.target.value;
      window.state.currentPage = 1;

      // UI 업데이트
      updateStatusFilterUI();

      fetchProducts();
    });
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      window.state.status = e.target.value;
      window.state.currentPage = 1;
      fetchProducts();
    });
  });

  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    window.state.dateRange = parseInt(e.target.value);
    window.state.currentPage = 1;
    fetchProducts();
  });

  // 검색 폼
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const clearSearchBtn = document.getElementById("clearSearch");

  // 검색 입력 필드 값 변화 감지
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (clearSearchBtn) {
        clearSearchBtn.style.display = searchInput.value ? "flex" : "none";
      }
    });
  }

  // 검색 폼 제출
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (searchInput) {
        window.state.keyword = searchInput.value.trim();
        window.state.currentPage = 1;
        fetchProducts();
      }
    });
  }

  // 검색 초기화 버튼
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        clearSearchBtn.style.display = "none";
        window.state.keyword = "";
        window.state.currentPage = 1;
        fetchProducts();
      }
    });
  }

  // 정렬 버튼들
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      handleSortChange(btn.dataset.sort);
    });
  });

  // 필터 적용 버튼
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    window.state.currentPage = 1;
    fetchProducts();
  });

  // 필터 초기화 버튼
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
  });

  // 로그아웃 버튼
  document.getElementById("signoutBtn")?.addEventListener("click", () => {
    window.AuthManager.handleSignout();
  });

  // 상세 모달 닫기 버튼
  const closeBtn = document.querySelector(".modal .close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("detailModal").style.display = "none";
    });
  }

  // 외부 클릭 시 모달 닫기
  window.addEventListener("click", (e) => {
    const modal = document.getElementById("detailModal");
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (window.state.sortBy === sortKey) {
    window.state.sortOrder = window.state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    window.state.sortBy = sortKey;
    window.state.sortOrder = "desc";
  }

  window.state.currentPage = 1;

  // 정렬은 API 재호출 필요
  fetchProducts();
}

// 상태 필터 UI 업데이트 함수
function updateStatusFilterUI() {
  const activeWrapper = document.getElementById("status-active-wrapper");
  const higherBidWrapper = document.getElementById("status-higher-bid-wrapper");
  const firstWrapper = document.getElementById("status-first-wrapper");
  const secondWrapper = document.getElementById("status-second-wrapper");
  const finalWrapper = document.getElementById("status-final-wrapper");

  if (window.state.bidType === "instant") {
    // 바로 구매: 상태 필터 모두 숨김 (완료/취소만)
    if (activeWrapper) activeWrapper.style.display = "none";
    if (higherBidWrapper) higherBidWrapper.style.display = "none";
    if (firstWrapper) firstWrapper.style.display = "none";
    if (secondWrapper) secondWrapper.style.display = "none";
    if (finalWrapper) finalWrapper.style.display = "none";

    if (
      ["first", "second", "final", "active", "higher-bid"].includes(
        window.state.status,
      )
    ) {
      window.state.status = "all";
      const allRadio = document.getElementById("status-all");
      if (allRadio) allRadio.checked = true;
    }
  } else if (window.state.bidType === "direct") {
    // 직접 경매: 입찰 진행중, 더 높은 입찰 존재 표시
    if (activeWrapper) activeWrapper.style.display = "block";
    if (higherBidWrapper) higherBidWrapper.style.display = "block";
    if (firstWrapper) firstWrapper.style.display = "none";
    if (secondWrapper) secondWrapper.style.display = "none";
    if (finalWrapper) finalWrapper.style.display = "none";

    // 현재 선택이 first/second/final이면 all로 변경
    if (["first", "second", "final"].includes(window.state.status)) {
      window.state.status = "all";
      const allRadio = document.getElementById("status-all");
      if (allRadio) allRadio.checked = true;
    }
  } else {
    // 현장 경매: 1차/2차/최종 입찰 표시
    if (activeWrapper) activeWrapper.style.display = "none";
    if (higherBidWrapper) higherBidWrapper.style.display = "none";
    if (firstWrapper) firstWrapper.style.display = "block";
    if (secondWrapper) secondWrapper.style.display = "block";
    if (finalWrapper) finalWrapper.style.display = "block";

    // 현재 선택이 active/higher-bid면 all로 변경
    if (["active", "higher-bid"].includes(window.state.status)) {
      window.state.status = "all";
      const allRadio = document.getElementById("status-all");
      if (allRadio) allRadio.checked = true;
    }
  }
}

// 필터 초기화
function resetFilters() {
  window.state.bidType = "live";
  window.state.status = "all";
  window.state.dateRange = 30;
  window.state.keyword = "";
  window.state.currentPage = 1;
  window.state.sortBy = "updated_at";
  window.state.sortOrder = "desc";

  core.setPageState(window.state);
  updateUIFromState();
  updateStatusFilterUI();
  fetchProducts();
}

// 페이지 변경 처리
async function handlePageChange(page) {
  page = parseInt(page, 10);

  if (
    page === window.state.currentPage ||
    page < 1 ||
    page > window.state.totalPages
  ) {
    return;
  }

  window.state.currentPage = page;

  // API 재호출 없이 클라이언트에서만 처리
  core.setPageState(window.state);
  core.displayProducts();
  core.updatePagination(handlePageChange);

  window.scrollTo(0, 0);
}

// 네비게이션 버튼 설정
function setupNavButtons() {
  // 각 네비게이션 버튼에 이벤트 리스너 추가
  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button) => {
    // 기존 onclick 속성 외에 추가 처리가 필요한 경우를 위한 공간
  });
}

// bid-products.js에 추가할 코드 (products.js와 동일)
window.bidLoadingUI = {
  showBidLoading: function (buttonElement) {
    // 기존 버튼 텍스트 저장
    buttonElement.dataset.originalText = buttonElement.textContent;

    // 로딩 아이콘 추가
    buttonElement.innerHTML = '<span class="spinner"></span> 처리 중...';
    buttonElement.disabled = true;
    buttonElement.classList.add("loading");
  },

  hideBidLoading: function (buttonElement) {
    // 원래 텍스트로 복원
    buttonElement.textContent =
      buttonElement.dataset.originalText || "입찰하기";
    buttonElement.disabled = false;
    buttonElement.classList.remove("loading");
  },
};

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", function () {
  initialize();
});
