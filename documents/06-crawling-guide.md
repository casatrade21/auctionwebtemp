# 크롤링 시스템 가이드 (Crawling System Guide)

> 최종 업데이트: 2026-03-02

---

## 1. 아키텍처 개요

```
┌─────────────────────────────────────────────────────┐
│                  routes/crawler.js                   │
│  (스케줄링, API 엔드포인트, 크롤링 오케스트레이션)       │
└──────────┬───────────────┬──────────────┬───────────┘
           │               │              │
    ┌──────▼──────┐  ┌─────▼─────┐  ┌────▼─────┐
    │  crawlAll() │  │crawlAll   │  │crawl     │
    │  (상품)      │  │Values()   │  │Update()  │
    └──────┬──────┘  │(시세표)    │  │(실시간)   │
           │         └─────┬─────┘  └────┬─────┘
           ▼               ▼             ▼
┌──────────────────────────────────────────────────────┐
│              crawlers/ (크롤러 모듈)                    │
│  ┌──────────────────────────────────────────────┐    │
│  │         baseCrawler.js (AxiosCrawler)        │    │
│  │  - 로그인/세션 관리                            │    │
│  │  - 프록시 라운드 로빈                          │    │
│  │  - 재시도/유틸 메서드                          │    │
│  └──────────────┬───────────────────────────────┘    │
│     ┌───────────┼───────────┬──────────┬────────┐    │
│     ▼           ▼           ▼          ▼        ▼    │
│  ecoAuc     brandAuc    starAuc   mekikiAuc penguin  │
│  Crawler    Crawler     Crawler   Crawler   Crawler  │
│  (auc:1)    (auc:2)     (auc:3)   (auc:4)   (auc:5) │
└──────┬──────────┬───────────┬──────────┬────────┬────┘
       │          │           │          │        │
       ▼          ▼           ▼          ▼        ▼
┌──────────────────────────────────────────────────────┐
│                  인프라 계층                           │
│  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌───────────┐  │
│  │ProxyMgr  │ │DBManager│ │process │ │s3Migration│  │
│  │(proxy.js)│ │         │ │Image   │ │           │  │
│  └──────────┘ └─────────┘ └────────┘ └───────────┘  │
│  ┌──────────┐ ┌─────────┐ ┌────────┐                │
│  │Elastic   │ │translator│ │message │                │
│  │search    │ │(번역)    │ │(알림톡) │                │
│  └──────────┘ └─────────┘ └────────┘                │
└──────────────────────────────────────────────────────┘
```

---

## 2. 경매 사이트별 크롤러 현황

### 2.1 크롤러 인스턴스 구성

각 경매 사이트마다 **상품 크롤러**(crawledItems)와 **시세표 크롤러**(valuesItems, 선택)가 존재합니다.

| auc_num | 사이트     | 상품 크롤러         | 시세표 크롤러           | 다중 클라이언트 | 현재 활성   |
| ------- | ---------- | ------------------- | ----------------------- | --------------- | ----------- |
| 1       | EcoAuc     | `ecoAucCrawler`     | `ecoAucValueCrawler`    | ✅ (프록시)     | ✅          |
| 2       | BrandAuc   | `brandAucCrawler`   | `brandAucValueCrawler`  | ✅ (프록시)     | ✅          |
| 3       | StarAuc    | `starAucCrawler`    | `starAucValueCrawler`   | ❌ (단일)       | ❌ (비활성) |
| 4       | MekikiAuc  | `mekikiAucCrawler`  | `mekikiAucValueCrawler` | ❌ (단일)       | ✅          |
| 5       | PenguinAuc | `penguinAucCrawler` | 없음                    | ✅ (프록시)     | ✅          |

### 2.2 사이트별 특성 비교

| 특성            | EcoAuc       | BrandAuc              | StarAuc     | MekikiAuc        | PenguinAuc       |
| --------------- | ------------ | --------------------- | ----------- | ---------------- | ---------------- |
| 데이터 형식     | HTML 파싱    | JSON API              | HTML 파싱   | JSON API         | HTML 파싱        |
| 파싱 도구       | cheerio      | axios (JSON)          | cheerio     | axios (JSON)     | cheerio          |
| 인증 방식       | CSRF + Form  | CSRF + Form           | CSRF + Form | Bearer Token     | Form POST        |
| 입찰 유형       | live, direct | live, direct, instant | direct      | live             | direct           |
| 언어            | 영문         | 영문                  | 영문        | 일문 (번역 필요) | 일문 (번역 필요) |
| Rate Limit      | 보통         | 보통                  | 엄격        | 엄격 (10초 간격) | 보통             |
| 시세표 크롤링   | ✅           | ✅                    | ✅          | ✅               | ❌               |
| 인보이스 크롤링 | ✅           | ✅                    | ✅          | ❌               | ❌               |

