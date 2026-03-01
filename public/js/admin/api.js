// public/js/admin/api.js
// Admin 전용 API 함수들 - 공통 api.js 기능 활용

// 공통 API 함수 사용
async function fetchAPI(endpoint, options = {}) {
  return await window.API.fetchAPI(endpoint, options);
}

// ---- 대시보드 API ----

// 요약 정보 조회
async function fetchDashboardSummary() {
  return fetchAPI("/dashboard/summary");
}

// 최근 활동 조회
async function fetchRecentActivities() {
  return fetchAPI("/dashboard/activities");
}

// 비즈니스 KPI 데이터 조회
async function fetchBusinessKPI() {
  return fetchAPI("/dashboard/kpi");
}

// CEO 요약 데이터 조회
async function fetchExecutiveSummary() {
  return fetchAPI("/dashboard/executive-summary");
}

// 활성 경매 정보 조회
async function fetchActiveAuctions() {
  return fetchAPI("/dashboard/active-auctions");
}

// 활성 사용자 정보 조회
async function fetchActiveUsers() {
  return fetchAPI("/dashboard/active-users");
}

// 사용자 통계 조회
async function fetchUserStats() {
  try {
    // API 호출
    return await fetchAPI("/metrics");
  } catch (error) {
    // 에러 발생 시 기본값 반환
    console.error("사용자 통계 가져오기 실패:", error);

    // metrics 모듈이 구현되지 않은 경우를 위한 샘플 데이터
    return {
      activeMemberUsers: 0,
      activeGuestUsers: 0,
      totalActiveUsers: 0,
      dailyMemberUsers: 0,
      dailyGuestUsers: 0,
      totalDailyUsers: 0,
      totalRequests: 0,
      uniquePageviews: 0,
      lastReset: new Date().toISOString(),
      lastManualReset: null,
    };
  }
}

// ---- 현장 경매 API ----

// 현장 경매 목록 조회 (페이지네이션, 정렬, 날짜 필터 추가)
async function fetchLiveBids(
  status = "",
  page = 1,
  limit = 10,
  sortBy = "original_scheduled_date", // 기본값 변경
  sortOrder = "desc",
  fromDate = "",
  toDate = "",
  search = "",
  aucNum = "",
) {
  const params = new URLSearchParams({
    status: status,
    page: page,
    limit: limit,
  });

  if (search) {
    params.append("search", search);
  }

  if (sortBy) {
    params.append("sortBy", sortBy);
  }

  if (sortOrder) {
    params.append("sortOrder", sortOrder);
  }

  if (fromDate) {
    params.append("fromDate", fromDate);
  }

  if (toDate) {
    params.append("toDate", toDate);
  }

  if (aucNum) {
    params.append("aucNum", aucNum);
  }

  const data = await fetchAPI(`/live-bids?${params.toString()}`);
  return data;
}

