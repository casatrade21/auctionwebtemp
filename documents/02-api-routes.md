# API 라우트 명세 (API Routes Reference)

> 최종 업데이트: 2026-03-02

## 목차

1. [인증 API](#1-인증-api-apiauthjs)
2. [상품 데이터 API](#2-상품-데이터-api-apidatajs)
3. [상품 상세 API](#3-상품-상세-api-apidetailjs)
4. [시세 데이터 API](#4-시세-데이터-api-apivaluesjs)
5. [실시간 경매 API](#5-실시간-경매-api-apilive-bidsjs)
6. [다이렉트 입찰 API](#6-다이렉트-입찰-api-apidirect-bidsjs)
7. [바로 구매 API](#7-바로-구매-api-apiinstant-purchasesjs)
8. [입찰 결과/정산 API](#8-입찰-결과정산-api-apibid-resultsjs)
9. [예치금 API](#9-예치금-api-apidepositsjs)
10. [사용자 관리 API](#10-사용자-관리-api-apiusersjs)
11. [위시리스트 API](#11-위시리스트-api-apiwishlistjs)
12. [관리자 API](#12-관리자-api-apiadminjs)
13. [대시보드 API](#13-대시보드-api-apidashboardjs)
14. [크롤러 제어 API](#14-크롤러-제어-api-apicrawlerjs)
15. [Popbill 연동 API](#15-popbill-연동-api-apipopbilljs)
16. [WMS API](#16-wms-api-apiwmsjs)
17. [수선 관리 API](#17-수선-관리-api-apirepair-managementjs)
18. [배송 관리 API](#18-배송-관리-api-apishippingjs)
19. [감정 시스템 API](#19-감정-시스템-api-apiapprjs)
20. [사이트맵](#20-사이트맵)
21. [메트릭 API](#21-메트릭-api)

---

## 공통 사항

### 인증 방식

- **세션 기반 인증**: `express-session` + MySQL 세션 스토어
- 쿠키명: `session_cookie_name`
- 세션 만료: 24시간 (rolling)

### 인증 미들웨어

| 미들웨어          | 설명                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `isAuthenticated` | 로그인 사용자 확인 (`req.session.user` 존재 여부)                   |
| `isAdmin`         | 관리자 권한 확인 (superadmin 또는 is_admin_panel=1 또는 role=admin) |
| `requireAdmin`    | `isAdmin`과 동일, `adminAuth.js`에서 export                         |

### 응답 형식

```json
// 성공
{ "success": true, "data": {...} }

// 실패
{ "success": false, "message": "오류 메시지", "code": "ERROR_CODE" }
```

---

## 1. 인증 API (`/api/auth.js`)

| 메서드 | 경로                 | 인증 | 설명                           |
| ------ | -------------------- | ---- | ------------------------------ |
| `POST` | `/api/auth/login`    | X    | 로그인 (SHA-256 비밀번호 해시) |
| `POST` | `/api/auth/logout`   | X    | 로그아웃 (세션 파기)           |
| `GET`  | `/api/auth/user`     | X    | 현재 세션 사용자 정보 조회     |
| `POST` | `/api/auth/register` | X    | 감정 시스템 회원가입           |

### POST `/api/auth/login`

```json
// Request
{ "login_id": "string", "password": "string" }

// Response
{
  "success": true,
  "user": {
    "id": 1,
    "login_id": "user01",
    "email": "...",
    "company_name": "...",
    "phone": "...",
    "role": "normal",
    "is_superadmin": 0,
    "is_admin_panel": 0,
    "allowed_menus": "[...]"
  }
}
```

---

## 2. 상품 데이터 API (`/api/data.js`)

| 메서드 | 경로        | 인증 | 설명                                     |
| ------ | ----------- | ---- | ---------------------------------------- |
| `GET`  | `/api/data` | X    | 경매 상품 목록 조회 (페이징, 필터, 검색) |

### GET `/api/data`

**쿼리 파라미터:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `brands` | string | - | 브랜드 필터 (쉼표 구분) |
| `categories` | string | - | 카테고리 필터 (쉼표 구분) |
| `dates` | string | - | 날짜 필터 (쉼표 구분, YYYY-MM-DD) |
| `aucNums` | string | - | 경매장 번호 (1:EcoAuc, 2:BrandAuc, 3:StarAuc, ...) |
| `ranks` | string | - | 등급 필터 (쉼표 구분) |
| `search` | string | - | 검색어 (ES 또는 DB LIKE) |
| `sort` | string | - | 정렬 기준 |
| `bidType` | string | - | 입찰 유형 (live, direct, instant) |
| `recommendOnly` | boolean | false | 추천 상품만 표시 |

**특징:**

- 필터 데이터 10분 캐싱 (brands, categories, dates, ranks, aucNums)
- Elasticsearch 우선, 실패 시 DB LIKE fallback
- full-width → half-width 문자 변환 (등급 정규화)

---

## 3. 상품 상세 API (`/api/detail.js`)

| 메서드 | 경로                                | 인증 | 설명                |
| ------ | ----------------------------------- | ---- | ------------------- |
| `POST` | `/api/detail/item-details/:itemId`  | X    | 경매 상품 상세 조회 |
| `POST` | `/api/detail/value-details/:itemId` | X    | 시세 상품 상세 조회 |

**특징:**

- AWS Translate로 일본어 설명 번역 (LRU 캐시 500개)
- `processItem()`으로 이미지, 입찰 정보 포함한 풍부한 데이터 반환

---

## 4. 시세 데이터 API (`/api/values.js`)

| 메서드 | 경로          | 인증   | 설명                       |
| ------ | ------------- | ------ | -------------------------- |
| `GET`  | `/api/values` | 로그인 | 과거 경매 시세 데이터 조회 |

`/api/data`와 유사한 필터/페이징 구조. `values_items` 테이블에서 조회. 낙찰가(`final_price`) 포함.

---

## 5. 실시간 경매 API (`/api/live-bids.js`)

| 메서드   | 경로                                 | 인증   | 설명                  |
| -------- | ------------------------------------ | ------ | --------------------- |
| `GET`    | `/api/live-bids`                     | 관리자 | 실시간 입찰 목록 조회 |
| `POST`   | `/api/live-bids`                     | 관리자 | 실시간 입찰 생성      |
| `PUT`    | `/api/live-bids/:id`                 | 관리자 | 입찰 정보 수정        |
| `PUT`    | `/api/live-bids/:id/status`          | 관리자 | 상태 변경             |
| `PUT`    | `/api/live-bids/:id/shipping-status` | 관리자 | 배송 상태 변경        |
| `DELETE` | `/api/live-bids/:id`                 | 관리자 | 입찰 삭제             |

### 상태 플로우

```
first → second → final → completed → shipped
                              ↘ cancelled
```

**핵심 로직:**

- `completed` 전환 시: 정산 생성 (`settlement.js`), 예치금 차감 (`deposit.js`), WMS 동기화
- `cancelled` 전환 시: 예치금 환불
- `shipped` 전환 시: WMS 출고 처리

---

## 6. 다이렉트 입찰 API (`/api/direct-bids.js`)

| 메서드   | 경로                                   | 인증   | 설명                                       |
| -------- | -------------------------------------- | ------ | ------------------------------------------ |
| `GET`    | `/api/direct-bids`                     | 관리자 | 다이렉트 입찰 목록 (highestOnly 필터 지원) |
| `POST`   | `/api/direct-bids`                     | 관리자 | 다이렉트 입찰 생성                         |
| `PUT`    | `/api/direct-bids/:id`                 | 관리자 | 입찰 정보 수정                             |
| `PUT`    | `/api/direct-bids/:id/status`          | 관리자 | 상태 변경 (active→completed/cancelled)     |
| `PUT`    | `/api/direct-bids/:id/shipping-status` | 관리자 | 배송 상태 변경                             |
| `DELETE` | `/api/direct-bids/:id`                 | 관리자 | 입찰 삭제                                  |

**특징:**

- `highestOnly=true`: 동일 상품에 대해 최고 입찰금만 표시
- 경매 플랫폼별 입찰 단위 검증 (`submitBid.js`)
- cron 기반 자동 상태 업데이트

---

## 7. 바로 구매 API (`/api/instant-purchases.js`)

| 메서드 | 경로                                         | 인증   | 설명                |
| ------ | -------------------------------------------- | ------ | ------------------- |
| `GET`  | `/api/instant-purchases`                     | 관리자 | 바로 구매 목록 조회 |
| `POST` | `/api/instant-purchases`                     | 관리자 | 바로 구매 생성      |
| `PUT`  | `/api/instant-purchases/:id/status`          | 관리자 | 상태 변경           |
| `PUT`  | `/api/instant-purchases/:id/shipping-status` | 관리자 | 배송 상태 변경      |

**상태:** `pending → completed/cancelled`

---

## 8. 입찰 결과/정산 API (`/api/bid-results.js`)

| 메서드 | 경로                                      | 인증   | 설명                                |
| ------ | ----------------------------------------- | ------ | ----------------------------------- |
| `GET`  | `/api/bid-results`                        | 로그인 | 사용자별 입찰 결과 조회 (날짜 범위) |
| `GET`  | `/api/bid-results/settlements`            | 관리자 | 정산 목록 조회                      |
| `PUT`  | `/api/bid-results/settlements/:id`        | 관리자 | 정산 정보 수정                      |
| `POST` | `/api/bid-results/settlements/:id/adjust` | 관리자 | 예치금 조정                         |
| `GET`  | `/api/bid-results/export`                 | 관리자 | Excel 내보내기                      |

**핵심 기능:**

- 날짜별 그룹화된 입찰 결과
- 수수료 계산 (경매사 수수료 + 관세 + 부가세)
- 환율 적용
- 사용자별 커미션 비율

---

## 9. 예치금 API (`/api/deposits.js`)

| 메서드 | 경로                        | 인증   | 설명           |
| ------ | --------------------------- | ------ | -------------- |
| `POST` | `/api/deposits/charge`      | 로그인 | 충전 요청      |
| `POST` | `/api/deposits/refund`      | 로그인 | 환불 요청      |
| `GET`  | `/api/deposits`             | 로그인 | 거래 내역 조회 |
| `GET`  | `/api/deposits/balance`     | 로그인 | 잔액 조회      |
| `PUT`  | `/api/deposits/:id/approve` | 관리자 | 충전/환불 승인 |
| `PUT`  | `/api/deposits/:id/reject`  | 관리자 | 충전/환불 거절 |

**계정 유형:**
| 유형 | 설명 | 잔액 관리 |
|------|------|----------|
| `individual` (개인) | 예치금 잔액 방식 | `deposit_balance` 필드 |
| `corporate` (법인) | 일별 한도 방식 | `daily_limit` - `daily_used` |

---

## 10. 사용자 관리 API (`/api/users.js`)

| 메서드   | 경로                        | 인증   | 설명                    |
| -------- | --------------------------- | ------ | ----------------------- |
| `GET`    | `/api/users/current`        | 로그인 | 현재 로그인 사용자 정보 |
| `GET`    | `/api/users`                | 관리자 | 사용자 목록 조회        |
| `GET`    | `/api/users/:id`            | 관리자 | 사용자 상세 정보        |
| `POST`   | `/api/users`                | 관리자 | 사용자 생성             |
| `PUT`    | `/api/users/:id`            | 관리자 | 사용자 정보 수정        |
| `DELETE` | `/api/users/:id`            | 관리자 | 사용자 삭제             |
| `PUT`    | `/api/users/:id/commission` | 관리자 | 커미션 비율 설정        |
| `PUT`    | `/api/users/:id/password`   | 관리자 | 비밀번호 변경           |

---

## 11. 위시리스트 API (`/api/wishlist.js`)

| 메서드   | 경로            | 인증   | 설명                                     |
| -------- | --------------- | ------ | ---------------------------------------- |
| `POST`   | `/api/wishlist` | 로그인 | 위시리스트 추가 (favorite_number: 1,2,3) |
| `GET`    | `/api/wishlist` | 로그인 | 위시리스트 조회                          |
| `DELETE` | `/api/wishlist` | 로그인 | 위시리스트 삭제                          |

---

## 12. 관리자 API (`/api/admin.js`)

| 메서드     | 경로                            | 인증       | 설명                          |
| ---------- | ------------------------------- | ---------- | ----------------------------- |
| `GET`      | `/api/admin/settings`           | 관리자     | 관리자 설정 조회              |
| `POST`     | `/api/admin/settings`           | 관리자     | 관리자 설정 저장              |
| `GET`      | `/api/admin/notices`            | 관리자     | 공지사항 목록                 |
| `POST`     | `/api/admin/notices`            | 관리자     | 공지사항 생성 (이미지 업로드) |
| `PUT`      | `/api/admin/notices/:id`        | 관리자     | 공지사항 수정                 |
| `DELETE`   | `/api/admin/notices/:id`        | 관리자     | 공지사항 삭제                 |
| `GET/POST` | `/api/admin/filter-settings`    | 관리자     | 필터 설정 관리                |
| `GET/POST` | `/api/admin/recommend-settings` | 관리자     | 추천 설정 관리                |
| `GET`      | `/api/admin/permissions`        | 슈퍼관리자 | 관리자 권한 목록              |
| `POST`     | `/api/admin/permissions`        | 슈퍼관리자 | 관리자 권한 설정              |
| `GET`      | `/api/admin/activity-logs`      | 관리자     | 관리자 활동 로그              |
| `GET`      | `/api/admin/export/*`           | 관리자     | Excel 내보내기                |

**관리자 메뉴 키:**

```
dashboard, live-bids, direct-bids, instant-purchases, all-bids,
bid-results, transactions, invoices, users, recommend-filters,
settings, wms, repair-management, activity-logs, shipping
```

---

## 13. 대시보드 API (`/api/dashboard.js`)

| 메서드 | 경로                     | 인증   | 설명                       |
| ------ | ------------------------ | ------ | -------------------------- |
| `GET`  | `/api/dashboard/summary` | 관리자 | 종합 통계 (캐시: 자정까지) |

**반환 데이터:**

- Live Bids 통계 (상태별 건수, 금액)
- Direct Bids 통계
- Instant Purchases 통계
- 예정 경매 일정
- 사용자 수

---

## 14. 크롤러 제어 API (`/api/crawler.js`)

| 메서드 | 경로                        | 인증   | 설명                   |
| ------ | --------------------------- | ------ | ---------------------- |
| `POST` | `/api/crawler/crawl`        | 관리자 | 전체 크롤링 실행       |
| `POST` | `/api/crawler/value-crawl`  | 관리자 | 시세 크롤링 실행       |
| `POST` | `/api/crawler/update-crawl` | 관리자 | 업데이트 크롤링        |
| `GET`  | `/api/crawler/status`       | 관리자 | 크롤링 상태 조회       |
| `POST` | `/api/crawler/reindex`      | 관리자 | Elasticsearch 재인덱싱 |

**특징:**

- Socket.IO를 통한 실시간 진행 상태 전송
- `AdaptiveScheduler`: 변경 비율에 따라 크롤링 간격 자동 조절
- cron 기반 정기 크롤링

**크롤러 목록:**
| auc_num | 크롤러 | 사이트 | 방식 |
|---------|--------|--------|------|
| 1 | `ecoAucCrawler` | EcoAuc | HTML 스크래핑 (cheerio) |
| 2 | `brandAucCrawler` | BrandAuc | JSON API |
| 3 | `starAucCrawler` | StarAuc | - |
| 4 | `mekikiAucCrawler` | MekikiAuc | - |
| 5 | `penguinAucCrawler` | PenguinAuc | - |

---

## 15. Popbill 연동 API (`/api/popbill.js`)

| 메서드 | 경로                            | 인증   | 설명                      |
| ------ | ------------------------------- | ------ | ------------------------- |
| `POST` | `/api/popbill/check-payment`    | 로그인 | 입금 확인 (사용자 트리거) |
| `GET`  | `/api/popbill/transactions`     | 관리자 | 은행 거래 내역 조회       |
| `POST` | `/api/popbill/auto-approve`     | 관리자 | 자동 입금 매칭/승인       |
| `POST` | `/api/popbill/issue-cashbill`   | 관리자 | 현금영수증 발행           |
| `POST` | `/api/popbill/issue-taxinvoice` | 관리자 | 세금계산서 발행           |

**자동 입금 확인 로직:**

1. Popbill EasyFinBank API로 은행 거래 내역 조회
2. 입금자명 + 금액으로 충전 요청과 매칭
3. 매칭 성공 시 자동 승인 → 예치금 반영
4. cron으로 주기적 확인

---

## 16. WMS API (`/api/wms.js`)

| 메서드 | 경로                 | 인증   | 설명                       |
| ------ | -------------------- | ------ | -------------------------- |
| `GET`  | `/api/wms/items`     | 관리자 | WMS 아이템 목록            |
| `GET`  | `/api/wms/items/:id` | 관리자 | WMS 아이템 상세            |
| `POST` | `/api/wms/scan`      | 관리자 | 바코드 스캔 (위치 이동)    |
| `GET`  | `/api/wms/locations` | 관리자 | 창고 위치 목록             |
| `POST` | `/api/wms/backfill`  | 관리자 | 미등록 낙찰 상품 일괄 등록 |

**WMS 존(Zone):**
| 코드 | 설명 |
|------|------|
| `DOMESTIC_ARRIVAL_ZONE` | 국내 도착 구역 |
| `INTERNAL_REPAIR_ZONE` | 내부 수선 구역 |
| `EXTERNAL_REPAIR_ZONE` | 외부 수선 구역 |
| `REPAIR_DONE_ZONE` | 수선 완료 구역 |
| `HOLD_ZONE` | 보류 구역 |
| `OUTBOUND_ZONE` | 출고 구역 |

---

## 17. 수선 관리 API (`/api/repair-management.js`)

| 메서드 | 경로                                     | 인증   | 설명                 |
| ------ | ---------------------------------------- | ------ | -------------------- |
| `GET`  | `/api/repair-management/vendors`         | 관리자 | 수선 업체 목록       |
| `POST` | `/api/repair-management/vendors`         | 관리자 | 수선 업체 등록       |
| `GET`  | `/api/repair-management/cases`           | 관리자 | 수선 케이스 목록     |
| `POST` | `/api/repair-management/cases`           | 관리자 | 수선 케이스 생성     |
| `PUT`  | `/api/repair-management/cases/:id`       | 관리자 | 수선 케이스 수정     |
| `POST` | `/api/repair-management/sync-sheet`      | 관리자 | Google Sheets 동기화 |
| `POST` | `/api/repair-management/batch-reconcile` | 관리자 | 일괄 조정            |

**수선 케이스 상태 플로우:**

```
ARRIVED → DRAFT → PROPOSED → ACCEPTED → DONE
                                ↘ REJECTED
```

**수선 업체:**

- 리리, 크리뉴, 성신사(종로), 연희, 까사(내부)

---

## 18. 배송 관리 API (`/api/shipping.js`)

| 메서드 | 경로                                   | 인증   | 설명               |
| ------ | -------------------------------------- | ------ | ------------------ |
| `GET`  | `/api/shipping/shipments`              | 관리자 | 배송 목록 조회     |
| `POST` | `/api/shipping/shipments`              | 관리자 | 배송 생성          |
| `PUT`  | `/api/shipping/shipments/:id`          | 관리자 | 배송 정보 수정     |
| `POST` | `/api/shipping/shipments/:id/label`    | 관리자 | 배송 라벨 PDF 생성 |
| `POST` | `/api/shipping/shipments/:id/register` | 관리자 | Logen 주문 등록    |
| `GET`  | `/api/shipping/shipments/:id/track`    | 관리자 | 배송 추적          |

**배송 상태 플로우:**

```
ready → slip_issued → order_registered → picked_up → in_transit
→ out_for_delivery → delivered
                  ↘ failed / returned
```

---

## 19. 감정 시스템 API (`/api/appr/*`)

### 20.1 감정 요청 (`/api/appr/appraisals`)

| 메서드 | 경로                      | 인증   | 설명              |
| ------ | ------------------------- | ------ | ----------------- |
| `POST` | `/api/appr/appraisals`    | 로그인 | 감정 요청 생성    |
| `GET`  | `/api/appr/appraisals/my` | 로그인 | 내 감정 내역 조회 |

**감정 유형:**
| 유형 | 설명 | 필수 필드 |
|------|------|----------|
| `quicklink` | URL 기반 온라인 감정 | product_link |
| `offline` | 실물 오프라인 감정 | delivery_info |
| `from_auction` | 옥션 낙찰 상품 감정 | - |

### 20.2 감정 관리자 (`/api/appr/admin`)

| 메서드 | 경로                                         | 인증   | 설명                |
| ------ | -------------------------------------------- | ------ | ------------------- |
| `GET`  | `/api/appr/admin/appraisals`                 | 관리자 | 감정 요청 목록      |
| `PUT`  | `/api/appr/admin/appraisals/:id`             | 관리자 | 감정 결과 입력      |
| `POST` | `/api/appr/admin/appraisals/:id/certificate` | 관리자 | 감정서 발급         |
| `GET`  | `/api/appr/admin/appraisals/:id/pdf`         | 관리자 | 감정서 PDF 다운로드 |
| `POST` | `/api/appr/admin/appraisals/export-zip`      | 관리자 | 감정서 ZIP 내보내기 |

**감정 결과:** `authentic` (정품) / `fake` (가품) / `uncertain` (보류)

### 20.3 결제 (`/api/appr/payments`)

| 메서드 | 경로                          | 인증   | 설명                |
| ------ | ----------------------------- | ------ | ------------------- |
| `POST` | `/api/appr/payments/prepare`  | 로그인 | 결제 준비 (NICEpay) |
| `POST` | `/api/appr/payments/callback` | X      | 결제 콜백           |

### 20.4 복원 서비스 (`/api/appr/restorations`)

| 메서드 | 경로                              | 인증   | 설명             |
| ------ | --------------------------------- | ------ | ---------------- |
| `GET`  | `/api/appr/restorations/services` | X      | 복원 서비스 목록 |
| `POST` | `/api/appr/restorations`          | 로그인 | 복원 요청        |

### 20.5 감정 사용자 (`/api/appr/users`)

| 메서드 | 경로                           | 인증   | 설명             |
| ------ | ------------------------------ | ------ | ---------------- |
| `GET`  | `/api/appr/users/profile`      | 로그인 | 감정 프로필 조회 |
| `GET`  | `/api/appr/users/subscription` | 로그인 | 구독 정보 조회   |

---

## 20. 사이트맵

| 메서드 | 경로           | 인증 | 설명                                             |
| ------ | -------------- | ---- | ------------------------------------------------ |
| `GET`  | `/sitemap.xml` | X    | 동적 사이트맵 생성 (Express 라우트 인트로스펙션) |

---

## 21. 메트릭 API

| 메서드 | 경로                 | 인증 | 설명                    |
| ------ | -------------------- | ---- | ----------------------- |
| `GET`  | `/api/metrics`       | X    | 사이트 분석 데이터 조회 |
| `POST` | `/api/metrics/reset` | X    | 메트릭 초기화           |

**수집 데이터:** 활성 사용자, 일일 방문자, 총 요청 수, 고유 페이지뷰