---

## 3. 크롤러 기본 클래스: `AxiosCrawler` (baseCrawler.js)

### 3.1 핵심 기능

`AxiosCrawler`는 모든 크롤러의 부모 클래스로, 아래 기능을 제공합니다:

#### 로그인/세션 관리

- **세션 타임아웃**: 8시간 (`sessionTimeout`)
- **로그인 체크 캐싱**: 5분 간격 (`loginCheckInterval`)
- **로그인 중복 방지**: Promise 기반 동시 로그인 방지
- **자동 재로그인**: 세션 만료 시 자동 재로그인

#### 프록시/클라이언트 관리

- **단일 모드**: `useMultipleClients: false` → 직접 연결만 사용
- **다중 모드**: `useMultipleClients: true` → 직접 연결 1개 + 프록시 N개
- **라운드 로빈**: 로그인된 클라이언트들 사이에서 순환 선택
- **클라이언트 재생성**: 세션 무효 시 cookieJar 포함 전체 재생성

#### 유틸리티 메서드

- `retryOperation(fn, maxRetries, delay)` — 지수 백오프 재시도
- `extractDate(text)` — 다양한 날짜 형식 파싱 (영문/숫자/일본식)
- `currencyToInt(str)` — 통화 문자열 → 정수 변환
- `convertToKST(utcString)` — UTC → KST 변환
- `isCollectionDay(date)` — 화/목(수거일) 제외 필터
- `getPreviousDayAt18(date)` — Live 경매: 전날 18시 마감 계산
- `isAuctionTimeValid(date)` — 경매 시간 유효성 체크
- `convertFullWidthToAscii(str)` — 전각 문자 → ASCII 변환

### 3.2 자식 클래스에서 반드시 구현해야 하는 메서드

```javascript
// 필수 구현 (추상 메서드)
async performLoginWithClient(clientInfo)   // 특정 클라이언트로 로그인
async getStreamingMetadata(months)         // 시세표 크롤링용 메타데이터
async crawlChunkPages(chunk, existingIds)  // 시세표 청크 크롤링

// 주요 크롤링 메서드 (자식 클래스에서 구현)
async crawlAllItems(existingIds)           // 전체 상품 크롤링
async crawlUpdates()                       // 실시간 업데이트 크롤링
async crawlUpdateWithIds(itemIds)          // ID 기반 업데이트 크롤링
async crawlItemDetails(itemId, item)       // 상품 상세 정보 크롤링

// 입찰 메서드 (해당 경매사에만)
async directBid(item_id, price)            // 다이렉트 입찰
async liveBid(item_id, price)              // 현장 경매 입찰
async instantBuy(...)                      // 바로 구매 (BrandAuc만)
async crawlInvoices()                      // 인보이스 크롤링
```

### 3.3 `config` 객체 구조

새 크롤러를 추가할 때 필요한 설정:

```javascript
const newAucConfig = {
  name: "NewAuc",                          // 크롤러 이름
  baseUrl: "https://example.com",          // 사이트 기본 URL
  loginCheckUrls: ["https://..."],         // 로그인 상태 확인 URL (200이면 로그인됨)
  loginPageUrl: "https://...",             // 로그인 페이지 URL
  loginPostUrl: "https://...",             // 로그인 POST URL
  searchUrl: "https://...",                // 상품 목록 검색 URL
  loginData: {                             // 로그인 자격증명 (.env 참조)
    userId: process.env.CRAWLER_EMAIL_N,
    password: process.env.CRAWLER_PASSWORD_N,
  },
  useMultipleClients: true,                // 프록시 사용 여부
  categoryIds: ["1", "2", "3"],            // 카테고리 ID 목록
  categoryTable: {                         // 카테고리 매핑 (한국어)
    1: "시계", 2: "가방", 3: "귀금속",
  },
  signinSelectors: { ... },                // HTML 파싱 기반일 때 선택자
  crawlSelectors: { ... },                 // 목록 페이지 선택자
  crawlDetailSelectors: { ... },           // 상세 페이지 선택자
  searchParams: (categoryId, page) => ..., // 검색 URL 파라미터 생성 함수
  detailUrl: (itemId) => ...,              // 상세 페이지 URL 생성 함수
};
```

