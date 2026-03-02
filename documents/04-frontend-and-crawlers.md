# 프론트엔드 구조 및 크롤러 시스템 문서

> 최종 업데이트: 2026-03-02

---

## 1. 프론트엔드 아키텍처

### 1.1 개요

프론트엔드는 **SPA 프레임워크 없이** 서버 사이드 HTML 렌더링 방식으로 구현되어 있습니다. Express가 정적 HTML 파일을 서빙하고, 각 페이지의 JavaScript가 API를 호출하여 동적 콘텐츠를 렌더링합니다.

### 1.2 페이지 라우팅

#### 메인 서비스 페이지 (`pages/*.html`)

| URL 경로              | 파일                        | 인증   | 설명             |
| --------------------- | --------------------------- | ------ | ---------------- |
| `/`                   | → `/productPage` 리다이렉트 | X      | 메인 → 상품 목록 |
| `/productPage`        | `product.html`              | X      | 상품 목록 (메인) |
| `/recommendPage`      | `recommend.html`            | X      | 추천 상품        |
| `/signinPage`         | `signin.html`               | X      | 로그인           |
| `/signupCompletePage` | `signup-complete.html`      | X      | 회원가입 완료    |
| `/valuesPage`         | `values.html`               | 로그인 | 시세 조회        |
| `/bidResultsPage`     | `bid-results.html`          | 로그인 | 입찰 결과        |
| `/bidProductsPage`    | `bid-products.html`         | 로그인 | 입찰 중 상품     |
| `/inquiryPage`        | `inquiry.html`              | X      | 문의             |
| `/guidePage`          | `guide.html`                | X      | 이용 안내        |
| `/myPage`             | `my-page.html`              | 로그인 | 마이페이지       |
| `/bidGuidePage`       | `bid-guide.html`            | X      | 입찰 가이드      |

#### 관리자 페이지 (`pages/admin/*.html`)

| URL 경로                   | 파일                     | 권한              | 설명               |
| -------------------------- | ------------------------ | ----------------- | ------------------ |
| `/admin`                   | `index.html`             | dashboard 메뉴    | 관리자 대시보드    |
| `/admin/live-bids`         | `live-bids.html`         | live-bids         | 실시간 입찰 관리   |
| `/admin/direct-bids`       | `direct-bids.html`       | direct-bids       | 다이렉트 입찰 관리 |
| `/admin/instant-purchases` | `instant-purchases.html` | instant-purchases | 바로 구매 관리     |
| `/admin/all-bids`          | `all-bids.html`          | all-bids          | 전체 입찰 조회     |
| `/admin/bid-results`       | `bid-results.html`       | bid-results       | 입찰 결과/정산     |
| `/admin/transactions`      | `transactions.html`      | transactions      | 거래 내역          |
| `/admin/invoices`          | `invoices.html`          | invoices          | 인보이스 관리      |
| `/admin/users`             | `users.html`             | users             | 사용자 관리        |
| `/admin/recommend-filters` | `recommend-filters.html` | recommend-filters | 추천 필터          |
| `/admin/settings`          | `settings.html`          | settings          | 설정               |
| `/admin/wms`               | `wms.html`               | wms               | 창고 관리          |
| `/admin/repair-management` | `repair-management.html` | repair-management | 수선 관리          |
| `/admin/shipping`          | `shipping.html`          | shipping          | 배송 관리          |
| `/admin/activity-logs`     | `activity-logs.html`     | activity-logs     | 활동 로그          |
| `/admin/admin-permissions` | `admin-permissions.html` | 슈퍼관리자        | 관리자 권한 설정   |

#### 감정 시스템 페이지 (`pages/appr/*.html`)

| URL 경로                        | 파일                                          | 인증   | 설명             |
| ------------------------------- | --------------------------------------------- | ------ | ---------------- |
| `/appr`                         | `index.html`                                  | X      | 감정 시스템 메인 |
| `/appr/signin`                  | `signin.html`                                 | X      | 감정 로그인      |
| `/appr/signup`                  | `signup.html`                                 | X      | 감정 회원가입    |
| `/appr/request`                 | `request.html`                                | X      | 감정 요청        |
| `/appr/request-repair/:certNo`  | `request-repair.html`                         | X      | 수선 요청        |
| `/appr/result`                  | `result.html`                                 | X      | 감정번호 조회    |
| `/appr/result/:certNo`          | `result-detail.html` 또는 `quick-result.html` | X      | 감정 결과 상세   |
| `/appr/repair`                  | `repair.html`                                 | X      | 수선 안내        |
| `/appr/authenticity`            | `authenticity.html`                           | X      | 정품 감별 가이드 |
| `/appr/issue/:id`               | `issue.html`                                  | X      | 감정서 발급      |
| `/appr/mypage`                  | `mypage.html`                                 | 로그인 | 감정 마이페이지  |
| `/appr/admin`                   | `admin.html`                                  | 관리자 | 감정 관리자      |
| `/appr/payment-processing.html` | `payment-processing.html`                     | 로그인 | 결제 처리        |

