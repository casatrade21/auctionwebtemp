// public/js/recommend.js

// 추천 상품 페이지 설정
const recommendPageConfig = {
  type: "recommend",
  apiEndpoint: "/data",
  detailEndpoint: "/detail/item-details/",
  template: "product-card-template",

  features: {
    bidding: true,
    wishlist: true,
    realtime: true,
    adminEdit: false,
    auctionTypes: true,
    scheduledDates: true,
    bidItemsOnly: true,
    excludeExpired: true,
  },

  // 추천 상품용 필터 API - recommend=true 파라미터 추가
  filters: {
    brands: "/data/brands-with-count?recommend=true",
    categories: "/data/categories",
    dates: "/data/scheduled-dates-with-count?recommend=true",
    ranks: "/data/ranks?recommend=true",
    aucNums: "/data/auc-nums?recommend=true",
  },

  initialState: {
    selectedBrands: [],
    selectedCategories: [],
    selectedDates: [],
    selectedRanks: [],
    selectedAucNums: [],
    selectedAuctionTypes: [],
    selectedFavoriteNumbers: [],
    sortBy: "recommend", // 기본 정렬을 추천순으로
    sortOrder: "desc",
    currentPage: 1,
    itemsPerPage: 20,
    totalItems: 0,
    totalPages: 0,
    searchTerm: "",
    wishlist: [],
    liveBidData: [],
    directBidData: [],
    instantPurchaseData: [],
    currentData: [],
    images: [],
    currentImageIndex: 0,
    showBidItemsOnly: false,
    excludeExpired: true,
    minRecommend: 1, // 추천 상품만 표시
  },

  tooltips: {
    enabled: true,
    cardTooltips: [
      // 기존 products.js의 툴팁 설정과 동일
      {
        selector: ".price-detail",
        type: "price-detail",
        condition: () => true,
        message:
          "까사트레이드 수수료를 제외한 모든 비용\n(관부가세, 출품사수수료, 현지세금)이\n반영된 실시간 원화 금액입니다.",
      },
      {
        selector: ".info-cell:nth-child(2) .info-label",
        type: "direct-realtime",
        textCondition: "실시간",
        condition: (item) => item.bid_type === "direct",
        message:
          "실시간 경쟁 입찰가입니다.\n마감이 가까울수록 급변할 수 있습니다.",
      },
      {
        selector: ".info-cell:nth-child(2) .info-label",
        type: "live-starting",
        textCondition: "시작 금액",
        condition: (item) => item.bid_type === "live",
        message:
          "표시 금액은 사전입찰 시작가이며,\n실제 현장 낙찰가는 경합 정도에 따라\n크게 달라질 수 있습니다.",
      },
      {
        selector: ".bid-input-label",
        type: "live-first-bid",
        textCondition: "1차금액 입력",
        condition: (item, bidInfo) =>
          item.bid_type === "live" && !bidInfo?.first_price,
        message:
          "현장경매 참여를 위한 1차 입찰 금액입니다.\n이 금액으로 현장경매에 참여할 수 있습니다.",
      },
      {
        selector: ".info-cell:nth-child(3) .info-label",
        type: "live-second-proposal",
        textCondition: "2차 제안",
        condition: (item, bidInfo) =>
          item.bid_type === "live" &&
          bidInfo?.first_price &&
          !bidInfo?.second_price &&
          !bidInfo?.final_price,
        message:
          "현장에서 경합이 발생할 경우\n자동으로 제안될 최대 금액입니다.",
      },
      {
        selector: ".info-cell:nth-child(3) .info-label",
        type: "live-max-amount",
        textCondition: "2차 제안",
        condition: (item, bidInfo) =>
          item.bid_type === "live" &&
          bidInfo?.first_price &&
          bidInfo?.second_price &&
          !bidInfo?.final_price,
        message:
          "현장에서 경합이 발생할 경우\n자동으로 제안될 최대 금액입니다.",
      },
      {
        selector: ".bid-input-label",
        type: "live-final-bid",
        textCondition: "최종입찰 금액",
        condition: (item, bidInfo) =>
          item.bid_type === "live" &&
          bidInfo?.first_price &&
          bidInfo?.second_price &&
          !bidInfo?.final_price,
        message:
          "현장경매 최종 입찰 금액입니다.\n이 금액으로 최종 경쟁에 참여합니다.",
      },
      {
        selector: ".timer-info-icon",
        type: "timer-info",
        condition: (item) =>
          item.bid_type == "direct" &&
          (item.auc_num == 1 || item.auc_num == 3 || item.auc_num == 5),
        message:
          "마감 전 5분 입찰 발생 시\n5분씩 자동 연장\n\n추가 입찰 없을 시\n마지막 입찰 금액 낙찰",
      },
      {
        selector: ".quick-bid-buttons.star-auction .bid-info-tooltip-trigger",
        type: "star-bid-info",
        condition: (item) => item.auc_num == 3,
        message: "해당 상품은 금액대별 최소금액으로 입찰됩니다.",
      },
    ],

    modalTooltips: [
      {
        selector: ".price-detail",
        type: "price-detail",
        condition: () => true,
        message:
          "까사트레이드 수수료를 제외한 모든 비용\n(관부가세, 출품사수수료, 현지세금)이\n반영된 실시간 원화 금액입니다.",
      },
      {
        selector: ".info-price-detail",
        type: "price-detail",
        condition: () => true,
        message:
          "까사트레이드 수수료를 제외한 모든 비용\n(관부가세, 출품사수수료, 현지세금)이\n반영된 실시간 원화 금액입니다.",
      },
      {
        selector: ".price-details-container",
        type: "price-detail",
        condition: () => true,
        message:
          "까사트레이드 수수료를 제외한 모든 비용\n(관부가세, 출품사수수료, 현지세금)이\n반영된 실시간 원화 금액입니다.",
      },
      {
        selector: ".bid-input-label",
        type: "live-first-bid",
        textCondition: "1차금액 입력",
        condition: (item, bidInfo) =>
          item.bid_type === "live" && !bidInfo?.first_price,
        message:
          "현장경매 참여를 위한 1차 입찰 금액입니다.\n이 금액으로 현장경매에 참여할 수 있습니다.",
      },
      {
        selector: ".bid-price-info p",
        type: "live-second-proposal",
        textCondition: "2차 제안금액",
        condition: (item, bidInfo) =>
          item.bid_type === "live" &&
          bidInfo?.first_price &&
          !bidInfo?.final_price,
        message:
          "현장에서 경합이 발생할 경우\n자동으로 제안될 최대 금액입니다.",
      },
      {
        selector: ".bid-input-label",
        type: "live-final-bid",
        textCondition: "최종입찰 금액",
        condition: (item, bidInfo) =>
          item.bid_type === "live" &&
          bidInfo?.first_price &&
          bidInfo?.second_price &&
          !bidInfo?.final_price,
        message:
          "현장경매 최종 입찰 금액입니다.\n이 금액으로 최종 경쟁에 참여합니다.",
      },
      {
        selector: ".quick-bid-buttons.star-auction .bid-info-tooltip-trigger",
        type: "star-bid-info",
        condition: (item) => item.auc_num == 3,
        message: "해당 상품은 금액대별 최소금액으로 입찰됩니다.",
      },
    ],
  },
};