---

## 4. 입찰 유형별 크롤링 흐름

### 4.1 Live Bid (현장 경매)

현장 경매는 지정된 날짜에 실시간으로 진행되며, 사전에 최대 입찰가를 등록합니다.

```
crawlAllItems() → bid_type: "live"
  └─ 경매 일정: original_scheduled_date (실제 경매일)
  └─ 마감시간: scheduled_date = 전날 18:00 (getPreviousDayAt18)
  └─ 지난 경매 필터링: isAuctionTimeValid() → false면 제외
  └─ 입찰: liveBid(item_id, price) → 경매 사이트에 사전 입찰 등록
```

**지원 사이트**: EcoAuc(1), BrandAuc(2), MekikiAuc(4)

**Live 특이사항**:

- `scheduled_date`는 실제 경매일이 아닌 **전날 18:00**으로 설정 (사전 입찰 마감 시간)
- `original_scheduled_date`에 실제 경매 일정 보관
- BrandAuc의 경우 `kaisaiKaisu`(회차), `kaijoCd`(회장 코드) 정보 필요

### 4.2 Direct Bid (다이렉트 입찰)

온라인에서 기간 내 가격을 제시하는 방식입니다.

```
crawlAllItems() → bid_type: "direct"
  └─ 경매 일정: scheduled_date = 마감 일시 (사이트마다 다름)
  └─ 입찰: directBid(item_id, price) → 사이트에 입찰가 전송
  └─ 업데이트: crawlUpdates() → 가격/일정 변경 감지
  └─ ID 업데이트: crawlUpdateWithIds(ids) → 입찰한 아이템 실시간 추적
```

**지원 사이트**: EcoAuc(1), BrandAuc(2), StarAuc(3), PenguinAuc(5)

**Direct 특이사항**:

- 가격 변경 시 기존 입찰이 자동 취소될 수 있음 (`processChangedBids`)
- BrandAuc Direct는 별도 도메인 (`bid.brand-auc.com`) 사용
- EcoAuc Direct는 `timelimit-auctions` 경로 사용

### 4.3 Instant Purchase (바로 구매)

고정가로 즉시 구매하는 방식입니다.

```
crawlAllItems() → bid_type: "instant"
  └─ scheduled_date: null (경매 일정 불필요)
  └─ 구매: instantBuy(invTorokuBng, lockVersion, genreCd)
  └─ 가격: kakaku (고정가) 사용 (vs live/direct의 genzaiKng/startKng)
```

**지원 사이트**: BrandAuc(2)만 해당

**Instant 특이사항**:

- BrandAuc의 `previewItemsApiUrl`에서 `otherCds: "3,5,6"` 파라미터로 조회
- `additional_info`에 `invTorokuBng`, `lockVersion`, `genreCd` 등 구매에 필요한 데이터 보관
- `jotaiEn === "Available"` 상태만 허용

---

## 5. 크롤링 유형과 스케줄링

### 5.1 전체 상품 크롤링 (`crawlAll`)

```
crawlAll()
  ├─ DB에서 기존 item_id 조회 (중복 방지)
  ├─ 각 경매사 순차 실행: crawler.crawlAllItems(existingIds)
  ├─ DBManager.saveItems(items, "crawled_items")   // INSERT ON DUPLICATE KEY UPDATE
  ├─ DBManager.deleteItemsWithout(itemIds)          // 미존재 아이템 삭제 (입찰 있는 건 보존)
  ├─ DBManager.cleanupUnusedImages("products")      // 미사용 이미지 파일 삭제
  ├─ syncAllData()                                   // 데이터 동기화
  └─ reindexElasticsearch("crawled_items")           // ES 재인덱싱
```

**실행**: 매일 1회 (cron 스케줄, 관리자 설정 시각에 실행)

### 5.2 시세표 크롤링 (`crawlAllValues`)

시세표 크롤링은 **스트리밍 방식**으로 메모리 효율적 처리:

```
crawlAllValues(options)
  ├─ 크롤러별 순차 실행:
  │   ├─ getStreamingMetadata(months)    // 청크 메타데이터 수집
  │   └─ 각 chunk에 대해:
  │       ├─ crawlChunkPages(chunk)      // 병렬 크롤링
  │       ├─ processImagesInChunks()     // 이미지 다운로드/리사이즈
  │       ├─ DBManager.saveItems()       // DB 저장
  │       └─ migrateChunkToS3()          // S3 업로드 + 로컬 삭제
  ├─ DBManager.cleanupOldValueItems()
  ├─ processBidsAfterCrawl()             // winning_price 업데이트
  └─ reindexElasticsearch("values_items")
```

**실행**: 매일 전체 크롤링 후 자동 실행 / 관리자 수동 실행 가능

### 5.3 업데이트 크롤링 (`crawlUpdate`)

Direct 경매 상품의 **가격/일정 변경을 실시간 감지**:

```
crawlUpdateForAuction(aucNum)
  ├─ crawler.crawlUpdates()              // 전체 Direct 상품의 가격/일정 수집
  ├─ DB 기존 데이터와 비교 → 변경 아이템 필터링
  └─ 변경 시:
      ├─ DBManager.updateItems()         // DB 업데이트
      ├─ processChangedBids()            // 가격 변경으로 인한 입찰 취소 + 예치금 환불
      └─ notifyClientsOfChanges()        // Socket.IO로 클라이언트 알림
```

**스케줄링**: `AdaptiveScheduler` 사용

- 기본 간격: `UPDATE_INTERVAL` 환경변수 (기본 40초)
- 변경 없으면 간격 증가 (Additive Increase)
- 변경 있으면 간격 감소 (Multiplicative Decrease)
- 최소/최대 범위: base ~ base\*4

### 5.4 ID 기반 업데이트 크롤링 (`crawlUpdateWithId`)

**활성 입찰이 있는 Direct 상품만** 상세 추적:

```
runUpdateCrawlWithId(aucNum)
  ├─ DB에서 active 입찰 + 해당 경매사 아이템 조회
  ├─ crawler.crawlUpdateWithIds(itemIds)  // 개별 아이템 상세 페이지 크롤링
  └─ 변경 시 동일 처리 (DB 업데이트 + 입찰 취소 + 알림)
```

**스케줄링**: `AdaptiveScheduler` (기본 간격 `UPDATE_INTERVAL_ID`, 기본 10초)

### 5.5 인보이스 크롤링 (`crawlAllInvoices`)

경매 사이트의 **결제/인보이스 데이터 수집**:

```
crawlAllInvoices()
  ├─ 활성 크롤러의 crawlInvoices() 병렬 실행
  └─ DBManager.saveItems(allInvoices, "invoices")
```

**실행**: 매일 전체 크롤링 후 자동 실행

### 5.6 스케줄 요약

| 크롤링 유형       | 주기                     | 실행 환경    |
| ----------------- | ------------------------ | ------------ |
| 전체 상품         | 매일 1회 (cron)          | production만 |
| 시세표            | 매일 전체 크롤링 후      | production만 |
| 인보이스          | 매일 전체 크롤링 후      | production만 |
| 업데이트 (Update) | 적응형 40초~160초        | production만 |
| ID 업데이트       | 적응형 10초~40초         | production만 |
| 로그인            | 서버 시작 시 전체 로그인 | production만 |

> `ENV=development`일 때는 모든 스케줄링이 비활성화됩니다.

---

## 6. 인프라 상세

### 6.1 프록시 시스템 (`utils/proxy.js`)

```
ProxyManager
  ├─ loadProxyIPs()        → .env의 PROXY_IPS (쉼표 구분) 로드
  ├─ createDirectClient()  → 직접 연결 axios 클라이언트 (index: 0)
  ├─ createProxyClient(ip) → 프록시 경유 axios 클라이언트 (port: 3128)
  ├─ createAllClients()    → [직접연결, 프록시1, 프록시2, ..., 프록시14]
  └─ recreateClient(idx)   → 특정 클라이언트 재생성 (세션 초기화)
```

**클라이언트 구성**:

- 각 클라이언트는 독립적인 `cookieJar` (세션 격리)
- `HttpCookieAgent` / `HttpsCookieAgent` 사용 (쿠키 + 프록시 동시 지원)
- 기본 타임아웃: 30초
- 프록시 포트: 3128 (Squid)

**프록시 서버**: AWS EC2 `casa-proxy 1~14` (설정 → `documents/proxy_setting.md`)

### 6.2 이미지 처리 (`utils/processImage.js`)

