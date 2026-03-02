# 유틸리티 모듈 상세 문서 (Utilities Reference)

> 최종 업데이트: 2026-03-02

## 목차

1. [데이터베이스 (DB.js)](#1-데이터베이스-dbjs)
2. [수수료 계산 (calculate-fee.js)](#2-수수료-계산-calculate-feejs)
3. [정산 엔진 (settlement.js)](#3-정산-엔진-settlementjs)
4. [예치금 관리 (deposit.js)](#4-예치금-관리-depositjs)
5. [입찰 검증 (submitBid.js)](#5-입찰-검증-submitbidjs)
6. [환율 조회 (exchange-rate.js)](#6-환율-조회-exchange-ratejs)
7. [이미지 처리 (processImage.js)](#7-이미지-처리-processimagejs)
8. [상품 데이터 가공 (processItem.js)](#8-상품-데이터-가공-processitemjs)
9. [Elasticsearch (elasticsearch.js)](#9-elasticsearch-elasticsearchjs)
10. [번역기 (translator.js)](#10-번역기-translatorjs)
11. [메시지 발송 (message.js)](#11-메시지-발송-messagejs)
12. [PDF 생성기](#12-pdf-생성기)
13. [Popbill 서비스 (popbill.js)](#13-popbill-서비스-popbilljs)
14. [오픈뱅킹 (openbanking.js)](#14-오픈뱅킹-openbankingjs)
15. [Google Sheets (googleSheets.js)](#15-google-sheets-googlesheetsjs)
16. [프록시 관리 (proxy.js)](#16-프록시-관리-proxyjs)
17. [데이터 관리 (dataUtils.js)](#17-데이터-관리-datautilsjs)
18. [관리자 활동 로깅 (adminActivityLogger.js)](#18-관리자-활동-로깅-adminactivityloggerjs)
19. [관리자 접근 제어 (adminAccess.js)](#19-관리자-접근-제어-adminaccessjs)
20. [Excel 내보내기 (excel.js)](#20-excel-내보내기-exceljs)
21. [로젠 택배 (logen.js)](#21-로젠-택배-logenjs)
22. [WMS 동기화 (wms-bid-sync.js)](#22-wms-동기화-wms-bid-syncjs)
23. [메트릭 (metrics.js)](#23-메트릭-metricsjs)
24. [S3 마이그레이션 (s3Migration.js)](#24-s3-마이그레이션-s3migrationjs)

---

## 1. 데이터베이스 (`DB.js`)

MySQL2 `promise` 기반 커넥션 풀 관리.

### 풀 구성

| 풀            | 커넥션 수         | 용도                |
| ------------- | ----------------- | ------------------- |
| `pool` (메인) | 최대 100, 유휴 40 | API 처리, 쿼리 실행 |
| `sessionPool` | 최대 20, 유휴 8   | 세션 스토어 전용    |

### Exports

```javascript
module.exports = { pool, sessionPool, safeQuery, monitorConnections };
```

### 풀 설정

```javascript
{
  connectionLimit: 100,    // 최대 커넥션
  charset: "utf8mb4",      // 이모지 지원
  connectTimeout: 10000,   // 10초
  idleTimeout: 300000,     // 5분 후 유휴 연결 해제
  maxIdle: 40              // 최대 유휴 연결
}
```

### `safeQuery(query, params)`

- 커넥션 획득 → 쿼리 실행 → 자동 반환
- `finally` 블록에서 반드시 `conn.release()` 호출

### 모니터링

- 개발 환경: 60초 간격 커넥션 상태 모니터링
- `max_connections`, `Threads_connected`, 풀 active/free 상태 로깅

---

## 2. 수수료 계산 (`calculate-fee.js`)

**UMD 모듈** — Node.js와 브라우저 모두에서 동작.
`/js/calculate-fee.js` 경로로 프론트엔드에서도 직접 사용.

### 수수료 체계

#### 경매장별 현지 수수료 (`calculateLocalFee`)

| 경매장                      | 수수료 규칙                                           |
| --------------------------- | ----------------------------------------------------- |
| **EcoAuc** (auc_num: 1)     | 티어별 차등: ~50만엔 10%, ~100만엔 9%, ~500만엔 8% 등 |
| **BrandAuc** (auc_num: 2)   | 고정 ¥2,200                                           |
| **StarAuc** (auc_num: 3)    | (명세에 따름)                                         |
| **MekikiAuc** (auc_num: 4)  | (명세에 따름)                                         |
| **PenguinAuc** (auc_num: 5) | (명세에 따름)                                         |

#### 관세 (`calculateCustomsDuty`)

- 과세가격 = (낙찰가 + 현지수수료) × 환율 × 0.6
- 관세율: 8%
- 20만원 이하 면세

#### 부가세 (`calculateVAT`)

- (과세가격 + 관세) × 10%
- 관세 면세 시, 과세가격 기준 10%

### 핵심 함수

```javascript
calculateTotalPrice({
  winningPrice, // 낙찰가 (엔화)
  exchangeRate, // 환율 (JPY→KRW)
  aucNum, // 경매장 번호
  commissionRate, // 사용자 커미션 비율 (%)
});
// → { localFee, customsDuty, vat, totalKRW, commissionAmount, ... }
```

---

## 3. 정산 엔진 (`settlement.js`)

일별/사용자별 정산 관리.

### 핵심 함수

#### `createOrUpdateSettlement(conn, userId, date, exchangeRate)`

1. 해당 날짜의 모든 `completed` 입찰 조회 (live_bids + direct_bids + instant_purchases)
2. 상품 정보 합류 (crawled_items)
3. 각 상품별 수수료 계산 (`calculateTotalPrice`)
4. `daily_settlements` 테이블에 UPSERT
5. 결과 필드: `item_count`, `total_japanese_yen`, `total_amount`, `fee_amount`, `vat_amount`, `final_amount`

#### `getUserCommissionRate(conn, userId)`

- `users.commission_rate` 조회
- 기본값: null (기본 수수료율 적용)

#### `adjustDepositBalance(conn, userId, amount, type, relatedId, description)`

- 예치금 잔액 조정 (charge/deduct/refund)
- `deposit_transactions` 기록 생성
- `user_accounts.deposit_balance` 업데이트

### 교환 환율 스냅샷

- 정산 시점의 환율을 `exchange_rate` 필드에 저장
- 이후 환율 변동과 무관하게 정산 기준 환율 유지

---

## 4. 예치금 관리 (`deposit.js`)

### 함수 목록

| 함수                                                                     | 설명                  |
| ------------------------------------------------------------------------ | --------------------- |
| `deductDeposit(conn, userId, amount, relatedType, relatedId, desc)`      | 개인 예치금 차감      |
| `refundDeposit(conn, userId, amount, relatedType, relatedId, desc)`      | 개인 예치금 환불      |
| `deductLimit(conn, userId, amount, relatedType, relatedId, desc)`        | 법인 한도 차감        |
| `refundLimit(conn, userId, amount, relatedType, relatedId, desc)`        | 법인 한도 환불        |
| `getBidDeductAmount(winningPrice, exchangeRate, aucNum, commissionRate)` | 입찰별 차감 금액 계산 |

### 처리 흐름 (개인 계정)

```
1. user_accounts.deposit_balance 조회
2. 잔액 확인 (차감 시)
3. deposit_balance 업데이트 (원자적)
4. deposit_transactions 기록 생성 (balance_after 포함)
```

### `related_type` 분류

| 타입                | 설명          |
| ------------------- | ------------- |
| `direct_bid`        | 다이렉트 입찰 |
| `live_bid`          | 실시간 입찰   |
| `instant_purchase`  | 바로 구매     |
| `settlement_adjust` | 정산 조정     |
| `appraisal`         | 감정 비용     |
| `repair`            | 수선 비용     |
| `charge_request`    | 충전 요청     |
| `refund_request`    | 환불 요청     |

---

## 5. 입찰 검증 (`submitBid.js`)

### 경매장별 입찰 단위 규칙

#### EcoAuc (auc_num: 1)

- ¥1,000 단위

#### BrandAuc (auc_num: 2)

- ¥1,000 미만: ¥1,000 단위
- ¥1,000 이상: ¥500 단위

#### StarAuc (auc_num: 3)

- 티어별 증분:
  - ~1만엔: ¥500
  - ~5만엔: ¥1,000
  - ~10만엔: ¥2,000
  - (이후 단계별 증가)

### 함수

```javascript
validateBidByAuction(aucNum, price); // → boolean
validateBidUnit(aucNum, price); // → { valid, message, suggestedPrice }
```

---

## 6. 환율 조회 (`exchange-rate.js`)

### 동작 방식

1. CurrencyFreaks API에서 JPY/KRW 환율 조회
2. **0.2 마진** 추가
3. **1시간 캐시** (메모리)
4. 실패 시 캐시된 값 사용, 캐시도 없으면 기본값 `9.5` 반환

### Exports

```javascript
getExchangeRate(); // → Promise<number> (API 호출, 캐싱)
setExchangeRate(rate); // 수동 환율 설정
getCachedExchangeRate(); // 캐시된 환율 즉시 반환
```

---

## 7. 이미지 처리 (`processImage.js`)

대량 이미지 다운로드 및 처리 파이프라인.

### 아키텍처

```
[원본 URL] → [프록시 로테이션] → [다운로드] → [sharp 리사이즈] → [로컬 저장]
```

### 처리 사양

| 설정          | 값                            |
| ------------- | ----------------------------- |
| 최대 크기     | 800×800px                     |
| 포맷          | JPEG (품질 80%)               |
| 배치 크기     | 5,000건                       |
| 우선순위      | 3레벨 (높음/보통/낮음)        |
| 적응형 백오프 | 100ms ~ 5분                   |
| 저장 구조     | `images/{YYYY-MM}/{filename}` |

### Exports

```javascript
processImagesInChunks(items, options); // → 배치 처리 실행
```

---

## 8. 상품 데이터 가공 (`processItem.js`)

### `processItem(itemId, userId, tableName)`

1. DB에서 상품 기본 정보 조회 (`crawled_items` 또는 `values_items`)
2. 이미지 URL 정규화
3. 사용자별 입찰 정보 합류:
   - `live_bids`: 실시간 입찰 데이터
   - `direct_bids`: 다이렉트 입찰 데이터
   - `instant_purchases`: 바로 구매 데이터
4. 위시리스트 상태 포함
5. 풍부한(enriched) 상품 객체 반환

---

## 9. Elasticsearch (`elasticsearch.js`)

### ElasticsearchManager (싱글톤)

| 메서드                        | 설명                 |
| ----------------------------- | -------------------- |
| `connect(url)`                | ES 연결 (ping 확인)  |
| `registerIndex(name, config)` | 인덱스 설정 등록     |
| `createIndex(name)`           | 인덱스 생성 (없으면) |
| `search(index, query)`        | 검색 실행            |
| `bulkIndex(index, docs)`      | 대량 인덱싱          |
| `isAvailable()`               | 연결 상태 확인       |

### 등록된 인덱스

| 인덱스          | 용도           | 분석기                                             |
| --------------- | -------------- | -------------------------------------------------- |
| `crawled_items` | 경매 상품 검색 | autocomplete (standard + lowercase + asciifolding) |
| `values_items`  | 시세 상품 검색 | autocomplete                                       |

### Fallback

- ES 미연결 시 `isAvailable() === false`
- 라우트에서 DB `LIKE` 검색으로 자동 전환

---

## 10. 번역기 (`translator.js`)

### Translator 클래스

| 메서드                      | 설명                    |
| --------------------------- | ----------------------- |
| `translate(text, from, to)` | 텍스트 번역 (캐시 우선) |
| `translateBatch(texts)`     | 배치 번역               |

### 캐시 전략

- **DB 캐시**: `translation_cache` 테이블
- 만료: 30일
- 최대 항목: 10,000
- 쓰로틀 핸들링: 재시도 로직 포함
- 언어: 일본어(ja) → 영어(en) / 한국어(ko)

---

## 11. 메시지 발송 (`message.js`)

### MessageService

KakaoTalk 알림톡 발송 (Aligo API 사용).

| 함수                                    | 설명                                |
| --------------------------------------- | ----------------------------------- |
| `safeSendMessage(options)`              | 안전한 메시지 발송 (실패 시 로그만) |
| `sendHigherBidAlerts(itemId, newPrice)` | 상위 입찰 알림                      |

### 알림 유형

- 상위 입찰 알림 (자신의 입찰보다 높은 금액 등록 시)
- 결제 알림
- 입금 확인 알림

### 제한 사항

- 파라미터 최대 40자 (초과 시 자동 truncate)
- 전화번호 자동 조회 (user_id → phone)

---

## 12. PDF 생성기

### 12.1 감정서 PDF (`pdfGenerator.js`)

`pdf-lib` + 한국어 폰트(NotoSansKR) 사용.

| 함수                              | 설명                 |
| --------------------------------- | -------------------- |
| `ensureCertificatePDF(appraisal)` | 감정서 PDF 생성/캐시 |
| `createZipStream(appraisals)`     | 복수 감정서 ZIP 압축 |
| `DEFAULT_PDF_COORDINATES`         | PDF 좌표 매핑 설정   |

**감정서 구성 요소:**

- 브랜드 로고
- QR 코드 (인증번호 링크)
- 감정 결과 (정품/가품/보류)
- 상품 이미지
- 모델명, 시리얼 번호

### 12.2 배송 라벨 PDF (`shippingPdf.js`)

`pdf-lib` 사용.

| 함수                                  | 설명                  |
| ------------------------------------- | --------------------- |
| `generateShippingLabel(shipment)`     | 100mm×150mm 배송 라벨 |
| `generateShippingLabelsA4(shipments)` | A4 시트 (복수 라벨)   |

**라벨 구성 요소:**

- QR 코드 (송장번호)
- 발송인/수취인 정보
- 배송 분류 코드
- 한국어 텍스트 래핑

---

## 13. Popbill 서비스 (`popbill.js`)

### PopbillService (싱글톤)

| 메서드                                   | 설명                       |
| ---------------------------------------- | -------------------------- |
| `checkPayment(amount, depositorName)`    | 입금 확인 (은행 거래 매칭) |
| `checkSettlement(amount, depositorName)` | 정산 입금 확인             |
| `issueTaxInvoice(params)`                | 세금계산서 발행            |
| `issueCashReceipt(params)`               | 현금영수증 발행            |

### 입금 확인 로직

```
1. EasyFinBank API로 최근 거래 조회
2. used_bank_transactions에서 이미 사용된 거래 제외
3. 입금자명 + 금액으로 매칭
4. 매칭 성공 시 used_bank_transactions에 기록
```

---

## 14. 오픈뱅킹 (`openbanking.js`)

| 함수                                      | 설명                        |
| ----------------------------------------- | --------------------------- |
| `generateAuthUrl(userId)`                 | OAuth 인증 URL 생성         |
| `handleCallback(code, userId)`            | OAuth 콜백 처리 (토큰 발급) |
| `registerUserAccount(userId, fintechNum)` | 핀테크 계좌 등록            |
| `transferWithdraw(params)`                | 출금 이체                   |

---

## 15. Google Sheets (`googleSheets.js`)

### GoogleSheetsManager (싱글톤)

서비스 계정 인증 (`service-account-key.json`).

| 메서드                                | 설명                |
| ------------------------------------- | ------------------- |
| `appendBidRow(data)`                  | 입찰 데이터 행 추가 |
| `updateFinalBid(rowId, data)`         | 최종 입찰 업데이트  |
| `syncToSheet(sheetId, range, values)` | 범용 시트 동기화    |

### 날짜 형식 정규화

다양한 입력 형식 → `YYYY-MM-DD` 통일:

- `2026/03/02`, `2026.03.02`, `20260302` 등

### 비밀번호 해시

`hashPassword(pw)`: SHA-256 해시 유틸리티 (인증에서도 사용)

---

## 16. 프록시 관리 (`proxy.js`)

### ProxyManager

| 메서드                       | 설명                        |
| ---------------------------- | --------------------------- |
| `createDirectClient()`       | 프록시 없는 HTTP 클라이언트 |
| `createProxyClient(proxyIp)` | 특정 프록시 HTTP 클라이언트 |
| `getRandomProxy()`           | 랜덤 프록시 IP 반환         |
| `rotateProxy()`              | 프록시 순환 (라운드 로빈)   |

### 설정

- 환경변수 `PROXY_IPS`에서 쉼표 구분 IP 목록 로드
- Cookie Jar 지원 (`tough-cookie`)
- HTTP/HTTPS 에이전트 자동 생성

---

## 17. 데이터 관리 (`dataUtils.js`)

### 필터 설정 (`filter_settings` 테이블)

| 함수                                          | 설명                                        |
| --------------------------------------------- | ------------------------------------------- |
| `getFilterSettings(type)`                     | 필터 설정 조회 (date/brand/category)        |
| `updateFilterSetting(type, value, isEnabled)` | 필터 설정 변경                              |
| `initializeFilterSettings()`                  | DB에서 필터 설정 초기화                     |
| `syncFilterSettingsToItems()`                 | 필터 설정 → `crawled_items.is_enabled` 반영 |

### 추천 설정 (`recommend_settings` 테이블)

| 함수                             | 설명                                       |
| -------------------------------- | ------------------------------------------ |
| `getRecommendSettings()`         | 추천 규칙 목록                             |
| `addRecommendSetting(data)`      | 추천 규칙 추가                             |
| `syncRecommendSettingsToItems()` | 추천 점수 → `crawled_items.recommend` 반영 |
| `syncAllData()`                  | 필터 + 추천 전체 동기화                    |

### 만료 스케줄러 (`startExpiredSchedulers`)

- `crawled_items.scheduled_date` 기준 상품 만료 처리
- `is_expired = 1` 설정

---

## 18. 관리자 활동 로깅 (`adminActivityLogger.js`)

Express 미들웨어로 동작.

### 자동 로깅 대상

- HTTP 메서드: `POST`, `PUT`, `PATCH`, `DELETE`
- 관리자 세션 사용자의 API 호출만

### 로깅 데이터

| 필드             | 설명                     |
| ---------------- | ------------------------ |
| `actor_user_id`  | 관리자 ID                |
| `actor_login_id` | 관리자 로그인 ID         |
| `action_method`  | HTTP 메서드              |
| `action_path`    | API 경로                 |
| `action_menu`    | 매핑된 메뉴명            |
| `action_title`   | 사람이 읽을 수 있는 설명 |
| `action_summary` | 상세 요약                |
| `target_type`    | 대상 엔티티 유형         |
| `target_id`      | 대상 엔티티 ID           |
| `ip_address`     | 클라이언트 IP            |
| `http_status`    | HTTP 응답 코드           |
| `detail_json`    | 추가 JSON 데이터         |

### 엔드포인트 → 메뉴 매핑

```
/api/live-bids → "실시간 입찰"
/api/direct-bids → "다이렉트 입찰"
/api/wms → "WMS"
/api/admin/settings → "설정"
...
```

---

## 19. 관리자 접근 제어 (`adminAccess.js`)

### 권한 체계

```
슈퍼관리자 (login_id="admin" 또는 is_superadmin=1)
    ↓ 모든 메뉴 접근 가능
일반 관리자 (is_admin_panel=1)
    ↓ allowed_menus에 지정된 메뉴만 접근
일반 사용자
    ↓ 관리자 기능 접근 불가
```

### 핵심 함수

| 함수                                | 설명                            |
| ----------------------------------- | ------------------------------- |
| `isAdminUser(user)`                 | 관리자 여부 확인                |
| `isSuperAdminUser(user)`            | 슈퍼관리자 여부 확인            |
| `canAccessAdminMenu(user, menuKey)` | 특정 메뉴 접근 가능 여부        |
| `parseAllowedMenus(raw)`            | JSON 문자열 → 메뉴 키 배열 파싱 |
| `sanitizeAllowedMenus(menus)`       | 유효 메뉴 키만 필터링           |

---

## 20. Excel 내보내기 (`excel.js`)

ExcelJS + sharp 기반.

| 함수                                                | 설명                        |
| --------------------------------------------------- | --------------------------- |
| `createWorkbook(data, columns, options)`            | 워크북 생성 (이미지 임베딩) |
| `streamWorkbookToResponse(workbook, res, filename)` | HTTP 응답으로 스트리밍      |
| `formatDateForExcel(date)`                          | 날짜 포맷팅                 |
| `formatNumberForExcel(num)`                         | 숫자 포맷팅                 |

---

## 21. 로젠 택배 (`logen.js`)

| 함수                       | 설명                  |
| -------------------------- | --------------------- |
| `getContractInfo()`        | 계약 정보 조회        |
| `getDeliveryInfo(zipcode)` | 주소→배송점 코드 조회 |
| `issueSlipNumber()`        | 송장번호 발급         |
| `registerOrder(params)`    | 택배 주문 등록        |
| `trackShipment(slipNo)`    | 배송 추적             |

### 환경

- `LOGEN_ENV=test`: 테스트 환경
- `LOGEN_ENV=production`: 운영 환경

---

## 22. WMS 동기화 (`wms-bid-sync.js`)

입찰 상태 변경 시 WMS 자동 동기화.

### 상태 → WMS 존 매핑

| 입찰 상태        | WMS 존                                             |
| ---------------- | -------------------------------------------------- |
| `completed`      | `DOMESTIC_ARRIVAL_ZONE` (국내 도착)                |
| repair requested | `INTERNAL_REPAIR_ZONE` 또는 `EXTERNAL_REPAIR_ZONE` |
| repair done      | `REPAIR_DONE_ZONE`                                 |
| `shipped`        | `OUTBOUND_ZONE` (출고)                             |

### 핵심 함수

| 함수                                            | 설명                         |
| ----------------------------------------------- | ---------------------------- |
| `syncWmsByBidStatus(bidType, bidId, newStatus)` | 상태별 WMS 동기화            |
| `backfillCompletedWmsItemsByBidStatus()`        | 미등록 완료 건 일괄 WMS 등록 |

### 바코드 생성 규칙

- `item_uid`: `{auc_source}-{item_id}-{bid_id}`
- `external_barcode`: 경매장 원본 바코드
- `internal_barcode`: 내부 관리 바코드

### 경매장 소스 매핑

| auc_num | 소스명  |
| ------- | ------- |
| 1       | ECO     |
| 2       | BRAND   |
| 3       | STAR    |
| 4       | MEKIKI  |
| 5       | PENGUIN |

---

## 23. 메트릭 (`metrics.js`)

사이트 방문/사용 분석.

### 수집 항목

| 항목             | 설명                 |
| ---------------- | -------------------- |
| 활성 사용자      | 회원 vs 비회원 구분  |
| 일일 고유 방문자 | IP + User-Agent 기반 |
| 총 요청 수       | 모든 HTTP 요청       |
| 고유 페이지뷰    | 경로별 조회 수       |

### 저장 방식

- 메모리 캐시 (실시간)
- JSON 파일 영속화 (주기적)
- 비활성 타임아웃: 30분
- 일일 자동 초기화 (cron)

---

## 24. S3 마이그레이션 (`s3Migration.js`)

로컬 이미지 → AWS S3/CloudFront 마이그레이션.

### ValuesImageMigration

| 설정        | 값                        |
| ----------- | ------------------------- |
| 배치 크기   | 500 ~ 5,000 (동적)        |
| 동시 업로드 | 20                        |
| 폴더 구조   | `{YYYY-MM}/{first-char}/` |
| CDN URL     | CloudFront 도메인         |

### 처리 흐름

```
1. values_items에서 로컬 이미지 URL 가진 항목 조회
2. 로컬 파일 존재 확인
3. S3 업로드 (public-read)
4. DB URL 업데이트 (CloudFront URL로)
5. 진행 통계 출력
```
