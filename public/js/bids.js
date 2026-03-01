// public/js/bids.js

// 경매 기능 관리 모듈
window.BidManager = (function () {
  // 경매장별 설정
  const AUCTION_BUTTON_CONFIGS = {
    1: {
      // 에코옥션
      buttons: [1, 5, 10],
      unit: 1000,
      validator: (price) => price % 1000 === 0,
      errorMessage: "1번 경매장은 1,000엔 단위로만 입찰 가능합니다.",
    },
    2: {
      // 브랜드옥션
      buttons: [0.5, 1, 2],
      unit: 500,
      firstBidOnly1000: true,
      validator: (price, isFirstBid) => {
        const unit = isFirstBid ? 1000 : 500;
        return price % unit === 0;
      },
      errorMessage: (isFirstBid) =>
        isFirstBid
          ? "첫 입찰은 1,000엔 단위로만 가능합니다."
          : "이후 입찰은 500엔 단위로만 가능합니다.",
    },
    3: {
      // 스타옥션
      special: "minimum-bid",
      validator: async (price, itemId) => {
        const bidOptions = await getBidOptions(itemId, 3, price);
        return bidOptions?.nextValidBid && price === bidOptions.nextValidBid;
      },
      errorMessage: (minBid) =>
        `3번 경매장은 자동 계산된 최소금액(${cleanNumberFormat(
          minBid,
        )}엔)으로만 입찰 가능합니다.`,
    },
    4: {
      // 메키키옥션
      buttons: [1, 5, 10],
      unit: 1000,
      validator: (price) => price % 1000 === 0,
      errorMessage: "4번 경매장은 1,000엔 단위로만 입찰 가능합니다.",
    },
    5: {
      // 펭귄옥션
      buttons: [1, 5, 10],
      unit: 1000,
      validator: (price) => price % 1000 === 0,
      errorMessage: "5번 경매장은 1,000엔 단위로만 입찰 가능합니다.",
    },
  };

  // 내부 상태
  const _state = {
    liveBidData: [],
    directBidData: [],
    instantPurchaseData: [],
    isAuthenticated: false,
    currentData: [],
    submittingBids: new Set(), // 현재 제출 중인 입찰 추적 (중복 방지)
  };

  // 내부 API 참조
  const API = window.API;

  /**
   * 남은 시간 계산 함수
   */
  function getRemainingTime(scheduledDate, bidStage = "first") {
    if (!scheduledDate) return null;

    const now = new Date();
    let endDate = new Date(scheduledDate);

    if (bidStage === "final") {
      endDate.setHours(23, 59, 59, 999);
    }

    if (endDate <= now) return null;

    const diff = endDate - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return {
      hours,
      minutes,
      seconds,
      total: diff,
      text: `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      isNearEnd: diff <= 10 * 60 * 1000,
    };
  }

  /**
   * 경매장별 입찰 옵션 정보 가져오기
   */
  async function getBidOptions(itemId, auctionNum, currentPrice) {
    try {
      const response = await API.fetchAPI(
        `/direct-bids/bid-options/${itemId}?aucNum=${auctionNum}`,
      );
      return response;
    } catch (error) {
      console.error("입찰 옵션 정보를 가져오는데 실패했습니다:", error);
      return null;
    }
  }

  /**
   * 입찰가 검증
   */
  async function validateBidPrice(
    price,
    auctionNum,
    itemId,
    isFirstBid = false,
  ) {
    const config = AUCTION_BUTTON_CONFIGS[auctionNum];
    if (!config) return { valid: true };

    if (auctionNum === 3) {
      // 스타옥션: 비동기 검증
      try {
        const isValid = await config.validator(price, itemId);
        return {
          valid: isValid,
          message: isValid ? null : config.errorMessage(),
        };
      } catch (error) {
        return { valid: false, message: "입찰 검증 중 오류가 발생했습니다." };
      }
    } else {
      // 에코옥션, 브랜드옥션: 동기 검증
      const isValid = config.validator(price, isFirstBid);
      return {
        valid: isValid,
        message: isValid
          ? null
          : typeof config.errorMessage === "function"
            ? config.errorMessage(isFirstBid)
            : config.errorMessage,
      };
    }
  }

  /**
   * 타이머 HTML 생성
   */
  function generateBidTimerHTML(bidInfo, item, showTimer = true) {
    if (!showTimer || !item?.scheduled_date) return "";

    let bidStage = "first";
    let timerText = "입찰마감";
    let isExpired = false;

    console.log(bidInfo);

    // 현장 경매의 경우 입찰 단계 결정
    if (item?.bid_type == "live") {
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        bidStage = "final";
        timerText = "최종입찰마감";
      } else if (!bidInfo?.first_price) {
        timerText = "1차입찰마감";
      } else if (bidInfo?.final_price) {
        return `<div class="bid-timer completed">입찰완료</div>`;
      }
    }

    const timer = getRemainingTime(item.scheduled_date, bidStage);
    isExpired = !timer;

    if (isExpired) {
      return `<div class="bid-timer expired">${timerText} [마감됨]</div>`;
    }

    const nearEndClass = timer.isNearEnd ? " near-end" : "";
    return `<div class="bid-timer${nearEndClass}">
      ${timerText} 남은시간 [${timer.text}]
    </div>`;
  }

  /**
   * 현장 경매 가격 정보 HTML 생성
   */
  function generateLiveBidPriceHTML(bidInfo, item, aucNum, category) {
    const startingPrice = parseFloat(item.starting_price) || 0;

    let html = `<div class="real-time-price">
      <p>실시간: ${cleanNumberFormat(startingPrice)} ¥</p>
      <div class="price-details-container">
        관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(startingPrice, aucNum, category),
        )}원
      </div>
    </div>`;

    // 최종 입찰가가 있는 경우
    if (bidInfo?.final_price) {
      return `<div class="final-price">
        <p>최종 입찰금액: ${cleanNumberFormat(bidInfo.final_price)} ¥</p>
        <div class="price-details-container">
          관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(bidInfo.final_price, aucNum, category),
          )}원
        </div>
      </div>`;
    }

    // 입찰 단계별 가격 정보
    if (bidInfo?.first_price) {
      html += `<div class="bid-price-info">
        <p>1차 입찰금액: ${cleanNumberFormat(bidInfo.first_price)} ¥</p>
        <div class="price-details-container first-price">
          관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(bidInfo.first_price, aucNum, category),
          )}원
        </div>
      </div>`;
    }

    if (bidInfo?.second_price) {
      html += `<div class="bid-price-info">
        <p>2차 제안금액: ${cleanNumberFormat(bidInfo.second_price)} ¥</p>
        <div class="price-details-container second-price">
          관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(bidInfo.second_price, aucNum, category),
          )}원
        </div>
      </div>`;
    }

    return html;
  }

  /**
   * 직접 경매 상태 HTML 생성
   */
  function generateDirectBidStatusHTML(bidInfo, item) {
    if (!bidInfo?.current_price) return "";

    const live_price =
      bidInfo?.current_price &&
      Number(bidInfo.current_price) > Number(item.starting_price)
        ? bidInfo.current_price
        : item.starting_price;

    const hasHigherBid =
      Number(live_price) > Number(bidInfo.current_price) &&
      bidInfo.current_price > 0;

    return hasHigherBid
      ? '<div class="higher-bid-alert">더 높은 입찰 존재</div>'
      : "";
  }

  /**
   * 직접 경매 가격 정보 HTML 생성
   */
  function generateDirectBidPriceHTML(bidInfo, item, aucNum, category) {
    const live_price =
      bidInfo?.current_price &&
      Number(bidInfo.current_price) > Number(item.starting_price)
        ? bidInfo.current_price
        : item.starting_price;

    let html = `<div class="real-time-price">
      <p>실시간 금액: ${cleanNumberFormat(live_price)} ¥</p>
      <div class="price-details-container">
        관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(live_price, aucNum, category),
        )}원
      </div>
    </div>`;

    if (bidInfo?.current_price && bidInfo.current_price > 0) {
      html += `<div class="bid-price-info">
        <p>나의 입찰 금액: ${cleanNumberFormat(bidInfo.current_price)} ¥</p>
        <div class="price-details-container my-price">
          관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(bidInfo.current_price, aucNum, category),
          )}원
        </div>
      </div>`;
    }

    return html;
  }

  /**
   * 입찰 입력 UI HTML 생성
   */
  function generateBidInputHTML(bidInfo, itemId, aucNum, bidType, isExpired) {
    const isFirstBid =
      !bidInfo ||
      (bidType === "live" ? !bidInfo.first_price : !bidInfo.current_price);

    const inputLabel =
      bidType === "live"
        ? bidInfo?.first_price
          ? "최종입찰 금액"
          : "1차금액 입력"
        : "";

    const buttonText = isExpired ? "마감됨" : "입찰";
    const buttonDisabled = isExpired ? "disabled" : "";
    const onClickHandler = isExpired
      ? ""
      : `BidManager.handle${
          bidType === "live" ? "Live" : "Direct"
        }BidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')`;

    // 스타옥션 특별 처리
    const inputReadonly = bidType === "direct" && aucNum == 3 ? "readonly" : "";

    return `<div class="bid-input-container">
      ${inputLabel ? `<div class="bid-input-label">${inputLabel}</div>` : ""}
      <div class="bid-input-group">
        <input type="number" placeholder="${
          bidType === "live" ? "" : "나의 입찰 금액"
        }" 
               class="bid-input" data-item-id="${itemId}" data-bid-type="${bidType}" ${inputReadonly}>
        <span class="bid-value-display">000</span>
        <span class="bid-currency">¥</span>
        <button class="bid-button" ${buttonDisabled} 
                onclick="event.stopPropagation(); ${onClickHandler}">${buttonText}</button>
      </div>
      <div class="price-details-container"></div>
      ${getQuickBidButtonsHTML(itemId, aucNum, bidType, isExpired, isFirstBid)}
    </div>`;
  }

  /**
   * 빠른 입찰 버튼 HTML 생성
   */
  function getQuickBidButtonsHTML(
    itemId,
    auctionNum,
    bidType,
    isExpired,
    isFirstBid = false,
  ) {
    if (isExpired) {
      return `<div class="quick-bid-buttons">
        <button class="quick-bid-btn" disabled>마감됨</button>
      </div>`;
    }

    const config = AUCTION_BUTTON_CONFIGS[auctionNum];
    if (!config) {
      return generateDefaultButtons(itemId, bidType);
    }

    // 현장 경매는 경매장에 관계없이 기본 버튼
    if (bidType === "live") {
      return generateDefaultButtons(itemId, bidType);
    }

    // 스타옥션 특별 처리
    if (config.special === "minimum-bid") {
      return `<div class="quick-bid-buttons star-auction">
        <button class="quick-bid-btn star-minimum-btn" 
                onclick="event.stopPropagation(); BidManager.setStarAuctionMinimumBid('${itemId}')">
          최소금액 입력
        </button>
        <span class="bid-info-tooltip-trigger"></span>
      </div>`;
    }

    // 브랜드옥션의 500엔 버튼 처리
    let buttonsHTML = config.buttons
      .map((amount) => {
        const disabled =
          auctionNum == 2 && amount === 0.5 && isFirstBid ? "disabled" : "";
        const amountText =
          amount < 1 ? `+${amount * 1000}¥` : `+${amount},000¥`;

        return `<button class="quick-bid-btn increment-${
          amount * 1000
        }" ${disabled} 
                      onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', ${amount}, '${bidType}')">
                ${amountText}
              </button>`;
      })
      .join("");

    const className = auctionNum == 2 ? "brand-auction" : "";
    const tooltip =
      auctionNum == 2 ? '<span class="bid-info-tooltip-trigger"></span>' : "";

    return `<div class="quick-bid-buttons ${className}">
      ${buttonsHTML}
      ${tooltip}
    </div>`;
  }

  /**
   * 기본 빠른 입찰 버튼 생성
   */
  function generateDefaultButtons(itemId, bidType) {
    return `<div class="quick-bid-buttons">
      <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 1, '${bidType}')">+1,000¥</button>
      <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 5, '${bidType}')">+5,000¥</button>
      <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 10, '${bidType}')">+10,000¥</button>
    </div>`;
  }

  /**
   * 스타옥션 2단계 입찰: 최소금액을 input에 설정
   */
  async function setStarAuctionMinimumBid(itemId) {
    if (typeof event !== "undefined" && event) {
      event.stopPropagation();
      event.preventDefault();
    }

    if (!window.AuthManager?.isAuthenticated()) {
      if (window.LoginRequiredModal) {
        window.LoginRequiredModal.show();
      } else {
        alert("입찰하려면 로그인이 필요합니다.");
      }
      return;
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (item) {
      const timer = getRemainingTime(item.scheduled_date, "first");
      if (!timer) {
        alert("마감된 상품입니다. 입찰이 불가능합니다.");
        return;
      }
    }

    try {
      const bidOptions = await getBidOptions(itemId, 3, item.starting_price);

      if (!bidOptions || !bidOptions.nextValidBid) {
        alert("입찰 가능한 금액을 계산할 수 없습니다.");
        return;
      }

      const autoCalculatedPrice = bidOptions.nextValidBid;

      // 입력 요소 찾기
      const inputElement = findBidInput(itemId, "direct");
      if (!inputElement) {
        alert("입찰 입력창을 찾을 수 없습니다.");
        return;
      }

      inputElement.value = autoCalculatedPrice / 1000;
      updateBidValueDisplay(inputElement);
      inputElement.dispatchEvent(new Event("input"));

      // 버튼 피드백
      if (typeof event !== "undefined" && event && event.target) {
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = "설정 완료!";
        button.classList.add("success");

        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove("success");
        }, 1500);
      }
    } catch (error) {
      alert(`최소금액 계산 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 입찰 input 요소 찾기 (여러 컨테이너에서)
   */
  function findBidInput(itemId, bidType) {
    const selectors = [
      `.modal-content .bid-input[data-item-id="${itemId}"][data-bid-type="${bidType}"]`,
      `.product-card[data-item-id="${itemId}"] .bid-input[data-bid-type="${bidType}"]`,
      `.bid-result-item[data-item-id="${itemId}"] .bid-input[data-bid-type="${bidType}"]`,
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  /**
   * 현장 경매 입찰 섹션 HTML 생성 (전체)
   */
  function getLiveBidSectionHTML(
    bidInfo,
    itemId,
    aucNum,
    category,
    options = { showTimer: true },
  ) {
    let item = _state.currentData.find((item) => item.item_id === itemId);

    if (!item && bidInfo?.item) {
      item = bidInfo.item;
      item.bid_type = "live";
    }
    if (!item) return "";

    const timerHTML = generateBidTimerHTML(bidInfo, item, options.showTimer);

    // 최종 입찰가가 있는 경우 간단히 표시
    if (bidInfo?.final_price) {
      return `<div class="bid-info live">
        ${timerHTML}
        <div class="final-price">
          <p>최종 입찰금액: ${cleanNumberFormat(bidInfo.final_price)} ¥</p>
          <div class="price-details-container">
            관부가세 포함 ${cleanNumberFormat(
              calculateTotalPrice(bidInfo.final_price, aucNum, category),
            )}원
          </div>
        </div>
      </div>`;
    }

    // 마감 여부 확인
    let bidStage = "first";
    if (bidInfo?.first_price && !bidInfo?.final_price) {
      bidStage = "final";
    }
    const timer = getRemainingTime(item.scheduled_date, bidStage);
    const isExpired = !timer;

    const priceHTML = generateLiveBidPriceHTML(bidInfo, item, aucNum, category);
    const inputHTML = generateBidInputHTML(
      bidInfo,
      itemId,
      aucNum,
      "live",
      isExpired,
    );

    return `<div class="bid-info live">${timerHTML}${priceHTML}${inputHTML}</div>`;
  }

  /**
   * 직접 경매 입찰 섹션 HTML 생성 (전체)
   */
  function getDirectBidSectionHTML(
    bidInfo,
    itemId,
    aucNum,
    category,
    options = { showTimer: true },
  ) {
    let item = _state.currentData.find((item) => item.item_id === itemId);

    if (!item && bidInfo?.item) {
      item = bidInfo.item;
      item.bid_type = "direct";
    }
    if (!item) return "";

    // 마감 여부 확인
    const timer = getRemainingTime(item.scheduled_date, "first");
    const isExpired = !timer;

    const statusHTML = generateDirectBidStatusHTML(bidInfo, item);
    const timerHTML = generateBidTimerHTML(bidInfo, item, options.showTimer);
    const priceHTML = generateDirectBidPriceHTML(
      bidInfo,
      item,
      aucNum,
      category,
    );
    const inputHTML = generateBidInputHTML(
      bidInfo,
      itemId,
      aucNum,
      "direct",
      isExpired,
    );

    return `<div class="bid-info direct">${statusHTML}${timerHTML}${priceHTML}${inputHTML}</div>`;
  }

  /**
   * 입찰 금액 표시 업데이트
   */
  function updateBidValueDisplay(inputElement) {
    const valueDisplay =
      inputElement.parentElement.querySelector(".bid-value-display");
    if (valueDisplay) {
      valueDisplay.textContent = "000";
    }
  }

  /**
   * 현장 경매 입찰 제출 처리
   */
  async function handleLiveBidSubmit(value, itemId) {
    if (!window.AuthManager?.isAuthenticated()) {
      if (window.LoginRequiredModal) {
        window.LoginRequiredModal.show();
      } else {
        alert("입찰하려면 로그인이 필요합니다.");
      }
      return;
    }

    // 중복 제출 방지: 이미 제출 중인 경우 무시
    const bidKey = `live-${itemId}`;
    if (_state.submittingBids.has(bidKey)) {
      console.log("입찰 제출이 이미 진행 중입니다.");
      return;
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    const bidInfo = _state.liveBidData.find((bid) => bid.item_id === itemId);

    if (item) {
      let bidStage = "first";
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        bidStage = "final";
      }

      const timer = getRemainingTime(item.scheduled_date, bidStage);
      if (!timer) {
        const stageText = bidStage === "final" ? "최종입찰" : "1차입찰";
        alert(`${stageText} 마감된 상품입니다. 입찰이 불가능합니다.`);
        return;
      }
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    const buttonElement = findBidButton(itemId, "live");
    if (window.bidLoadingUI && buttonElement) {
      window.bidLoadingUI.showBidLoading(buttonElement);
    }

    const numericValue = parseFloat(value) * 1000;

    // 제출 중 상태로 설정
    _state.submittingBids.add(bidKey);

    try {
      if (bidInfo) {
        if (bidInfo.status === "second") {
          await API.fetchAPI(`/live-bids/${bidInfo.id}/final`, {
            method: "PUT",
            body: JSON.stringify({ finalPrice: numericValue }),
          });
          alert("최종 입찰금액이 등록되었습니다.");
        } else {
          alert("이미 입찰한 상품입니다. 관리자의 2차 제안을 기다려주세요.");
          return;
        }
      } else {
        await API.fetchAPI("/live-bids", {
          method: "POST",
          body: JSON.stringify({
            itemId,
            aucNum: item.auc_num,
            firstPrice: numericValue,
          }),
        });
        alert("1차 입찰금액이 등록되었습니다.");
      }

      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("bidSuccess", { detail: { itemId, type: "live" } }),
        );
      }
    } catch (error) {
      alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      // 제출 완료 후 상태 제거
      _state.submittingBids.delete(bidKey);

      if (window.bidLoadingUI && buttonElement) {
        window.bidLoadingUI.hideBidLoading(buttonElement);
      }
    }
  }

  /**
   * 직접 경매 입찰 제출 처리
   */
  async function handleDirectBidSubmit(value, itemId) {
    if (!window.AuthManager?.isAuthenticated()) {
      if (window.LoginRequiredModal) {
        window.LoginRequiredModal.show();
      } else {
        alert("입찰하려면 로그인이 필요합니다.");
      }
      return;
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (item) {
      const timer = getRemainingTime(item.scheduled_date, "first");
      if (!timer) {
        alert("마감된 상품입니다. 입찰이 불가능합니다.");
        return;
      }
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    const numericValue = parseFloat(value) * 1000;

    // 경매장별 입찰 가격 검증
    if (item && item.auc_num) {
      const myBidInfo = _state.directBidData.find(
        (bid) => bid.item_id === itemId,
      );
      const isFirstBid = !myBidInfo || !myBidInfo.current_price;

      const validation = await validateBidPrice(
        numericValue,
        item.auc_num,
        itemId,
        isFirstBid,
      );
      if (!validation.valid) {
        alert(validation.message);
        return;
      }
    }

    const buttonElement = findBidButton(itemId, "direct");
    if (window.bidLoadingUI && buttonElement) {
      window.bidLoadingUI.showBidLoading(buttonElement);
    }

    try {
      await API.fetchAPI("/direct-bids", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          aucNum: item.auc_num,
          currentPrice: numericValue,
        }),
      });

      alert("입찰 금액이 등록되었습니다.");

      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("bidSuccess", { detail: { itemId, type: "direct" } }),
        );
      }
    } catch (error) {
      alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      if (window.bidLoadingUI && buttonElement) {
        window.bidLoadingUI.hideBidLoading(buttonElement);
      }
    }
  }

  /**
   * 입찰 버튼 찾기
   */
  function findBidButton(itemId, bidType) {
    const inputElement = findBidInput(itemId, bidType);
    return inputElement
      ?.closest(".bid-input-group")
      ?.querySelector(".bid-button");
  }

  /**
   * 빠른 입찰 금액 추가
   */
  async function quickAddBid(itemId, amount, bidType) {
    if (typeof event !== "undefined" && event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (!item) return;

    // 브랜드옥션 500엔 버튼 검증
    if (item.auc_num == 2 && amount === 0.5) {
      const myBidInfo = _state.directBidData.find(
        (bid) => bid.item_id === itemId,
      );
      const isFirstBid = !myBidInfo || !myBidInfo.current_price;

      if (isFirstBid) {
        alert("첫 입찰은 1,000엔 단위로만 가능합니다.");
        return;
      }
    }

    const inputElement = findBidInput(itemId, bidType);
    if (!inputElement) return;

    let currentValue = parseFloat(inputElement.value) || 0;
    if (currentValue === 0) {
      currentValue = parseFloat(item.starting_price) / 1000 || 0;
    }

    const newValue = currentValue + amount;
    inputElement.value = newValue;

    updateBidValueDisplay(inputElement);
    inputElement.dispatchEvent(new Event("input"));
  }

  /**
   * 현장 경매 입찰 정보 HTML (읽기 전용)
   */
  function getLiveBidInfoHTML(bidInfo, item) {
    if (!bidInfo) return "";

    let html = "";
    if (bidInfo.first_price) {
      html += `<div class="bid-price-info">
        <span class="price-label">1차 입찰금액</span>
        <span class="price-value">${cleanNumberFormat(
          bidInfo.first_price,
        )}￥</span>
        <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(bidInfo.first_price, item.auc_num, item.category),
        )}원</span>
      </div>`;
    }

    if (bidInfo.final_price) {
      html += `<div class="final-price">
        <span class="price-label">최종 입찰금액</span>
        <span class="price-value">${cleanNumberFormat(
          bidInfo.final_price,
        )}￥</span>
        <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(bidInfo.final_price, item.auc_num, item.category),
        )}원</span>
      </div>`;
    }

    return html;
  }

  /**
   * 직접 경매 입찰 정보 HTML (읽기 전용)
   */
  function getDirectBidInfoHTML(bidInfo, item) {
    if (!bidInfo || !bidInfo.current_price) return "";

    return `<div class="my-bid-price">
      <span class="price-label">나의 입찰 금액</span>
      <span class="price-value">${cleanNumberFormat(
        bidInfo.current_price,
      )}￥</span>
      <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
        calculateTotalPrice(bidInfo.current_price, item.auc_num, item.category),
      )}원</span>
    </div>`;
  }

  /**
   * 입찰 입력 UI HTML 생성 (레거시 지원용)
   */
  function getBidInputHTML(bidInfo, item, bidType) {
    let timer, isExpired;

    if (bidType === "live" && bidInfo?.first_price && !bidInfo?.final_price) {
      timer = getRemainingTime(item.scheduled_date, "final");
      isExpired = !timer;
    } else {
      timer = getRemainingTime(item.scheduled_date, "first");
      isExpired = !timer;
    }

    if (bidType === "live" && bidInfo?.final_price) {
      return "";
    }

    return generateBidInputHTML(
      bidInfo,
      item.item_id,
      item.auc_num,
      bidType,
      isExpired,
    );
  }

  /**
   * 카드에 표시할 입찰 정보 HTML 생성
   */
  function getBidInfoForCard(bidInfo, item) {
    if (!bidInfo) return "";

    if (item.bid_type === "instant") {
      const price = bidInfo.purchase_price || bidInfo.winning_price || 0;
      if (!price) return "";
      return `<div class="my-bid-price">
        <span class="price-label">구매 금액</span>
        <span class="price-value">${cleanNumberFormat(price)}￥</span>
        <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(price, item.auc_num, item.category),
        )}원</span>
      </div>`;
    } else if (item.bid_type === "direct") {
      return getDirectBidInfoHTML(bidInfo, item);
    } else {
      return getLiveBidInfoHTML(bidInfo, item);
    }
  }

  /**
   * 입찰 가격 계산기 초기화
   */
  function initializePriceCalculators() {
    document.querySelectorAll(".bid-input").forEach((input) => {
      const container =
        input.closest(".bid-input-group")?.nextElementSibling ||
        input
          .closest(".bid-input-container")
          ?.querySelector(".price-details-container");

      if (!container) return;

      const itemId = input.getAttribute("data-item-id");
      const bidType = input.getAttribute("data-bid-type");
      const item = _state.currentData.find((item) => item.item_id == itemId);

      if (container && item) {
        // 기존 이벤트 리스너 제거
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        newInput.addEventListener("input", function () {
          const price = parseFloat(this.value) * 1000 || 0;
          const totalPrice = calculateTotalPrice(
            price,
            item.auc_num,
            item.category,
          );

          const message =
            bidType === "direct"
              ? "(관부가세 포함 " + cleanNumberFormat(totalPrice) + "원)"
              : "(관부가세 포함 " + cleanNumberFormat(totalPrice) + "원)";

          container.innerHTML = price ? message : "";
          updateBidValueDisplay(this);
        });
      }
    });
  }

  /**
   * 타이머 업데이트 시작
   */
  function startTimerUpdates() {
    if (window.timerInterval) {
      clearInterval(window.timerInterval);
    }

    window.timerInterval = setInterval(() => {
      document.querySelectorAll(".bid-timer").forEach((timerElement) => {
        const itemId = getItemIdFromTimer(timerElement);
        if (!itemId) return;

        const item = _state.currentData.find((item) => item.item_id === itemId);
        if (!item || !item.scheduled_date) return;

        let bidStage = "first";
        let stageText = "입찰마감";

        if (item.bid_type === "live") {
          const bidInfo = _state.liveBidData.find(
            (bid) => bid.item_id === itemId,
          );

          stageText = "1차입찰마감";
          if (bidInfo?.first_price && !bidInfo?.final_price) {
            bidStage = "final";
            stageText = "최종입찰마감";
          } else if (bidInfo?.final_price) {
            timerElement.textContent = "입찰완료";
            timerElement.className = "bid-timer completed";
            return;
          }
        } else {
          bidStage = "first";
          stageText = "입찰마감";
        }

        const timer = getRemainingTime(item.scheduled_date, bidStage);
        if (!timer) {
          const remainingTimeEl = timerElement.querySelector(".remaining-time");
          if (remainingTimeEl) {
            remainingTimeEl.textContent = "[마감됨]";
          } else {
            timerElement.textContent = `${stageText} [마감됨]`;
          }
          timerElement.classList.remove("near-end");
          timerElement.classList.add("expired");
          return;
        }

        const remainingTimeEl = timerElement.querySelector(".remaining-time");
        if (remainingTimeEl) {
          remainingTimeEl.textContent = `[${timer.text}]`;
        } else {
          timerElement.textContent = `${stageText} 남은시간 [${timer.text}]`;
        }

        if (timer.isNearEnd) {
          timerElement.classList.add("near-end");
        } else {
          timerElement.classList.remove("near-end");
        }

        timerElement.classList.remove("expired");
      });
    }, 1000);
  }

  /**
   * 타이머 요소에서 아이템 ID 추출
   */
  function getItemIdFromTimer(timerElement) {
    return (
      timerElement.closest(".product-card")?.dataset.itemId ||
      timerElement.closest(".bid-result-item")?.dataset.itemId ||
      timerElement.closest(".modal-content")?.querySelector(".modal-title")
        ?.dataset.itemId
    );
  }

  /**
   * 모듈 초기화
   */
  function initialize(isAuthenticated, currentData = []) {
    _state.isAuthenticated = isAuthenticated;
    _state.currentData = currentData;

    window.addEventListener("bidSuccess", function (e) {
      // 입찰 성공 후 데이터 새로고침 이벤트
    });
  }

  /**
   * 입찰 데이터 업데이트
   */
  function updateBidData(liveBids, directBids, instantPurchases) {
    _state.liveBidData = liveBids || [];
    _state.directBidData = directBids || [];
    _state.instantPurchaseData = instantPurchases || [];
  }

  /**
   * 현재 표시 중인 상품 데이터 업데이트
   */
  function updateCurrentData(data) {
    _state.currentData = data || [];
  }

  /**
   * 인증 상태 설정
   */
  function setAuthStatus(isAuthenticated) {
    _state.isAuthenticated = isAuthenticated;
  }

  // 공개 API
  return {
    // 상태 조회
    getLiveBidData: () => _state.liveBidData,
    getDirectBidData: () => _state.directBidData,
    getInstantPurchaseData: () => _state.instantPurchaseData,

    // 초기화
    initialize,
    updateBidData,
    updateCurrentData,
    setAuthStatus,

    // 타이머 관련
    getRemainingTime,
    startTimerUpdates,

    // UI 생성 함수
    getLiveBidSectionHTML,
    getDirectBidSectionHTML,
    getLiveBidInfoHTML,
    getDirectBidInfoHTML,
    getBidInputHTML,
    getBidInfoForCard,

    // 입찰 처리 함수
    handleLiveBidSubmit,
    handleDirectBidSubmit,
    setStarAuctionMinimumBid,
    quickAddBid,

    // 검증 및 옵션 함수
    getBidOptions,
    validateBidPrice,
    getQuickBidButtonsHTML,

    // 기타 유틸리티
    initializePriceCalculators,
    updateBidValueDisplay,
  };
})();

/**
 * 모바일 툴팁 기능 설정
 */
function setupMobileBidTooltips() {
  document.addEventListener("touchstart", function (e) {
    if (e.target.classList.contains("increment-500") && e.target.disabled) {
      showMobileTooltip(
        e.target,
        "첫 입찰은 1,000엔, 이후 입찰은 500엔 단위로 입찰 가능합니다.",
      );
    }
  });
}

function showMobileTooltip(element, message) {
  const existingTooltip = document.querySelector(".mobile-tooltip");
  if (existingTooltip) {
    existingTooltip.remove();
  }

  const tooltip = document.createElement("div");
  tooltip.className = "mobile-tooltip";
  tooltip.innerHTML = `
    <div class="tooltip-content">
      <span class="tooltip-icon">❓</span>
      <span class="tooltip-message">${message}</span>
    </div>
  `;

  const rect = element.getBoundingClientRect();
  tooltip.style.position = "fixed";
  tooltip.style.top = rect.top - 60 + "px";
  tooltip.style.left = rect.left + rect.width / 2 + "px";
  tooltip.style.transform = "translateX(-50%)";

  document.body.appendChild(tooltip);

  setTimeout(() => {
    tooltip.remove();
  }, 3000);
}

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  setupMobileBidTooltips();
});