```
processImagesInChunks(items, folderName, priority, cropType)
  ├─ 원본 URL에서 이미지 다운로드 (프록시 로테이션)
  ├─ sharp로 리사이즈 (최대 800x800)
  ├─ 로컬 저장: public/images/{folderName}/{yearMonth}/{firstChar}/
  ├─ item.image를 로컬 경로로 교체: /images/products/2025-01/a/xxx.webp
  └─ BrandAuc의 경우 cropType: "brand" (상하 25px 크롭)
```

**설정값**:

- `MAX_WIDTH / MAX_HEIGHT`: 800px
- `CONCURRENT_DOWNLOADS`: 200 (동시 다운로드)
- `PROCESSING_BATCH_SIZE`: 5000개씩 배치 처리
- 재시도: 최대 5회, 지수 백오프 (100ms ~ 5분)
- 우선순위 큐: 3단계 (1: 높음, 2: 중간, 3: 낮음)

### 6.3 DB 저장 (`utils/DBManager.js`)

```
DBManager
  ├─ saveItems(items, tableName)          // INSERT ON DUPLICATE KEY UPDATE (배치)
  ├─ updateItems(items, tableName)        // 가격/일정만 UPDATE
  ├─ updateItemDetails(id, details)       // 상세 정보 UPDATE
  ├─ deleteItemsWithout(ids, tableName)   // 미존재 아이템 삭제 (입찰 보존)
  ├─ cleanupUnusedImages(folderName)      // 미사용 이미지 파일 삭제
  └─ cleanupOldValueItems(days)           // 오래된 시세표 삭제
```

**테이블-컬럼 매핑**:

- `crawled_items`: item_id, original_title, title, scheduled_date, auc_num, category, brand, rank, starting_price, image, description, additional_images, accessory_code, final_price, additional_info, bid_type, original_scheduled_date
- `values_items`: 위와 동일 (bid_type, original_scheduled_date 제외)
- `invoices`: date, auc_num, status, amount

### 6.4 Elasticsearch 연동

- 크롤링 완료 후 `reindexElasticsearch(tableName)` 호출
- 인덱스 삭제 → 재생성 → 배치 벌크 인덱싱 (10,000개씩)
- ES 미설정 시 DB `LIKE` 검색으로 자동 fallback

### 6.5 S3 마이그레이션

시세표 이미지는 용량이 크므로 S3에 자동 업로드:

```
청크 크롤링 → 로컬 저장 → DB 저장 → S3 업로드 → 로컬 삭제
```

- 버킷: `casa-images`
- CDN: CloudFront
- 상세 구현: `utils/s3Migration.js`

---

## 7. 환경 변수 (크롤러 관련)

| 변수명               | 설명                                      |
| -------------------- | ----------------------------------------- |
| `CRAWLER_EMAIL1`     | EcoAuc 로그인 이메일                      |
| `CRAWLER_PASSWORD1`  | EcoAuc 로그인 비밀번호                    |
| `CRAWLER_EMAIL2`     | BrandAuc 로그인 이메일                    |
| `CRAWLER_PASSWORD2`  | BrandAuc 로그인 비밀번호                  |
| `CRAWLER_EMAIL3`     | StarAuc 로그인 이메일                     |
| `CRAWLER_PASSWORD3`  | StarAuc 로그인 비밀번호                   |
| `CRAWLER_EMAIL4`     | MekikiAuc 로그인 ID                       |
| `CRAWLER_PASSWORD4`  | MekikiAuc 로그인 비밀번호                 |
| `CRAWLER_EMAIL5`     | PenguinAuc 로그인 이메일                  |
| `CRAWLER_PASSWORD5`  | PenguinAuc 로그인 비밀번호                |
| `ECO_BID_USER_ID`    | EcoAuc 입찰 시 사용하는 user ID           |
| `PROXY_IPS`          | 프록시 서버 IP 목록 (쉼표 구분)           |
| `UPDATE_INTERVAL`    | 업데이트 크롤링 기본 간격 (초, 기본: 40)  |
| `UPDATE_INTERVAL_ID` | ID 기반 업데이트 기본 간격 (초, 기본: 10) |
| `ENV`                | `development`면 스케줄링 비활성화         |

---

## 8. 새 경매 사이트 추가 가이드

### 8.1 체크리스트