// 위시리스트 관리 - products.js와 동일
window.WishlistManager = (function () {
  function init() {
    console.log("WishlistManager 초기화 완료");
  }

  function getCurrentState() {
    return window.ProductListController.getState();
  }

  async function toggleWishlist(itemId, favoriteNumber) {
    if (
      !window.AuthManager.requireAuth(
        "위시리스트 기능을 사용하려면 로그인이 필요합니다.",
      )
    ) {
      return;
    }

    try {
      const state = getCurrentState();
      const existingItem = state.wishlist.find(
        (w) => w.item_id == itemId && w.favorite_number === favoriteNumber,
      );

      if (existingItem) {
        await window.API.fetchAPI("/wishlist", {
          method: "DELETE",
          body: JSON.stringify({
            itemId: itemId.toString(),
            favoriteNumber,
          }),
        });

        state.wishlist = state.wishlist.filter(
          (w) => !(w.item_id == itemId && w.favorite_number === favoriteNumber),
        );
      } else {
        await window.API.fetchAPI("/wishlist", {
          method: "POST",
          body: JSON.stringify({
            itemId: itemId.toString(),
            favoriteNumber,
          }),
        });

        state.wishlist.push({
          item_id: itemId,
          favorite_number: favoriteNumber,
        });
      }

      updateWishlistUI(itemId);
    } catch (error) {
      console.error("위시리스트 토글 에러:", error);
      alert(`위시리스트 업데이트 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  function updateWishlistUI(itemId) {
    const card = document.querySelector(
      `.product-card[data-item-id="${itemId}"]`,
    );
    if (card) {
      const wishlistBtns = card.querySelectorAll(".wishlist-btn");
      const state = getCurrentState();

      wishlistBtns.forEach((btn) => {
        const favoriteNumber = parseInt(btn.dataset.favorite);
        const isActive = state.wishlist.some(
          (w) => w.item_id == itemId && w.favorite_number == favoriteNumber,
        );

        btn.classList.toggle("active", isActive);
      });
    }
  }

  return {
    init,
    toggleWishlist,
    updateWishlistUI,
  };
})();

// 추천 상품 페이지 특화 렌더링 - products.js와 동일
window.RecommendRenderer = (function () {
  function postProcessCard(card, item) {
    setupWishlistButtons(card, item);

    if (recommendPageConfig.features.bidding) {
      setupBidUI(card, item);
    }

    setupTimer(card, item);
    setupPriceInfo(card, item);

    if (recommendPageConfig.tooltips?.enabled) {
      setTimeout(() => {
        const state = window.ProductListController.getState();
        const bidInfo =
          item.bid_type === "live"
            ? state.liveBidData.find((b) => b.item_id == item.item_id)
            : item.bid_type === "instant"
              ? state.instantPurchaseData.find((b) => b.item_id == item.item_id)
              : state.directBidData.find((b) => b.item_id == item.item_id);

        window.TooltipManager.processTooltips(
          card,
          item,
          recommendPageConfig.tooltips.cardTooltips,
          bidInfo,
        );
      }, 150);
    }
  }

  function setupWishlistButtons(card, item) {
    const wishlistButtons = card.querySelector(".wishlist-buttons");
    if (!wishlistButtons) return;

    const state = window.ProductListController.getState();

    const isActive1 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 1,
    );
    const isActive2 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 2,
    );
    const isActive3 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 3,
    );

    wishlistButtons.innerHTML = `
      <button class="wishlist-btn ${
        isActive1 ? "active" : ""
      }" data-favorite="1" 
              onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
                item.item_id
              }', 1)">
        즐겨찾기①
      </button>
      <button class="wishlist-btn ${
        isActive2 ? "active" : ""
      }" data-favorite="2" 
              onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
                item.item_id
              }', 2)">
        즐겨찾기②
      </button>
      <button class="wishlist-btn ${
        isActive3 ? "active" : ""
      }" data-favorite="3" 
              onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
                item.item_id
              }', 3)">
        즐겨찾기③
      </button>
    `;
  }

  function setupBidUI(card, item) {
    const bidSection = card.querySelector(".bid-section");
    if (!bidSection) {
      console.error("bid-section을 찾을 수 없습니다:", card);
      return;
    }

    if (!window.BidManager) {
      console.error("BidManager가 로드되지 않았습니다");
      return;
    }

    const state = window.ProductListController.getState();

    const liveBidInfo = state.liveBidData.find(
      (b) => b.item_id == item.item_id,
    );
    const directBidInfo = state.directBidData.find(
      (b) => b.item_id == item.item_id,
    );

    try {
      if (item.bid_type === "instant") {
        // 바로 구매는 입찰 UI 없음 — 구매 정보만 표시
        const instantInfo = state.instantPurchaseData?.find(
          (b) => b.item_id == item.item_id,
        );
        const price =
          instantInfo?.purchase_price || instantInfo?.winning_price || 0;
        bidSection.innerHTML = price
          ? `<div class="bid-info instant"><div class="my-bid-price"><span class="price-label">구매 금액</span><span class="price-value">${cleanNumberFormat(price)}￥</span></div></div>`
          : "";
      } else if (item.bid_type === "direct") {
        bidSection.innerHTML = window.BidManager.getDirectBidSectionHTML(
          directBidInfo,
          item.item_id,
          item.auc_num,
          item.category,
          { showTimer: false },
        );
      } else {
        bidSection.innerHTML = window.BidManager.getLiveBidSectionHTML(
          liveBidInfo,
          item.item_id,
          item.auc_num,
          item.category,
          { showTimer: false },
        );
      }
    } catch (error) {
      console.error("입찰 UI 생성 실패:", error);
      bidSection.innerHTML = '<div class="bid-error">입찰 UI 로드 실패</div>';
    }
  }

  function setupTimer(card, item) {
    const timerElement = card.querySelector(".bid-timer");
    if (!timerElement || !item.scheduled_date) return;

    updateTimer(timerElement, item);
  }

  function updateTimer(timerElement, item) {
    if (!window.BidManager) return;

    const state = window.ProductListController.getState();

    let bidInfo = null;
    let bidStage = "first";
    let timerText = "입찰마감";

    if (item.bid_type === "instant") {
      // 바로 구매는 타이머 표시 안함
      if (timerElement) {
        const remainingTimeEl = timerElement.querySelector(".remaining-time");
        if (remainingTimeEl) remainingTimeEl.textContent = "[구매완료]";
        timerElement.className = "bid-timer completed";
      }
      return;
    } else if (item.bid_type === "live") {
      bidInfo = state.liveBidData.find((b) => b.item_id == item.item_id);

      if (bidInfo?.first_price && !bidInfo?.final_price) {
        bidStage = "final";
        timerText = "최종입찰마감";
      } else if (!bidInfo?.first_price) {
        bidStage = "first";
        timerText = "1차입찰마감";
      } else {
        timerText = "입찰완료";
      }
    } else {
      bidInfo = state.directBidData.find((b) => b.item_id == item.item_id);
      bidStage = "first";
      timerText = "입찰마감";
    }

    const timer = window.BidManager.getRemainingTime(
      item.scheduled_date,
      bidStage,
    );
    const isNearEnd = timer?.isNearEnd;
    const timeText = timer ? timer.text : "--:--:--";

    const formattedDateTime = formatDateTime(item.scheduled_date);

    timerElement.className = `bid-timer ${isNearEnd ? "near-end" : ""}${
      !timer ? " expired" : ""
    }`;

    const scheduledDateEl = timerElement.querySelector(".scheduled-date");
    const remainingTimeEl = timerElement.querySelector(".remaining-time");

    if (scheduledDateEl) {
      scheduledDateEl.textContent = `${formattedDateTime} 마감`;
    }

    if (remainingTimeEl) {
      if (timer) {
        remainingTimeEl.textContent = `[${timeText}]`;
      } else {
        remainingTimeEl.textContent = "[마감됨]";
      }
    }
  }

  function setupPriceInfo(card, item) {
    const state = window.ProductListController.getState();

    const liveBidInfo = state.liveBidData.find(
      (b) => b.item_id == item.item_id,
    );
    const directBidInfo = state.directBidData.find(
      (b) => b.item_id == item.item_id,
    );

    const live_price =
      item.bid_type == "direct" &&
      directBidInfo?.current_price &&
      Number(directBidInfo.current_price) > Number(item.starting_price)
        ? directBidInfo.current_price
        : item.starting_price;

    const secondCellLabel = card.querySelector(
      ".info-cell:nth-child(2) .info-label",
    );
    if (secondCellLabel) {
      if (item.bid_type === "instant") {
        secondCellLabel.textContent = "구매가";
      } else if (item.bid_type === "direct") {
        secondCellLabel.textContent = "실시간";
      } else if (item.bid_type === "live") {
        secondCellLabel.textContent = "시작 금액";
      }
    }

    const thirdCellLabel = card.querySelector(
      ".info-cell:nth-child(3) .info-label",
    );
    if (thirdCellLabel) {
      if (item.bid_type === "instant") {
        thirdCellLabel.textContent = "타입";
      } else if (item.bid_type === "direct") {
        thirdCellLabel.textContent = "나의 입찰";
      } else if (item.bid_type === "live") {
        thirdCellLabel.textContent = "2차 제안";
      }
    }

    const priceValueEl = card.querySelector(
      ".info-cell:nth-child(2) .info-value",
    );
    const priceDetailEl = card.querySelector(
      ".info-cell:nth-child(2) .info-price-detail",
    );

    if (priceValueEl) {
      priceValueEl.innerHTML = `${cleanNumberFormat(live_price || 0)}¥`;
    }

    if (priceDetailEl && live_price) {
      priceDetailEl.textContent = `${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category),
      )}원`;
    }

    const thirdCellValue = card.querySelector(
      ".info-cell:nth-child(3) .info-value",
    );
    const thirdCellDetail = card.querySelector(
      ".info-cell:nth-child(3) .info-price-detail",
    );

    if (thirdCellValue) {
      let thirdValue = "-";
      let thirdDetail = "";

      if (item.bid_type === "instant") {
        thirdValue = "바로 구매";
        thirdDetail = "";
      } else if (item.bid_type === "direct" && directBidInfo?.current_price) {
        thirdValue = `${cleanNumberFormat(directBidInfo.current_price)}¥`;
        thirdDetail = `${cleanNumberFormat(
          calculateTotalPrice(
            directBidInfo.current_price,
            item.auc_num,
            item.category,
          ),
        )}원`;
      } else if (item.bid_type === "live" && liveBidInfo?.second_price) {
        thirdValue = `${cleanNumberFormat(liveBidInfo.second_price)}¥`;
        thirdDetail = `${cleanNumberFormat(
          calculateTotalPrice(
            liveBidInfo.second_price,
            item.auc_num,
            item.category,
          ),
        )}원`;
      }

      thirdCellValue.textContent = thirdValue;
      if (thirdCellDetail) {
        thirdCellDetail.textContent = thirdDetail;
      }
    }

    if (item.bid_type === "direct") {
      const myBidPrice = directBidInfo?.current_price || 0;
      const hasHigherBid =
        Number(live_price) > Number(myBidPrice) && myBidPrice > 0;

      const header = card.querySelector(".product-header .product-brand");
      if (header && hasHigherBid) {
        if (!header.querySelector(".higher-bid-alert")) {
          const alertDiv = createElement(
            "div",
            "higher-bid-alert",
            "더 높은 입찰 존재",
          );
          header.appendChild(alertDiv);
        }
      } else if (header) {
        const existingAlert = header.querySelector(".higher-bid-alert");
        if (existingAlert) {
          existingAlert.remove();
        }
      }
    }
  }

  return {
    postProcessCard,
    updateTimer,
  };
})();

// 실시간 업데이트 매니저 - products.js와 동일
window.RealtimeManager = (function () {
  let socket = null;

  function initializeSocket() {
    if (typeof io === "undefined") {
      console.warn("Socket.IO not available");
      return null;
    }

    socket = io({
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      setupFallbackPolling();
    });

    socket.on("data-updated", (data) => {
      console.log(`업데이트 알림: ${data.itemIds.length}개 아이템`);

      const state = window.ProductListController.getState();
      const visibleItemIds = state.currentData.map((item) => item.item_id);
      const itemsToUpdate = data.itemIds.filter((id) =>
        visibleItemIds.includes(id),
      );

      if (itemsToUpdate.length > 0) {
        window.ProductListController.debouncedFetchData(false);
      }
    });

    socket.on("connect", () => {
      console.log("서버에 연결됨");
    });

    socket.on("disconnect", () => {
      console.log("서버 연결 해제됨");
    });

    return socket;
  }

  function setupFallbackPolling() {
    setInterval(() => {
      if (window.ProductListController) {
        window.ProductListController.debouncedFetchData(false);
      }
    }, 30000);
  }

  return {
    initializeSocket,
  };
})();

// 추천 상품 페이지 특화 기능 확장
const RecommendPageExtensions = {
  customizeCard(card, item) {
    window.RecommendRenderer.postProcessCard(card, item);
    return card;
  },

  customizeModal(item) {
    initializeBidInfo(item.item_id, item);
  },

  setupCustomEvents() {
    window.addEventListener("bidSuccess", function () {
      window.ProductListController.fetchData();
    });
  },
};

function initializeBidInfo(itemId, item = null) {
  if (!item) {
    const state = window.ProductListController.getState();
    item = state.currentData.find((i) => i.item_id == itemId);
  }

  const bidSection = document.querySelector(".modal-content .bid-info-holder");

  if (!bidSection || !item || !window.BidManager) return;

  const state = window.ProductListController.getState();

  if (item.bid_type === "instant") {
    // 바로 구매는 입찰 폼 없음 — 구매 완료 정보만 표시
    const instantInfo = state.instantPurchaseData?.find(
      (b) => b.item_id == itemId,
    );
    const price =
      instantInfo?.purchase_price || instantInfo?.winning_price || 0;
    bidSection.innerHTML = price
      ? `<div class="bid-info instant"><div class="my-bid-price"><span class="price-label">구매 금액</span><span class="price-value">${cleanNumberFormat(price)}￥</span><span class="price-detail">관부가세 포함 ${cleanNumberFormat(calculateTotalPrice(price, item.auc_num, item.category))}원</span></div></div>`
      : "";
  } else if (item.bid_type === "direct") {
    bidSection.innerHTML = window.BidManager.getDirectBidSectionHTML(
      directBidInfo,
      itemId,
      item.auc_num,
      item.category,
    );
  } else {
    const liveBidInfo = state.liveBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = window.BidManager.getLiveBidSectionHTML(
      liveBidInfo,
      itemId,
      item.auc_num,
      item.category,
    );
  }

  if (recommendPageConfig.tooltips?.enabled) {
    setTimeout(() => {
      const bidInfo =
        item.bid_type === "live"
          ? state.liveBidData.find((b) => b.item_id == itemId)
          : item.bid_type === "instant"
            ? state.instantPurchaseData?.find((b) => b.item_id == itemId)
            : state.directBidData.find((b) => b.item_id == itemId);

      const modal = document.querySelector(".modal-content");
      window.TooltipManager.processTooltips(
        modal,
        item,
        recommendPageConfig.tooltips.modalTooltips,
        bidInfo,
      );
    }, 100);
  }

  if (window.BidManager.initializePriceCalculators) {
    window.BidManager.initializePriceCalculators();
  }
}

function setupTooltips() {
  if (!window.TooltipManager) return;

  window.TooltipManager.clearConditionalTooltips();
  console.log("추천 상품 페이지 툴팁 시스템 설정 완료");
}

function getItemIdFromElement(element) {
  const card =
    element.closest(".product-card") || element.closest(".modal-content");
  if (!card) return null;

  return (
    card.dataset?.itemId ||
    card.querySelector("[data-item-id]")?.dataset?.itemId ||
    card.querySelector(".modal-title")?.dataset?.itemId
  );
}

// 입찰 로딩 UI - products.js와 동일
window.bidLoadingUI = {
  showBidLoading: function (buttonElement) {
    buttonElement.dataset.originalText = buttonElement.textContent;
    buttonElement.innerHTML = '<span class="spinner"></span> 처리 중...';
    buttonElement.disabled = true;
    buttonElement.classList.add("loading");
  },

  hideBidLoading: function (buttonElement) {
    buttonElement.textContent =
      buttonElement.dataset.originalText || "입찰하기";
    buttonElement.disabled = false;
    buttonElement.classList.remove("loading");
  },
};

// 추천 페이지 초기화
function initializeRecommendPage() {
  console.log("추천 상품 페이지 초기화 시작");

  if (window.BidManager) {
    console.log("BidManager 초기화");
    window.BidManager.initialize(false, []);
    window.BidManager.setAuthStatus(window.AuthManager.isAuthenticated());
  } else {
    console.error("BidManager를 찾을 수 없습니다");
  }

  recommendPageConfig.customizeCard = RecommendPageExtensions.customizeCard;
  recommendPageConfig.customizeModal = RecommendPageExtensions.customizeModal;

  window.WishlistManager.init();

  if (recommendPageConfig.features.realtime) {
    window.RealtimeManager.initializeSocket();
  }

  RecommendPageExtensions.setupCustomEvents();
  setupTooltips();

  console.log("ProductListController 초기화 시작");
  window.ProductListController.init(recommendPageConfig);
}

// 윈도우 로드 시 초기화
window.addEventListener("load", function () {
  initializeRecommendPage();
});

window.addEventListener("beforeunload", function () {
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }
});

// 전역 함수로 노출
window.toggleWishlist = function (itemId, favoriteNumber) {
  window.WishlistManager.toggleWishlist(itemId, favoriteNumber);
};

window.showDetails = function (itemId) {
  window.ProductListController.showDetails(itemId);
};