// 2차 입찰가 제안
async function proposeSecondPrice(bidId, secondPrice, itemId = "") {
  const payload = { secondPrice };
  if (itemId) payload.itemId = itemId;

  return fetchAPI(`/live-bids/${bidId}/second`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 현장 경매 낙찰 완료 처리 - 단일 또는 다중 처리 지원
async function completeBid(idOrIds, winningPrice) {
  // 단일 ID인지 배열인지 확인
  const isArray = Array.isArray(idOrIds);
  const payload = isArray ? { ids: idOrIds } : { id: idOrIds };

  // winningPrice가 있으면 추가
  if (winningPrice !== undefined) {
    payload.winningPrice = winningPrice;
  }

  return fetchAPI("/live-bids/complete", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 현장 경매 낙찰 실패 처리 - 단일 또는 다중 처리 지원
async function cancelBid(idOrIds) {
  // 단일 ID인지 배열인지 확인
  const isArray = Array.isArray(idOrIds);
  const payload = isArray ? { ids: idOrIds } : { id: idOrIds };

  return fetchAPI("/live-bids/cancel", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 현장 경매 수정
async function updateLiveBid(bidId, updateData) {
  return fetchAPI(`/live-bids/${bidId}`, {
    method: "PUT",
    body: JSON.stringify(updateData),
  });
}

// ---- 직접 경매 API ----

// 직접 경매 목록 조회 (페이지네이션, 정렬, 날짜 필터 추가)
async function fetchDirectBids(
  status = "",
  highestOnly = true,
  page = 1,
  limit = 10,
  sortBy = "original_scheduled_date", // 기본값 변경
  sortOrder = "desc",
  fromDate = "",
  toDate = "",
  search = "",
  aucNum = "",
) {
  const params = new URLSearchParams({
    status: status,
    highestOnly: highestOnly,
    page: page,
    limit: limit,
  });

  if (search) {
    params.append("search", search);
  }

  if (sortBy) {
    params.append("sortBy", sortBy);
  }

  if (sortOrder) {
    params.append("sortOrder", sortOrder);
  }

  if (fromDate) {
    params.append("fromDate", fromDate);
  }

  if (toDate) {
    params.append("toDate", toDate);
  }

  if (aucNum) {
    params.append("aucNum", aucNum);
  }

  const data = await fetchAPI(`/direct-bids?${params.toString()}`);
  return data;
}

// 특정 직접 경매 조회
async function fetchDirectBid(bidId) {
  return fetchAPI(`/direct-bids/${bidId}`);
}

// 입찰 제출
async function placeBid(itemId, currentPrice) {
  return fetchAPI("/direct-bids", {
    method: "POST",
    body: JSON.stringify({ itemId, currentPrice }),
  });
}

// 직접 경매 낙찰 완료 처리 - 단일 또는 다중 처리 지원
async function completeDirectBid(idOrIds, winningPrice) {
  const isArray = Array.isArray(idOrIds);
  const payload = isArray ? { ids: idOrIds } : { id: idOrIds };

  if (winningPrice !== undefined) {
    payload.winningPrice = winningPrice;
  }

  return fetchAPI("/direct-bids/complete", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 직접 경매 낙찰 실패 처리 - 단일 또는 다중 처리 지원
async function cancelDirectBid(idOrIds) {
  // 단일 ID인지 배열인지 확인
  const isArray = Array.isArray(idOrIds);
  const payload = isArray ? { ids: idOrIds } : { id: idOrIds };

  return fetchAPI("/direct-bids/cancel", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 직접 경매 플랫폼 반영 완료 표시 - 단일 또는 다중 처리 지원
async function markDirectBidAsSubmitted(idOrIds) {
  // 단일 ID인지 배열인지 확인
  const isArray = Array.isArray(idOrIds);
  const payload = isArray ? { ids: idOrIds } : { id: idOrIds };

  return fetchAPI("/direct-bids/mark-submitted", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// 직접 경매 수정
async function updateDirectBid(bidId, updateData) {
  return fetchAPI(`/direct-bids/${bidId}`, {
    method: "PUT",
    body: JSON.stringify(updateData),
  });
}

// ---- 바로 구매 API ----

// 바로 구매 목록 조회
async function fetchInstantPurchases(
  status = "",
  page = 1,
  limit = 10,
  sortBy = "created_at",
  sortOrder = "desc",
  fromDate = "",
  toDate = "",
  search = "",
) {
  const params = new URLSearchParams({ page, limit });
  if (status) params.append("status", status);
  if (search) params.append("search", search);
  if (sortBy) params.append("sortBy", sortBy);
  if (sortOrder) params.append("sortOrder", sortOrder);
  if (fromDate) params.append("fromDate", fromDate);
  if (toDate) params.append("toDate", toDate);
  return fetchAPI(`/instant-purchases?${params.toString()}`);
}

// 바로 구매 취소
async function cancelInstantPurchase(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  return fetchAPI("/instant-purchases/cancel", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

// 바로 구매 배송 상태 변경
async function updateInstantShippingStatus(idOrIds, shippingStatus) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  return fetchAPI("/instant-purchases/shipping-status", {
    method: "PUT",
    body: JSON.stringify({ ids, shipping_status: shippingStatus }),
  });
}

// ---- 관리자 설정 API ----

// 크롤링 상태 체크
async function checkCrawlingStatus() {
  return fetchAPI("/crawler/crawl-status");
}

// 상품 크롤링 시작
async function startProductCrawling() {
  return fetchAPI("/crawler/crawl", { method: "GET" });
}

// 시세표 크롤링 시작
async function startValueCrawling(queryParams = "") {
  return fetchAPI(
    `/crawler/crawl-values${queryParams ? "?" + queryParams : ""}`,
    { method: "GET" },
  );
}

// 현장 경매 완료/출고 카테고리의 낙찰금액(winning_price)을 시세표 final_price로 덮어쓰기
async function overwriteValuesFinalPrice() {
  return fetchAPI("/crawler/overwrite-values-final-price", {
    method: "POST",
  });
}

// 크롤링 스케줄 설정
async function updateCrawlSchedule(crawlSchedule) {
  return fetchAPI("/admin/settings", {
    method: "POST",
    body: JSON.stringify({ crawlSchedule }),
  });
}

// 공지 목록 조회
async function fetchNotices() {
  return fetchAPI("/admin/notices");
}

// 특정 공지 조회
async function fetchNotice(noticeId) {
  return fetchAPI(`/admin/notices/${noticeId}`);
}

// 공지 저장
async function saveNotice(noticeData) {
  const { id, ...data } = noticeData;

  if (id) {
    return fetchAPI(`/admin/notices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  } else {
    return fetchAPI("/admin/notices", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

// 공지 삭제
async function deleteNotice(noticeId) {
  return fetchAPI(`/admin/notices/${noticeId}`, {
    method: "DELETE",
  });
}

// 필터 설정 조회
async function fetchFilterSettings() {
  return fetchAPI("/admin/filter-settings");
}

// 필터 설정 업데이트
async function updateFilterSetting(filterType, filterValue, isEnabled) {
  return fetchAPI("/admin/filter-settings", {
    method: "PUT",
    body: JSON.stringify({ filterType, filterValue, isEnabled }),
  });
}

// 필터 설정 일괄 업데이트
async function updateFilterSettingsBatch(settings) {
  // settings: [{ filterType, filterValue, isEnabled }, ...]
  return fetchAPI("/admin/filter-settings/batch", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
}

// ---- 추천 설정 API ----

// 추천 설정 목록 조회
async function fetchRecommendSettings() {
  return fetchAPI("/admin/recommend-settings");
}

// 새 추천 설정 생성
async function createRecommendSetting(settingData) {
  // settingData: { ruleName, conditions, recommendScore }
  return fetchAPI("/admin/recommend-settings", {
    method: "POST",
    body: JSON.stringify(settingData),
  });
}

// 추천 설정 업데이트
async function updateRecommendSetting(settingId, settingData) {
  // settingData: { ruleName, conditions, recommendScore, isEnabled }
  return fetchAPI(`/admin/recommend-settings/${settingId}`, {
    method: "PUT",
    body: JSON.stringify(settingData),
  });
}

// 추천 설정 삭제
async function deleteRecommendSetting(settingId) {
  return fetchAPI(`/admin/recommend-settings/${settingId}`, {
    method: "DELETE",
  });
}

// 추천 설정 배치 업데이트
async function updateRecommendSettingsBatch(settings) {
  // settings: [{ id, ruleName, conditions, recommendScore, isEnabled }, ...]
  return fetchAPI("/admin/recommend-settings/batch", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
}

// ---- 회원 관리 API ----

// 회원 목록 조회
async function fetchUsers(status = "") {
  return fetchAPI(`/users?status=${status}`);
}

// 회원관리 VIP TOP 10 조회
async function fetchUsersVipTop10() {
  return fetchAPI("/users/vip-top10");
}

// 특정 회원 조회
async function fetchUser(userId) {
  return fetchAPI(`/users/${encodeURIComponent(userId)}`);
}

// 특정 회원 입찰 내역 조회
async function fetchUserBidHistory(userId) {
  return fetchAPI(`/users/${encodeURIComponent(userId)}/bid-history`);
}

// 새 회원 생성
async function createUser(userData) {
  // 날짜 필드가 있는 경우 서버에서 처리할 수 있도록 형식화
  if (userData.registration_date) {
    // 날짜 형식이 이미 YYYY-MM-DD인 경우 그대로 사용
    if (!/^\d{4}-\d{2}-\d{2}$/.test(userData.registration_date)) {
      const date = new Date(userData.registration_date);
      userData.registration_date = date.toISOString().split("T")[0];
    }
  }

  return fetchAPI("/users", {
    method: "POST",
    body: JSON.stringify(userData),
  });
}

// 회원 정보 수정
async function updateUser(userId, userData) {
  // 날짜 필드가 있는 경우 서버에서 처리할 수 있도록 형식화
  if (userData.registration_date) {
    // 날짜 형식이 이미 YYYY-MM-DD인 경우 그대로 사용
    if (!/^\d{4}-\d{2}-\d{2}$/.test(userData.registration_date)) {
      const date = new Date(userData.registration_date);
      userData.registration_date = date.toISOString().split("T")[0];
    }
  }

  return fetchAPI(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(userData),
  });
}

// 회원 삭제
async function deleteUser(userId) {
  return fetchAPI(`/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

// 구글 스프레드시트와 회원 동기화
async function syncUsers() {
  return fetchAPI("/users/sync", {
    method: "POST",
  });
}

// ---- 회원 그룹 API ----
async function fetchMemberGroups() {
  return fetchAPI("/admin/member-groups");
}

async function createMemberGroup(name) {
  return fetchAPI("/admin/member-groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

async function deleteMemberGroup(groupId) {
  return fetchAPI(`/admin/member-groups/${groupId}`, { method: "DELETE" });
}

async function fetchGroupMembers(groupId) {
  return fetchAPI(`/admin/member-groups/${groupId}/members`);
}

async function addMemberToGroup(groupId, userId) {
  return fetchAPI(`/admin/member-groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

async function removeMemberFromGroup(groupId, userId) {
  return fetchAPI(`/admin/member-groups/${groupId}/members/${userId}`, {
    method: "DELETE",
  });
}

async function addMembersToGroupBatch(groupId, userIds) {
  return fetchAPI(`/admin/member-groups/${groupId}/members/batch`, {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

async function removeMembersFromGroupBatch(groupId, userIds) {
  return fetchAPI(`/admin/member-groups/${groupId}/members/batch-remove`, {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

// 인보이스 목록 조회
async function fetchInvoices(page = 1, limit = 20, filters = {}) {
  const params = new URLSearchParams({
    page,
    limit,
  });

  // 필터 추가
  if (filters.auc_num) params.append("auc_num", filters.auc_num);
  if (filters.status) params.append("status", filters.status);
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);

  return fetchAPI(`/admin/invoices?${params.toString()}`);
}

// 인보이스 크롤링 실행
async function crawlInvoices() {
  return fetchAPI("/crawler/crawl-invoices", { method: "GET" });
}

// ---- 유틸리티 함수 ----