1. **사이트 분석**
   - [ ] 로그인 방식 파악 (Form POST? API Token? CSRF?)
   - [ ] 상품 목록 조회 방식 (HTML 파싱? JSON API?)
   - [ ] 입찰 유형 파악 (live / direct / instant 중 어떤 것을 지원?)
   - [ ] 카테고리 구조 파악
   - [ ] Rate Limit 확인 (동시 요청 수, 요청 간격)
   - [ ] 시세표/과거 낙찰 데이터 조회 가능 여부
   - [ ] 인보이스 조회 가능 여부

2. **크롤러 구현**
   - [ ] `crawlers/newAuc.js` 생성
   - [ ] config 객체 작성 (URL, 선택자, 카테고리)
   - [ ] `AxiosCrawler` 상속, 클래스 생성
   - [ ] `performLoginWithClient()` 구현
   - [ ] `crawlAllItems(existingIds)` 구현
   - [ ] `extractItemInfo()` 구현 — 반환 객체 형식 맞추기 (아래 참조)
   - [ ] `crawlItemDetails(itemId, item)` 구현
   - [ ] `crawlUpdates()` 구현 (direct 지원 시)
   - [ ] `crawlUpdateWithIds(itemIds)` 구현 (direct 지원 시)
   - [ ] `directBid(item_id, price)` 구현 (direct 지원 시)
   - [ ] `liveBid(item_id, price)` 구현 (live 지원 시)
   - [ ] 시세표 크롤러 필요 시: ValueCrawler 클래스 + `getStreamingMetadata()` + `crawlChunkPages()` 구현

3. **시스템 통합**
   - [ ] `crawlers/index.js`에 export 추가
   - [ ] `routes/crawler.js`의 `AUCTION_CONFIG`에 새 경매사 등록
   - [ ] `.env`에 `CRAWLER_EMAIL_N`, `CRAWLER_PASSWORD_N` 추가
   - [ ] DB `crawled_items` 테이블에서 새 `auc_num` 할당
   - [ ] `submitBid.js` 등 입찰 로직에서 새 경매사 처리 추가
   - [ ] 프론트엔드에서 새 경매사 필터/표시 추가

### 8.2 `extractItemInfo()`가 반환해야 하는 객체

```javascript
{
  item_id: "unique_item_id",            // 필수: 경매 사이트의 고유 ID
  original_title: "원본 제목",           // 원본 제목 (일문이면 번역 전)
  title: "정제된 제목",                  // 앞쪽 대괄호 제거된 제목
  brand: "Brand Name",                  // 브랜드
  rank: "A",                            // 등급 (A, AB, B, BC, C 등)
  starting_price: 10000,                // 시작가 (정수, 엔화)
  image: "https://...",                 // 대표 이미지 URL (프로세싱 전)
  category: "시계",                     // 카테고리 (한국어)
  bid_type: "direct",                   // "live" | "direct" | "instant"
  original_scheduled_date: "2025-05-14 18:00:00",  // 실제 경매 일정
  scheduled_date: "2025-05-13 18:00:00",           // 마감 시간 (live: 전날 18시)
  auc_num: "6",                         // 경매사 번호 (새로 할당)

  // 선택 필드
  additional_info: { ... },             // 입찰/구매에 필요한 추가 데이터 (JSON)
}
```

### 8.3 `crawlItemDetails()`가 반환해야 하는 객체

```javascript
{
  additional_images: JSON.stringify([    // 추가 이미지 URL 배열 (JSON 문자열)
    "https://...", "https://..."
  ]),
  description: "상품 설명 텍스트",        // 상품 상태/설명
  accessory_code: "보증서, 상자",        // 부속품 정보
}
```

### 8.4 `crawlUpdates()`가 반환해야 하는 객체 배열

```javascript
[
  {
    item_id: "unique_item_id",
    starting_price: 15000,               // 변경된 가격 (or null)
    scheduled_date: "2025-05-14 18:00:00", // 변경된 일정 (or null)
    original_scheduled_date: "...",
  },
  ...
]
```

### 8.5 입찰 메서드 반환 형식

```javascript
// 성공
{ success: true, message: "Bid successful", data: { ... } }

// 실패
{ success: false, message: "Bid failed", error: "에러 메시지" }
```

---

## 9. API 엔드포인트

모든 엔드포인트는 관리자 인증(`isAdmin`) 필요:

