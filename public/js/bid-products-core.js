// public/js/bid-products-core.js

// 입찰 상품 관리 - 공통 로직
window.BidProductsCore = (function () {
  // 상태 정의
  const STATUS_TYPES = {
    ACTIVE: "active",
    FIRST: "first",
    SECOND: "second",
    FINAL: "final",
    COMPLETED: "completed",
    SHIPPED: "shipped",
    CANCELLED: "cancelled",
  };

  // 상태 그룹 - API 요청용
  const STATUS_GROUPS = {
    ACTIVE: ["active", "first", "second", "final"],
    COMPLETED: ["completed", "domestic_arrived", "processing", "shipped"], // shipping_status는 별도 필드로 관리됨
    CANCELLED: ["cancelled"],
    ALL: [
      "active",
      "first",
      "second",
      "final",
      "completed",
      "cancelled",
      "domestic_arrived",
      "processing",
      "shipped",
    ],
  };

  // 상태 표시 텍스트
  const STATUS_DISPLAY = {
    [STATUS_TYPES.ACTIVE]: "입찰 가능",
    [STATUS_TYPES.FIRST]: "1차 입찰",
    [STATUS_TYPES.SECOND]: "2차 제안",
    [STATUS_TYPES.FINAL]: "최종 입찰",
    [STATUS_TYPES.COMPLETED]: "낙찰 완료",
    [STATUS_TYPES.SHIPPED]: "출고됨",
    [STATUS_TYPES.CANCELLED]: "더 높은 입찰 존재",
  };

  // 상태 CSS 클래스
  const STATUS_CLASSES = {
    [STATUS_TYPES.ACTIVE]: "status-active",
    [STATUS_TYPES.FIRST]: "status-first",
    [STATUS_TYPES.SECOND]: "status-second",
    [STATUS_TYPES.FINAL]: "status-final",
    [STATUS_TYPES.COMPLETED]: "status-completed",
    [STATUS_TYPES.SHIPPED]: "status-shipped",
    [STATUS_TYPES.CANCELLED]: "status-cancelled",
    "status-expired": "status-expired",
  };

  // 내부 상태
  let _pageState = null;

  /**
   * 페이지 상태 설정
   */
  function setPageState(state) {
    _pageState = state;
  }

  /**
   * 마감 여부 체크
   */
  function checkIfExpired(product) {
    if (!product.item) return false;

    let timer;
    if (product.type === "live") {
      if (product.first_price && !product.final_price) {
        timer = window.BidManager?.getRemainingTime(
          product.item.scheduled_date,
          "final",
        );
      } else {
        timer = window.BidManager?.getRemainingTime(
          product.item.scheduled_date,
          "first",
        );
      }
    } else {
      timer = window.BidManager?.getRemainingTime(
        product.item.scheduled_date,
        "first",
      );
    }

    return !timer;
  }

  /**
   * 상태와 마감 여부에 따른 필터링
   */
  function filterByStatusAndDeadline(product, statusFilter) {
    const isExpired = checkIfExpired(product);

    if (product.type === "live") {
      switch (statusFilter) {
        case "first":
          // 1차 입찰만 (마감 안된 것)
          return product.status === "first" && !isExpired;

        case "second":
          // 2차 제안만 (마감 안된 것)
          return product.status === "second" && !isExpired;

        case "final":
          // 최종 입찰만 (마감 여부와 무관)
          return product.status === "final";

        case "cancelled":
          // 낙찰 실패:
          // - cancelled 상태
          // - 1차/2차 중 마감된 것 (최종 입찰 제외)
          return (
            product.status === "cancelled" ||
            (["first", "second"].includes(product.status) && isExpired)
          );

        case "completed":
          // 낙찰 완료
          return product.status === "completed";

        case "all":
          return true;

        default:
          return true;
      }
    } else if (product.type === "instant") {
      // instant (바로 구매)
      switch (statusFilter) {
        case "completed":
          return product.status === "completed";

        case "all":
          return true;

        default:
          return product.status === "completed";
      }
    } else {
      // direct
      switch (statusFilter) {
        case "active":
          return product.status === "active" && !isExpired;

        case "higher-bid":
          return product.status === "cancelled" && !isExpired;

        case "cancelled":
          return (
            (product.status === "cancelled" && isExpired) ||
            (product.status === "active" && isExpired)
          );

        case "completed":
          return product.status === "completed";

        case "all":
          return true;

        default:
          return true;
      }
    }
  }

  /**
   * 클라이언트 사이드 필터링 적용
   */
  function applyClientFilters() {
    if (!_pageState) return;

    _pageState.filteredResults = _pageState.combinedResults.filter((product) =>
      filterByStatusAndDeadline(product, _pageState.status),
    );

    // 필터링 후 총 개수 및 페이지 수 재계산
    _pageState.totalItems = _pageState.filteredResults.length;
    _pageState.totalPages = Math.ceil(
      _pageState.totalItems / _pageState.itemsPerPage,
    );

    // 현재 페이지가 범위를 벗어나면 1페이지로
    if (_pageState.currentPage > _pageState.totalPages) {
      _pageState.currentPage = 1;
    }
  }

  /**
   * 페이지네이션을 위한 데이터 슬라이싱
   */
  function getPaginatedResults() {
    if (!_pageState) return [];

    const startIndex = (_pageState.currentPage - 1) * _pageState.itemsPerPage;
    const endIndex = startIndex + _pageState.itemsPerPage;

    return _pageState.filteredResults.slice(startIndex, endIndex);
  }

  /**
   * 상태에 맞는 표시 텍스트 반환
   */
  function getStatusDisplay(status, scheduledDate, bidInfo = null) {
    const now = new Date();
    const scheduled = new Date(scheduledDate);

    // cancelled 상태 처리
    if (status === STATUS_TYPES.CANCELLED) {
      // live/direct 모두 마감 여부로 판단
      if (now > scheduled) {
        return "낙찰 실패";
      } else {
        return "더 높은 입찰 존재";
      }
    }

    // 현장경매 마감 체크 (기존 로직)
    if (
      status === STATUS_TYPES.ACTIVE ||
      status === STATUS_TYPES.FIRST ||
      status === STATUS_TYPES.SECOND ||
      status === STATUS_TYPES.FINAL
    ) {
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        const deadline = new Date(scheduled);
        deadline.setHours(23, 59, 59, 999);
        if (now > deadline) {
          return "마감됨";
        }
      } else if (!bidInfo?.first_price) {
        if (now > scheduled) {
          return "마감됨";
        }
      }
    }

    return STATUS_DISPLAY[status] || "알 수 없음";
  }

  /**
   * 상태에 맞는 CSS 클래스 반환
   */
  function getStatusClass(status, scheduledDate, bidInfo = null) {
    const now = new Date();
    const scheduled = new Date(scheduledDate);

    if (
      status === STATUS_TYPES.ACTIVE ||
      status === STATUS_TYPES.FIRST ||
      status === STATUS_TYPES.SECOND ||
      status === STATUS_TYPES.FINAL
    ) {
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        const deadline = new Date(scheduled);
        deadline.setHours(23, 59, 59, 999);
        if (now > deadline) {
          return "status-expired";
        }
      } else if (!bidInfo?.first_price) {
        if (now > scheduled) {
          return "status-expired";
        }
      }
    }

    return STATUS_CLASSES[status] || "status-default";
  }

  /**
   * 템플릿 기반 상품 렌더링
   */
  function renderBidResultItem(product) {
    const template = document.getElementById("bid-result-item-template");
    if (!template) {
      console.error("bid-result-item-template을 찾을 수 없습니다.");
      return null;
    }

    const item = product.item;
    if (!item) return null;

    const itemElement = template.content.cloneNode(true);
    const resultItem = itemElement.querySelector(".bid-result-item");

    // 데이터 속성 설정
    resultItem.dataset.itemId = item.item_id;
    resultItem.dataset.bidId = product.id;
    resultItem.dataset.bidType = product.type;

    // 데이터 바인딩
    bindDataFields(itemElement, product, item);

    // 조건부 요소 처리
    processConditionalElements(itemElement, product, item);

    // 이벤트 리스너 추가
    addItemEventListeners(resultItem, item);

    return itemElement;
  }

  /**
   * 데이터 필드 바인딩
   */
  function bindDataFields(element, product, item) {
    // 이미지
    const img = element.querySelector('[data-field="image"]');
    if (img) {
      img.src = window.API.validateImageUrl(item.image);
      img.alt = item.title || "상품 이미지";
    }

    // 랭크
    const rank = element.querySelector('[data-field="rank"]');
    if (rank) rank.textContent = item.rank || "N";

    // 브랜드
    const brand = element.querySelector('[data-field="brand"]');
    if (brand) brand.textContent = item.brand || "-";

    // 제목
    const title = element.querySelector('[data-field="title"]');
    if (title) title.textContent = item.title || "제목 없음";

    // 카테고리
    const category = element.querySelector('[data-field="category"]');
    if (category) category.textContent = item.category || "-";

    // 경매 타입 표시
    const bidTypeEl = element.querySelector('[data-field="bid_type_display"]');
    if (bidTypeEl) {
      bidTypeEl.textContent =
        product.type === "live"
          ? "현장 경매"
          : product.type === "instant"
            ? "바로 구매"
            : "직접 경매";
      bidTypeEl.className = `bid-type ${
        product.type === "live"
          ? "live-type"
          : product.type === "instant"
            ? "instant-type"
            : "direct-type"
      }`;
    }

    // 상태 표시
    const statusEl = element.querySelector('[data-field="status_display"]');
    if (statusEl) {
      const bidInfo = product.type === "live" ? product : null;
      const statusClass = getStatusClass(
        product.displayStatus,
        item.scheduled_date,
        bidInfo,
      );
      const statusText = getStatusDisplay(
        product.displayStatus,
        item.scheduled_date,
        product.type === "live" ? bidInfo : null, // direct는 null 전달
      );

      statusEl.textContent = statusText;
      statusEl.className = `status-badge ${statusClass}`;
    }

    // 업데이트 날짜
    const dateEl = element.querySelector('[data-field="updated_at"]');
    if (dateEl) dateEl.textContent = formatDateTime(product.updated_at);
  }

  /**
   * 조건부 요소 처리
   */
  function processConditionalElements(element, product, item) {
    if (!_pageState) {
      console.error("페이지 상태가 설정되지 않았습니다.");
      return;
    }

    // 현장 경매의 경우 입찰 정보를 고려한 타이머 체크
    let timer, isExpired;
    if (product.type === "live") {
      if (product.first_price && !product.final_price) {
        timer = window.BidManager
          ? window.BidManager.getRemainingTime(item.scheduled_date, "final")
          : null;
      } else {
        timer = window.BidManager
          ? window.BidManager.getRemainingTime(item.scheduled_date, "first")
          : null;
      }
    } else {
      timer = window.BidManager
        ? window.BidManager.getRemainingTime(item.scheduled_date, "first")
        : null;
    }

    isExpired = !timer;

    const isActiveBid =
      (product.displayStatus === "active" ||
        product.displayStatus === "first" ||
        product.displayStatus === "second" ||
        product.displayStatus === "final" ||
        product.displayStatus === "cancelled") &&
      !isExpired;

    // 입찰 가능한 경우 bid-action 섹션 처리
    const bidActionEl = element.querySelector('[data-if="isActiveBid"]');
    if (bidActionEl) {
      if (isActiveBid) {
        bidActionEl.className = "bid-action expanded";

        let bidHtml = "";
        if (product.type === "instant") {
          // 바로 구매는 입찰 UI 없음 — 항상 완료 상태
          bidHtml = "";
        } else if (product.type === "direct") {
          const directBidInfo = _pageState.directBids.find(
            (b) => b.id === product.id,
          );
          bidHtml = window.BidManager
            ? window.BidManager.getDirectBidSectionHTML(
                directBidInfo,
                item.item_id,
                item.auc_num,
                item.category,
              )
            : "";
        } else {
          const liveBidInfo = _pageState.liveBids.find(
            (b) => b.id === product.id,
          );
          bidHtml = window.BidManager
            ? window.BidManager.getLiveBidSectionHTML(
                liveBidInfo,
                item.item_id,
                item.auc_num,
                item.category,
              )
            : "";
        }

        // BidManager HTML을 파싱하여 적절히 배치
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = bidHtml;

        const leftContent = document.createElement("div");
        leftContent.className = "bid-action-left";

        const rightContent = document.createElement("div");
        rightContent.className = "bid-input-container";

        // 타이머 요소
        const timerElement = tempDiv.querySelector(".bid-timer");
        if (timerElement) {
          leftContent.appendChild(timerElement);
        }

        // 가격 요소들
        const priceElements = tempDiv.querySelectorAll(
          ".real-time-price, .bid-price-info, .final-price",
        );
        priceElements.forEach((el) => {
          leftContent.appendChild(el);
        });

        // 입력 컨테이너
        const inputContainerSource = tempDiv.querySelector(
          ".bid-input-container",
        );
        if (inputContainerSource) {
          while (inputContainerSource.firstChild) {
            rightContent.appendChild(inputContainerSource.firstChild);
          }
        }

        bidActionEl.appendChild(leftContent);
        bidActionEl.appendChild(rightContent);
      } else {
        bidActionEl.remove();
      }
    }

    // 완료된 입찰의 경우 bid-info 섹션 처리
    const bidInfoEl = element.querySelector('[data-if="isCompletedBid"]');
    if (bidInfoEl) {
      if (!isActiveBid) {
        bidInfoEl.className = "bid-info";

        const auctionId = item.auc_num || 1;
        const category = item.category || "기타";
        let japanesePrice = 0;
        let bidInfoHTML = "";

        if (product.type === "instant") {
          japanesePrice = product.purchase_price || product.winning_price || 0;
          const instantKoreanPrice = calculateTotalPrice(
            japanesePrice,
            auctionId,
            category,
          );
          bidInfoHTML += `
            <div class="price-row winning-price">
              <span class="price-label">구매 금액:</span>
              <span class="price-value">${formatNumber(japanesePrice)} ¥</span>
            </div>
            <div class="price-row price-korean winning-price">
              <span class="price-label">관부가세 포함:</span>
              <span class="price-value">${formatNumber(instantKoreanPrice)} ₩</span>
            </div>
          `;
        } else if (product.type === "direct") {
          japanesePrice = product.current_price || 0;
          bidInfoHTML += `
            <div class="price-row">
              <span class="price-label">입찰 금액:</span>
              <span class="price-value">${formatNumber(
                product.current_price,
              )} ¥</span>
            </div>
          `;

          if (product.winning_price) {
            const winningKoreanPrice = calculateTotalPrice(
              product.winning_price,
              auctionId,
              category,
            );
            bidInfoHTML += `
              <div class="price-row winning-price">
                <span class="price-label">낙찰 금액:</span>
                <span class="price-value">${formatNumber(
                  product.winning_price,
                )} ¥</span>
              </div>
              <div class="price-row price-korean winning-price">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  winningKoreanPrice,
                )} ₩</span>
              </div>
            `;
          } else {
            bidInfoHTML += `
              <div class="price-row price-korean">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  calculateTotalPrice(japanesePrice, auctionId, category),
                )} ₩</span>
              </div>
            `;
          }
        } else {
          bidInfoHTML += `<div class="price-stages">`;

          if (product.first_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">1차 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.first_price,
                )} ¥</span>
              </div>
            `;
          }

          if (product.second_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">2차 제안:</span>
                <span class="price-value">${formatNumber(
                  product.second_price,
                )} ¥</span>
              </div>
            `;
          }

          if (product.final_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">최종 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.final_price,
                )} ¥</span>
              </div>
            `;
          }

          bidInfoHTML += `</div>`;

          japanesePrice =
            product.final_price ||
            product.second_price ||
            product.first_price ||
            0;

          if (product.winning_price) {
            const winningKoreanPrice = calculateTotalPrice(
              product.winning_price,
              auctionId,
              category,
            );
            bidInfoHTML += `
              <div class="price-row winning-price">
                <span class="price-label">낙찰 금액:</span>
                <span class="price-value">${formatNumber(
                  product.winning_price,
                )} ¥</span>
              </div>
              <div class="price-row price-korean winning-price">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  winningKoreanPrice,
                )} ₩</span>
              </div>
            `;
          } else if (japanesePrice > 0) {
            bidInfoHTML += `
              <div class="price-row price-korean">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  calculateTotalPrice(japanesePrice, auctionId, category),
                )} ₩</span>
              </div>
            `;
          }
        }

        bidInfoEl.innerHTML = bidInfoHTML;
      } else {
        bidInfoEl.remove();
      }
    }
  }

  /**
   * 아이템 이벤트 리스너 추가
   */
  function addItemEventListeners(element, item) {
    element.addEventListener("click", (e) => {
      if (
        e.target.closest(".bid-action") ||
        e.target.closest(".bid-input-container") ||
        e.target.closest(".bid-button") ||
        e.target.closest(".quick-bid-btn") ||
        e.target.closest(".price-calculator") ||
        e.target.closest(".bid-input-group")
      ) {
        e.stopPropagation();
        return;
      }
      showProductDetails(item.item_id);
    });
  }

  /**
   * 상품 표시 (컨테이너 독립적)
   */
  function displayProducts(containerId = "productList") {
    if (!_pageState) {
      console.error("페이지 상태가 설정되지 않았습니다.");
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    // 필터링 적용
    applyClientFilters();

    // 페이지네이션된 결과 가져오기
    const paginatedResults = getPaginatedResults();

    // 컨테이너 ID를 기반으로 totalResults ID 추론
    const totalResultsId =
      containerId === "productList"
        ? "totalResults"
        : containerId.replace("-productList", "-totalResults");

    const totalResultsElement = document.getElementById(totalResultsId);
    if (totalResultsElement) {
      totalResultsElement.textContent = _pageState.totalItems;
    }

    if (paginatedResults.length === 0) {
      container.innerHTML =
        '<div class="no-results">표시할 상품이 없습니다.</div>';
      return;
    }

    paginatedResults.forEach((product) => {
      const itemElement = renderBidResultItem(product);
      if (itemElement) {
        container.appendChild(itemElement);
      }
    });

    if (window.BidManager) {
      window.BidManager.initializePriceCalculators();
    }
  }

  /**
   * 페이지네이션 업데이트 (컨테이너 독립적)
   */
  function updatePagination(onPageChange, paginationId = "pagination") {
    if (!_pageState) return;
    createPagination(
      _pageState.currentPage,
      _pageState.totalPages,
      onPageChange,
      paginationId,
    );
  }

  /**
   * 페이지 변경 처리
   */
  async function handlePageChange(page, fetchFunction) {
    if (!_pageState) return;

    page = parseInt(page, 10);

    if (
      page === _pageState.currentPage ||
      page < 1 ||
      page > _pageState.totalPages
    ) {
      return;
    }

    _pageState.currentPage = page;
    await fetchFunction();
    window.scrollTo(0, 0);
  }

  /**
   * 정렬 버튼 UI 업데이트
   */
  function updateSortButtonsUI() {
    if (!_pageState) return;

    const sortButtons = document.querySelectorAll(".sort-btn");

    sortButtons.forEach((btn) => {
      btn.classList.remove("active", "asc", "desc");
      if (btn.dataset.sort === _pageState.sortBy) {
        btn.classList.add("active", _pageState.sortOrder);
      }
    });
  }

  /**
   * 로딩 표시 토글
   */
  function toggleLoading(show) {
    const loadingMsg = document.getElementById("loadingMsg");
    if (loadingMsg) {
      loadingMsg.style.display = show ? "block" : "none";
    }
  }

  /**
   * 상품 상세 정보 표시
   */
  async function showProductDetails(itemId) {
    if (!_pageState) return;

    const modalManager = setupModal("detailModal");
    if (!modalManager) return;

    const product = _pageState.filteredResults.find(
      (p) => p.item?.item_id === itemId,
    );
    if (!product) return;

    const item = product.item;

    // 기본 정보로 모달 초기화
    initializeModal(product, item);
    modalManager.show();

    // URL 파라미터 업데이트 (상품 ID 추가)
    const urlParams = window.URLStateManager.getURLParams();
    urlParams.set("item_id", itemId);
    const newUrl = window.location.pathname + "?" + urlParams.toString();
    window.history.replaceState({}, document.title, newUrl);

    // 로딩 표시
    window.ModalImageGallery.showLoading();

    try {
      // 상세 정보 가져오기
      const itemDetails = await window.API.fetchAPI(
        `/detail/item-details/${itemId}`,
        {
          method: "POST",
          body: JSON.stringify({ aucNum: item.auc_num }),
        },
      );

      // 상세 정보 업데이트
      updateModalWithDetails(itemDetails);

      // 추가 이미지가 있다면 업데이트
      if (itemDetails.additional_images) {
        try {
          const additionalImages = JSON.parse(itemDetails.additional_images);
          window.ModalImageGallery.initialize([
            item.image,
            ...additionalImages,
          ]);
        } catch (e) {
          console.error("이미지 파싱 오류:", e);
        }
      }
    } catch (error) {
      console.error("상품 상세 정보를 가져오는 중 오류 발생:", error);
    } finally {
      window.ModalImageGallery.hideLoading();
    }
  }

  /**
   * 모달 초기화
   */
  function initializeModal(product, item) {
    document.querySelector(".modal-brand").textContent = item.brand || "-";
    document.querySelector(".modal-title").textContent = item.title || "-";
    document.querySelector(".modal-title").dataset.itemId = item.item_id;
    document.querySelector(".main-image").src = window.API.validateImageUrl(
      item.image,
    );
    document.querySelector(".modal-description").textContent = "로딩 중...";
    document.querySelector(".modal-category").textContent =
      item.category || "로딩 중...";
    document.querySelector(".modal-brand2").textContent = item.brand || "-";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "로딩 중...";
    document.querySelector(".modal-scheduled-date").textContent =
      formatDateTime(item.scheduled_date) || "로딩 중...";
    document.querySelector(".modal-rank").textContent = item.rank || "N";

    // 가격 정보 표시
    displayBidInfoInModal(product, item);

    // 이미지 초기화
    window.ModalImageGallery.initialize([item.image]);
  }

  /**
   * 상세 정보로 모달 업데이트
   */
  function updateModalWithDetails(item) {
    document.querySelector(".modal-description").textContent =
      item.description || "설명 없음";
    document.querySelector(".modal-category").textContent =
      item.category || "카테고리 없음";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "액세서리 코드 없음";
    document.querySelector(".modal-scheduled-date").textContent =
      item.scheduled_date
        ? formatDateTime(item.scheduled_date)
        : "날짜 정보 없음";
    document.querySelector(".modal-brand").textContent = item.brand || "-";
    document.querySelector(".modal-brand2").textContent = item.brand || "-";
    document.querySelector(".modal-title").textContent =
      item.title || "제목 없음";
    document.querySelector(".modal-rank").textContent = item.rank || "N";
  }

  /**
   * 모달에서 입찰 정보 표시
   */
  function displayBidInfoInModal(product, item) {
    if (!_pageState) return;

    const bidSection = document.querySelector(".bid-info-holder");
    if (!bidSection) return;

    // 현장 경매의 경우 입찰 단계에 따른 타이머 체크
    let timer, isScheduledPassed;

    if (product.type === "live") {
      if (product.first_price && !product.final_price) {
        timer = window.BidManager.getRemainingTime(
          item.scheduled_date,
          "final",
        );
      } else {
        timer = window.BidManager.getRemainingTime(
          item.scheduled_date,
          "first",
        );
      }
    } else {
      timer = window.BidManager.getRemainingTime(item.scheduled_date, "first");
    }

    isScheduledPassed = !timer;

    // 마감되었거나 완료/취소 상태인 경우 읽기 전용 표시
    if (isScheduledPassed || product.displayStatus === "completed") {
      displayReadOnlyBidInfo(product, item, bidSection);
      return;
    }

    // 입찰 가능 상태인 경우 BidManager를 사용하여 입찰 폼 생성
    if (product.type === "instant") {
      // 바로 구매는 입찰 폼 없음 — 읽기 전용으로 표시
      displayReadOnlyBidInfo(product, item, bidSection);
      return;
    } else if (product.type === "direct") {
      const directBidInfo = _pageState.directBids.find(
        (b) => b.id === product.id,
      );
      bidSection.innerHTML = window.BidManager.getDirectBidSectionHTML(
        directBidInfo,
        item.item_id,
        item.auc_num,
        item.category,
      );
    } else {
      const liveBidInfo = _pageState.liveBids.find((b) => b.id === product.id);
      bidSection.innerHTML = window.BidManager.getLiveBidSectionHTML(
        liveBidInfo,
        item.item_id,
        item.auc_num,
        item.category,
      );
    }

    // 가격 계산기 초기화
    window.BidManager.initializePriceCalculators();
  }

  /**
   * 읽기 전용 입찰 정보 표시 함수
   */
  function displayReadOnlyBidInfo(product, item, container) {
    const statusClass = getStatusClass(
      product.displayStatus,
      item.scheduled_date,
      product.type === "live" ? product : null,
    );
    const statusText = getStatusDisplay(
      product.displayStatus,
      item.scheduled_date,
      product.type === "live" ? product : null, // direct는 null 전달
    );

    // 원화 가격 계산
    const auctionId = item.auc_num || 1;
    const category = item.category || "기타";
    let japanesePrice = 0;

    if (product.type === "instant") {
      japanesePrice = product.purchase_price || product.winning_price || 0;
    } else if (product.type === "direct") {
      japanesePrice = product.current_price || 0;
    } else {
      japanesePrice =
        product.final_price || product.second_price || product.first_price || 0;
    }

    const koreanPrice = calculateTotalPrice(japanesePrice, auctionId, category);

    let priceInfoHTML = `
      <div class="modal-price-info">
        <div class="price-status ${statusClass}">
          ${statusText}
        </div>
        <div class="price-date">
          <strong>예정일:</strong> ${formatDateTime(item.scheduled_date)}
        </div>
        <div class="price-starting">
          <strong>시작가:</strong> ￥${formatNumber(item.starting_price || 0)}
        </div>
    `;

    // 경매 타입에 따른 추가 정보
    if (product.type === "instant") {
      priceInfoHTML += `
        <div class="price-type">
          <strong>경매 유형:</strong> 바로 구매
        </div>
        <div class="price-winning">
          <strong>구매 금액:</strong> ￥${formatNumber(japanesePrice)}
        </div>
        <div class="price-winning-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
        </div>
      `;
    } else if (product.type === "direct") {
      priceInfoHTML += `
        <div class="price-type">
          <strong>경매 유형:</strong> 직접 경매
        </div>
        <div class="price-current">
          <strong>현재 입찰가:</strong> ￥${formatNumber(
            product.current_price || 0,
          )}
        </div>
      `;

      if (product.winning_price) {
        const winningKoreanPrice = calculateTotalPrice(
          product.winning_price,
          auctionId,
          category,
        );
        priceInfoHTML += `
          <div class="price-winning">
            <strong>낙찰 금액:</strong> ￥${formatNumber(product.winning_price)}
          </div>
          <div class="price-winning-korean">
            <strong>관부가세 포함:</strong> ₩${formatNumber(winningKoreanPrice)}
          </div>
        `;
      } else {
        priceInfoHTML += `
          <div class="price-korean">
            <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
          </div>
        `;
      }
    } else {
      priceInfoHTML += `
        <div class="price-type">
          <strong>경매 유형:</strong> 현장 경매
        </div>
      `;

      if (product.first_price) {
        priceInfoHTML += `
          <div class="price-first">
            <strong>1차 입찰가:</strong> ￥${formatNumber(product.first_price)}
          </div>
        `;
      }

      if (product.second_price) {
        priceInfoHTML += `
          <div class="price-second">
            <strong>2차 제안가:</strong> ￥${formatNumber(product.second_price)}
          </div>
        `;
      }

      if (product.final_price) {
        priceInfoHTML += `
          <div class="price-final">
            <strong>최종 입찰가:</strong> ￥${formatNumber(product.final_price)}
          </div>
        `;
      }

      if (product.winning_price) {
        const winningKoreanPrice = calculateTotalPrice(
          product.winning_price,
          auctionId,
          category,
        );
        priceInfoHTML += `
          <div class="price-winning">
            <strong>낙찰 금액:</strong> ￥${formatNumber(product.winning_price)}
          </div>
          <div class="price-winning-korean">
            <strong>관부가세 포함:</strong> ₩${formatNumber(winningKoreanPrice)}
          </div>
        `;
      } else if (japanesePrice > 0) {
        priceInfoHTML += `
          <div class="price-korean">
            <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
          </div>
        `;
      }
    }

    priceInfoHTML += `
      <div class="price-updated">
        <strong>최종 업데이트:</strong> ${formatDateTime(product.updated_at)}
      </div>
    </div>`;
    container.innerHTML = priceInfoHTML;
  }

  // 공개 API
  return {
    // 상태 정의
    STATUS_TYPES,
    STATUS_GROUPS,
    STATUS_DISPLAY,
    STATUS_CLASSES,

    // 상태 관리
    setPageState,

    // 렌더링 함수들
    renderBidResultItem,
    bindDataFields,
    processConditionalElements,
    displayProducts,

    // 모달 함수들
    showProductDetails,
    initializeModal,
    updateModalWithDetails,
    displayBidInfoInModal,
    displayReadOnlyBidInfo,

    // 유틸리티 함수들
    getStatusDisplay,
    getStatusClass,
    toggleLoading,
    updateSortButtonsUI,
    updatePagination,
    handlePageChange,
    addItemEventListeners,

    // 새로 추가된 클라이언트 필터링 함수들
    checkIfExpired,
    filterByStatusAndDeadline,
    applyClientFilters,
    getPaginatedResults,
  };
})();