#### 호스트 기반 라우팅

```
cassystem.com → 자동으로 /appr 접두사 추가
casastrade.com → 일반 라우팅
```

### 1.3 JavaScript 파일 구조

#### 공용 스크립트 (`public/js/*.js`)

| 파일                   | 설명                         |
| ---------------------- | ---------------------------- |
| `common.js`            | 공통 유틸리티, API 호출 헬퍼 |
| `api.js`               | API 통신 모듈                |
| `main.js`              | 메인 페이지 로직             |
| `products.js`          | 상품 목록 렌더링             |
| `recommend.js`         | 추천 상품 페이지             |
| `values.js`            | 시세 조회 페이지             |
| `bids.js`              | 입찰 관련 로직               |
| `bid-products.js`      | 입찰 중 상품 페이지          |
| `bid-products-core.js` | 입찰 상품 핵심 로직          |
| `bid-results.js`       | 입찰 결과 페이지             |
| `bid-results-core.js`  | 입찰 결과 핵심 로직          |
| `my-page.js`           | 마이페이지 로직              |
| `my-page-shipping.js`  | 마이페이지 배송 관련         |
| `notices.js`           | 공지사항 표시                |
| `traker.js`            | 방문자 추적                  |
| `admin.js`             | 관리자 공용 로직             |

#### 관리자 스크립트 (`public/js/admin/*.js`)

| 파일                   | 설명                  |
| ---------------------- | --------------------- |
| `dashboard.js`         | 대시보드 통계/차트    |
| `live-bids.js`         | 실시간 입찰 관리 UI   |
| `direct-bids.js`       | 다이렉트 입찰 관리 UI |
| `instant-purchases.js` | 바로 구매 관리 UI     |
| `all-bids.js`          | 전체 입찰 조회 UI     |
| `bid-results.js`       | 입찰 결과 관리 UI     |
| `transactions.js`      | 거래 내역 관리 UI     |
| `invoices.js`          | 인보이스 관리 UI      |
| `users.js`             | 사용자 관리 UI        |
| `recommend-filters.js` | 추천 필터 관리 UI     |
| `settings.js`          | 설정 관리 UI          |
| `wms.js`               | WMS 관리 UI           |
| `repair-management.js` | 수선 관리 UI          |
| `shipping.js`          | 배송 관리 UI          |
| `activity-logs.js`     | 활동 로그 조회 UI     |
| `admin-permissions.js` | 관리자 권한 설정 UI   |
| `download-progress.js` | 다운로드 진행률 UI    |
| `api.js`               | 관리자 API 통신       |
| `common.js`            | 관리자 공통 유틸리티  |

#### 감정 관리 스크립트 (`public/js/appr-admin/*.js`)

| 파일                     | 설명                  |
| ------------------------ | --------------------- |
| `appraisals.js`          | 감정 관리 UI          |
| `authenticity-guides.js` | 정품 감별 가이드 관리 |
| `banners.js`             | 배너 관리             |
| `payments.js`            | 결제 관리 UI          |
| `requests.js`            | 감정 요청 관리        |
| `restorations.js`        | 복원 서비스 관리      |
| `users.js`               | 감정 사용자 관리      |

### 1.4 CSS 파일 구조

#### 공용 스타일 (`public/styles/*.css`)

| 파일               | 설명             |
| ------------------ | ---------------- |
| `common.css`       | 전체 공통 스타일 |
| `header.css`       | 헤더/네비게이션  |
| `main.css`         | 메인 페이지      |
| `signin.css`       | 로그인 페이지    |
| `my-page.css`      | 마이페이지       |
| `bid-products.css` | 입찰 상품        |
| `bid-results.css`  | 입찰 결과        |
| `notices.css`      | 공지사항         |
| `admin.css`        | 관리자 기본      |

#### 관리자 스타일 (`public/styles/admin/*.css`)

- 관리자 페이지별 개별 스타일 파일

---

## 2. 크롤러 시스템 상세

### 2.1 아키텍처