| Method | Path                                               | 설명                 |
| ------ | -------------------------------------------------- | -------------------- |
| GET    | `/api/crawler/crawl`                               | 전체 상품 크롤링     |
| GET    | `/api/crawler/crawl-values`                        | 시세표 크롤링        |
| GET    | `/api/crawler/crawl-values?auc_num=1,2&months=3,6` | 선택적 시세표 크롤링 |
| GET    | `/api/crawler/crawl-status`                        | 크롤링 상태 조회     |
| GET    | `/api/crawler/crawl-invoices`                      | 인보이스 크롤링      |
| POST   | `/api/crawler/migrate-to-s3`                       | S3 마이그레이션      |
| POST   | `/api/crawler/overwrite-values-final-price`        | 시세표 낙찰가 교정   |
| GET    | `/api/crawler/migration-status`                    | 마이그레이션 상태    |

---

## 10. 크롤링 후 자동 처리 로직

### 10.1 입찰 자동 취소 (`processChangedBids`)

Direct 상품의 **가격이 올라서 기존 입찰가보다 높아진 경우**:

1. `current_price < starting_price`인 active 입찰 조회
2. 예치금/한도 환불 (개인: `refundDeposit`, 법인: `refundLimit`)
3. 입찰 상태 → `cancelled`
4. KakaoTalk 알림톡 발송

### 10.2 낙찰가 자동 업데이트 (`processBidsAfterCrawl`)

시세표 크롤링 후 낙찰 결과 자동 반영:

1. `cancelled` 입찰의 `winning_price` ← `values_items.final_price`
2. `final` 입찰 중 `final_price < values_items.final_price`인 건 자동 취소 + 예치금 환불

### 10.3 Socket.IO 실시간 알림 (`notifyClientsOfChanges`)

가격/일정 변경 시 연결된 클라이언트에 `data-updated` 이벤트 발송:

```javascript
io.emit("data-updated", { itemIds: [...], timestamp: "..." });
```

---

## 11. 주의사항 및 운영 팁

### Rate Limit 대응

- **MekikiAuc**: API 요청 간 10초 딜레이 필수 (`API_DELAY = 10 * 1000`)
- **StarAuc**: 동시 요청 3개 제한 (`LIMIT1 = 3, LIMIT2 = 3`), 프록시 미사용
- **EcoAuc / BrandAuc / PenguinAuc**: 프록시 + 동시 10개로 빠른 크롤링

### 필터링 규칙 (공통)

- `title.includes("▼")` → 제외 (EcoAuc)
- `title.includes("lighter")` → 제외 (라이터 제품 제외)
- `isCollectionDay()` → 화/목 수거일 제외 (EcoAuc)
- `kekkaKbn == 5` → 제외 (BrandAuc, 결과 확정 아이템)

### 다중 클라이언트 주의점

- 로그인은 순차 실행 (간격: `loginDelayBetweenClients = 5초`)
- 세션 확인은 병렬 실행
- 로그인 실패 시 해당 클라이언트만 재생성 (다른 클라이언트에 영향 없음)
- 모든 클라이언트 로그인 실패 시 백그라운드에서 자동 재시도

### 번역 처리

- **MekikiAuc, PenguinAuc**: 일본어 사이트 → `utils/translator.js` (AWS Translate) 사용
- **EcoAuc, BrandAuc, StarAuc**: 영어 지원 사이트 → 번역 불필요

---

## 12. 디버깅 가이드

### 크롤링 실패 시 확인 순서

1. **로그인 실패**: `.env`의 크롤러 계정 정보 확인, 해당 사이트에서 직접 로그인 테스트
2. **프록시 문제**: `PROXY_IPS` 확인, `casa-proxy` EC2 인스턴스 상태 확인
3. **Rate Limit**: 해당 크롤러의 `LIMIT1`, `LIMIT2` 값 확인, 필요 시 낮추기
4. **HTML 구조 변경**: 사이트 업데이트로 선택자가 변경된 경우 → `crawlSelectors` 수정
5. **API 변경**: JSON API 엔드포인트/파라미터가 변경된 경우 → config URL 수정

### 크롤링 상태 확인

```bash
# API로 상태 확인 (관리자 로그인 필요)
GET /api/crawler/crawl-status

# 응답 예:
{
  "global": { "isCrawling": false, "isValueCrawling": false },
  "auctions": {
    "1": {
      "name": "EcoAuc",
      "enabled": true,
      "update": { "crawling": false, "scheduler": { "current": 40, "min": 40, "max": 160 } },
      "updateWithId": { "crawling": false, "scheduler": { "current": 10, "min": 10, "max": 40 } }
    }
  }
}
```