```
           ┌──────────────────────┐
           │   AdaptiveScheduler  │ ← 변경율 기반 간격 자동 조절
           │   (routes/crawler.js)│
           └──────────┬───────────┘
                      │
              ┌───────┼───────┐
              ▼       ▼       ▼
         [cron 기반] [수동 트리거] [Socket.IO 알림]
              │
              ▼
    ┌─────────────────────────┐
    │    Crawler Instances     │
    ├─────────────────────────┤
    │ ecoAucCrawler           │ ← EcoAuc (HTML Scraping)
    │ brandAucCrawler         │ ← BrandAuc (JSON API)
    │ starAucCrawler          │ ← StarAuc
    │ mekikiAucCrawler        │ ← MekikiAuc
    │ penguinAucCrawler       │ ← PenguinAuc
    │ + 각각의 ValueCrawler   │ ← 시세 데이터
    └──────────┬──────────────┘
               │ extends
               ▼
    ┌─────────────────────────┐
    │   AxiosCrawler (Base)   │
    ├─────────────────────────┤
    │ - 세션 관리 (Cookie Jar)│
    │ - 프록시 로테이션       │
    │ - 로그인 상태 관리      │
    │ - 재시도 + 백오프       │
    │ - 멀티 클라이언트       │
    └──────────┬──────────────┘
               │ uses
               ▼
    ┌─────────────────────────┐
    │   ProxyManager          │
    │ (utils/proxy.js)        │
    └─────────────────────────┘
```

### 2.2 기본 크롤러 (`baseCrawler.js` — AxiosCrawler)

#### 세션 관리

| 설정             | 값                         |
| ---------------- | -------------------------- |
| 세션 타임아웃    | 8시간                      |
| 로그인 체크 캐싱 | 5분                        |
| 자동 갱신        | 백그라운드 로그인 리프레시 |

#### 프록시 로테이션

- 요청마다 프록시 IP 순환 (라운드 로빈)
- 실패 시 다음 프록시로 자동 전환
- Cookie Jar 유지

#### 재시도 전략

- 최대 재시도: 설정 가능
- 지수 백오프: 실패마다 대기 시간 증가
- HTTP 429/503: 자동 대기 후 재시도

#### 멀티 클라이언트

- 하나의 크롤러가 복수의 HTTP 클라이언트 유지
- 각 클라이언트가 독립적 세션/쿠키 보유
- 부하 분산 및 차단 회피

### 2.3 EcoAuc 크롤러 (`ecoAuc.js`)

| 항목            | 상세                                                                |
| --------------- | ------------------------------------------------------------------- |
| **auc_num**     | 1                                                                   |
| **사이트**      | ecoauc.com                                                          |
| **크롤링 방식** | HTML 스크래핑 (cheerio)                                             |
| **카테고리**    | 시계, 가방, 귀금속, 악세서리, 의류, 식기류, 잡화, 그림/미술품 (8개) |
| **수수료**      | 티어별 차등 (10% ~ 3%)                                              |

#### 크롤링 흐름

1. 로그인 (세션 획득)
2. 경매 일정 목록 조회
3. 카테고리별 상품 목록 페이지네이션
4. 각 상품 상세 페이지 파싱 (CSS 셀렉터)
5. 이미지 URL 추출 및 처리
6. DB 저장 (`crawled_items` / `values_items`)

### 2.4 BrandAuc 크롤러 (`brandAuc.js`)

| 항목            | 상세                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **auc_num**     | 2                                                                                               |
| **사이트**      | brand-auc.com                                                                                   |
| **크롤링 방식** | JSON API (`u.brand-auc.com/api/v1`)                                                             |
| **카테고리**    | Watch, Bag, Precious metal, Clothing, Accessories, Tableware, Variety, Painting/Art, Coin (9개) |
| **수수료**      | 고정 ¥2,200                                                                                     |

#### 크롤링 흐름

1. API 인증 (토큰)
2. `/api/v1/lots` 엔드포인트 호출
3. JSON 응답 파싱
4. 멀티 클라이언트 병렬 처리
5. DB 저장

### 2.5 기타 크롤러

| 크롤러         | auc_num | 파일            | 비고              |
| -------------- | ------- | --------------- | ----------------- |
| **StarAuc**    | 3       | `starAuc.js`    | 입찰 단위: 티어별 |
| **MekikiAuc**  | 4       | `mekikiAuc.js`  | -                 |
| **PenguinAuc** | 5       | `penguinAuc.js` | 시세 크롤링 없음  |

### 2.6 크롤링 유형

| 유형                               | 대상 테이블     | 설명                         |
| ---------------------------------- | --------------- | ---------------------------- |
| **상품 크롤링** (crawl)            | `crawled_items` | 현재 경매 예정/진행 중 상품  |
| **시세 크롤링** (value-crawl)      | `values_items`  | 과거 경매 결과 (낙찰가 포함) |
| **업데이트 크롤링** (update-crawl) | `crawled_items` | 기존 데이터 업데이트         |

### 2.7 AdaptiveScheduler

크롤링 빈도를 자동으로 조절하는 스마트 스케줄러.

```
변경율 높음 → 크롤링 간격 단축 (최소 5분)
변경율 낮음 → 크롤링 간격 연장 (최대 2시간)
변경 없음   → 점진적 간격 증가
```

### 2.8 데이터 저장 (DBManager)

크롤링된 데이터의 DB 저장을 관리.

| 기능        | 설명                                      |
| ----------- | ----------------------------------------- |
| UPSERT      | `item_id + auc_num` 기준 중복 처리        |
| 이미지 처리 | 크롤링 후 비동기 이미지 다운로드/리사이즈 |
| ES 인덱싱   | 저장 후 Elasticsearch 인덱스 업데이트     |
| 필터 동기화 | 새 브랜드/카테고리/날짜 자동 필터 등록    |

---

## 3. 데이터베이스 구조 요약

### 3.1 핵심 테이블 관계도

```
users (428)
  ├─→ user_accounts (389) ........... 1:1 계좌/예치금 정보
  ├─→ user_member_groups ............ N:M 회원 그룹
  ├─→ live_bids (15,560) ............ 1:N 실시간 입찰
  ├─→ direct_bids (8,904) ........... 1:N 다이렉트 입찰
  ├─→ instant_purchases (4) ......... 1:N 바로 구매
  ├─→ bids (405) .................... 1:N 예약 입찰
  ├─→ wishlists (3,299) ............. 1:N 위시리스트
  ├─→ deposit_transactions (7,570) .. 1:N 예치금 거래
  ├─→ daily_settlements (562) ....... 1:N 일일 정산
  └─→ popbill_documents (142) ....... 1:N 세금/영수증

crawled_items (79,245) ............... 경매 상품 데이터
  ├── item_id + auc_num (UNIQUE)
  ├── bid_type (live/direct/instant)
  └── is_enabled, is_expired, recommend

values_items (1,506,648) ............. 시세 데이터
  ├── item_id + auc_num (UNIQUE)
  └── final_price (낙찰가)

appraisals (609) ..................... 감정 데이터
  ├── appraisal_type (quicklink/offline/from_auction)
  └── certificate_number, result

wms_items (277) ...................... 창고 물품
  ├─→ wms_scan_events (132) ......... 바코드 이력
  ├─→ wms_repair_cases (86) ......... 수선 케이스
  └─── wms_locations (12) ........... 창고 위치 (FK)

shipments (0) ........................ 배송 정보
  └── logen_slip_no, tracking_number
```

### 3.2 테이블 규모 (예상 행 수)

| 규모        | 테이블                                                                       |
| ----------- | ---------------------------------------------------------------------------- |
| **150만+**  | `values_items`                                                               |
| **7만+**    | `crawled_items`, `translation_cache`                                         |
| **1만+**    | `live_bids`, `admin_activity_logs`, `direct_bids`, `deposit_transactions`    |
| **100~999** | `bids`, `daily_settlements`, `appraisals`, `users`, `wishlists`, `wms_items` |
| **10 미만** | `admin_settings`, `appr_users`, `instant_purchases`, `shipments`             |

### 3.3 주요 인덱스 전략

| 테이블                 | 핵심 인덱스                                                  | 용도             |
| ---------------------- | ------------------------------------------------------------ | ---------------- |
| `crawled_items`        | `idx_main_query` (brand, category, scheduled_date, bid_type) | 상품 목록 필터링 |
| `crawled_items`        | `idx_ci_fulltext_title` (FULLTEXT)                           | 제목 검색        |
| `crawled_items`        | `idx_item_id_auc_num` (UNIQUE)                               | 크롤링 중복 방지 |
| `values_items`         | `idx_main_filters` (brand, category, scheduled_date)         | 시세 필터링      |
| `live_bids`            | `unique_user_item` (user_id, item_id)                        | 중복 입찰 방지   |
| `direct_bids`          | `unique_user_item` (user_id, item_id)                        | 중복 입찰 방지   |
| `daily_settlements`    | `unique_user_date` (user_id, settlement_date)                | 정산 중복 방지   |
| `deposit_transactions` | `idx_pending` (status, retry_count, created_at)              | 미처리 건 조회   |

---

## 4. 실시간 통신 (Socket.IO)

### 사용 목적

- **크롤링 진행 상태** 실시간 전송 (관리자 화면)
- 크롤링 완료/에러 알림

### 구조

```javascript
// server.js
global.io = initializeSocket(server);

// routes/crawler.js
initializeSocket(server) {
  const io = require('socket.io')(server, { cors: {...} });
  io.on('connection', (socket) => { ... });
  return io;
}

// 크롤링 중 이벤트 발송
global.io.emit('crawl-progress', { site, progress, total, status });
global.io.emit('crawl-complete', { site, itemCount, duration });
global.io.emit('crawl-error', { site, error });
```
