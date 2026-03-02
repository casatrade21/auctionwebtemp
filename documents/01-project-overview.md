# 프로젝트 개요 (Project Overview)

> 최종 업데이트: 2026-03-02

## 1. 프로젝트 소개

**CasasTrade / CAS System** — 일본 명품 옥션 중개 및 감정 시스템

일본의 여러 명품 경매 사이트(EcoAuc, BrandAuc, StarAuc, MekikiAuc, PenguinAuc)에서 상품 데이터를 크롤링하여 한국 사용자에게 입찰 중개 서비스를 제공하는 풀스택 웹 애플리케이션입니다. 추가로 명품 감정(Appraisal) 서비스와 수선(Repair) 관리, 창고 관리(WMS) 시스템을 포함합니다.

### 주요 도메인

| 도메인             | 설명                                                |
| ------------------ | --------------------------------------------------- |
| **casastrade.com** | 메인 옥션 중개 서비스 (상품 조회, 입찰, 마이페이지) |
| **cassystem.com**  | 감정 시스템 서비스 (같은 서버, 호스트 기반 라우팅)  |

---

## 2. 기술 스택

### Backend

| 기술                                 | 버전   | 용도                                      |
| ------------------------------------ | ------ | ----------------------------------------- |
| **Node.js**                          | -      | 런타임 환경                               |
| **Express**                          | 4.21.x | 웹 프레임워크                             |
| **MySQL2** (MariaDB)                 | 3.11.x | 주 데이터베이스 (커넥션 풀)               |
| **Elasticsearch**                    | 8.15.x | 전문 검색 (fallback: DB LIKE)             |
| **Socket.IO**                        | 4.8.x  | 실시간 알림 (크롤링 진행 상태 등)         |
| **express-session** + **MySQLStore** | -      | 세션 관리 (DB 저장)                       |
| **node-cron**                        | 3.0.x  | 스케줄링 (크롤링, 입금 확인, 한도 초기화) |

### 외부 서비스/API

| 서비스                  | 용도                                                     |
| ----------------------- | -------------------------------------------------------- |
| **AWS S3 + CloudFront** | 이미지 저장 및 CDN                                       |
| **AWS Translate**       | 일본어→한국어 상품 설명 번역                             |
| **Google Sheets API**   | 입찰 데이터 동기화, 수선업체 시트 연동                   |
| **Popbill**             | 은행 거래 조회(EasyFinBank), 세금계산서, 현금영수증 발행 |
| **NICEpay**             | 온라인 결제 (감정 서비스)                                |
| **CurrencyFreaks**      | JPY→KRW 실시간 환율                                      |
| **Aligo (KakaoTalk)**   | 알림톡 발송 (입찰 알림, 결제 알림)                       |
| **Logen Express**       | 택배 배송 (송장 발급, 배송 추적)                         |

### Frontend

| 기술                      | 설명                                        |
| ------------------------- | ------------------------------------------- |
| **Vanilla HTML/CSS/JS**   | SPA 프레임워크 없이 서버 사이드 HTML 렌더링 |
| **Server-rendered Pages** | Express에서 정적 HTML 파일 서빙             |
| **Socket.IO Client**      | 실시간 크롤링 상태 수신                     |

---

## 3. 프로젝트 디렉토리 구조

```
auctionwebtemp/
├── server.js                    # Express 서버 진입점
├── package.json                 # 의존성 관리
├── service-account-key.json     # Google Sheets 서비스 계정 키
├── .env                         # 환경 변수 (미포함)
│
├── auth/                        # 인증 모듈 (Passport.js)
│   ├── auth.js                  #   Passport 초기화
│   └── strategies.js            #   로컬 인증 전략
│
├── crawlers/                    # 일본 옥션 사이트 크롤러
│   ├── baseCrawler.js           #   기본 크롤러 클래스 (AxiosCrawler)
│   ├── brandAuc.js              #   BrandAuc 크롤러 (auc_num: 2)
│   ├── ecoAuc.js                #   EcoAuc 크롤러 (auc_num: 1)
│   ├── starAuc.js               #   StarAuc 크롤러 (auc_num: 3)
│   ├── mekikiAuc.js             #   MekikiAuc 크롤러 (auc_num: 4)
│   ├── penguinAuc.js            #   PenguinAuc 크롤러 (auc_num: 5)
│   └── index.js                 #   크롤러 인스턴스 내보내기
│
├── cron/                        # 별도 크론 작업
│   └── reset-daily-limit.js     #   일별 한도 초기화
│
├── documents/                   # 프로젝트 문서
│   ├── db-schema.md             #   DB 스키마 문서 (자동 생성)
│   └── ...                      #   개발 문서들
│
├── pages/                       # HTML 페이지 (서버에서 서빙)
│   ├── *.html                   #   메인 서비스 페이지들
│   ├── admin/                   #   관리자 페이지
│   └── appr/                    #   감정 시스템 페이지
│
├── public/                      # 정적 파일
│   ├── js/                      #   프론트엔드 JavaScript
│   │   ├── admin/               #     관리자 페이지 스크립트
│   │   ├── appr-admin/          #     감정 관리 스크립트
│   │   └── *.js                 #     공용 스크립트
│   ├── styles/                  #   CSS 파일
│   │   ├── admin/               #     관리자 스타일
│   │   └── *.css                #     공용 스타일
│   ├── images/                  #   이미지 파일
│   ├── fonts/                   #   폰트 파일
│   └── certificates/            #   감정서 파일
│
├── routes/                      # API 라우트
│   ├── auth.js                  #   인증 API
│   ├── data.js                  #   상품 데이터 API
│   ├── live-bids.js             #   실시간 경매 입찰 API
│   ├── direct-bids.js           #   다이렉트 입찰 API
│   ├── instant-purchases.js     #   바로 구매 API
│   ├── admin.js                 #   관리자 API
│   ├── values.js                #   시세 데이터 API
│   ├── detail.js                #   상품 상세 API
│   ├── users.js                 #   사용자 관리 API
│   ├── dashboard.js             #   대시보드 API
│   ├── bid-results.js           #   입찰 결과/정산 API
│   ├── deposits.js              #   예치금 API
│   ├── popbill.js               #   Popbill 연동 API
│   ├── wms.js                   #   창고 관리 API
│   ├── repair-management.js     #   수선 관리 API
│   ├── shipping.js              #   배송 관리 API
│   ├── crawler.js               #   크롤러 제어 API
│   ├── wishlist.js              #   위시리스트 API
│   ├── sitemap.js               #   사이트맵 생성
│   └── appr/                    #   감정 시스템 API
│       ├── appraisals.js        #     감정 요청 API
│       ├── admin.js             #     감정 관리자 API
│       ├── payments.js          #     결제 API (NICEpay)
│       ├── restorations.js      #     복원 서비스 API
│       └── users.js             #     감정 사용자 API
│
├── utils/                       # 유틸리티 모듈
│   ├── DB.js                    #   MySQL 커넥션 풀
│   ├── DBManager.js             #   DB 매니저 (크롤링 데이터 저장)
│   ├── adminDB.js               #   관리자 DB 유틸리티
│   ├── middleware.js            #   인증 미들웨어
│   ├── adminAuth.js             #   관리자 인증
│   ├── adminAccess.js           #   관리자 메뉴 접근 제어
│   ├── adminActivityLogger.js   #   관리자 활동 로깅
│   ├── calculate-fee.js         #   수수료 계산 (UMD)
│   ├── feeCalculator.js         #   수수료 계산기 (placeholder)
│   ├── settlement.js            #   일일 정산 엔진
│   ├── deposit.js               #   예치금 관리
│   ├── submitBid.js             #   입찰 제출/검증
│   ├── processItem.js           #   상품 데이터 가공
│   ├── processImage.js          #   이미지 처리 파이프라인
│   ├── exchange-rate.js         #   환율 조회 (1시간 캐시)
│   ├── elasticsearch.js         #   ES 래퍼
│   ├── translator.js            #   일→한 번역 (AWS Translate)
│   ├── message.js               #   KakaoTalk 알림 (Aligo)
│   ├── pdfGenerator.js          #   감정서 PDF 생성
│   ├── shippingPdf.js           #   배송 라벨 PDF 생성
│   ├── popbill.js               #   Popbill SDK 래퍼
│   ├── openbanking.js           #   오픈뱅킹 API
│   ├── googleSheets.js          #   Google Sheets 연동
│   ├── proxy.js                 #   프록시 관리
│   ├── dataUtils.js             #   필터/추천 설정 관리
│   ├── excel.js                 #   Excel 내보내기
│   ├── logen.js                 #   로젠 택배 API
│   ├── wms-bid-sync.js          #   WMS ↔ 입찰 동기화
│   ├── metrics.js               #   사이트 분석/메트릭
│   ├── s3Migration.js           #   로컬→S3 이미지 마이그레이션
│   └── appr.js                  #   감정 유틸리티
│
└── scripts/                     # 실행 스크립트
    ├── export-db-schema.js      #   DB 스키마 문서 생성기
    ├── indexElasticsearch.js     #   ES 인덱스 빌더
    └── migrate-member-groups.js #   회원 그룹 마이그레이션
```

---

## 4. 핵심 비즈니스 플로우

### 4.1 상품 크롤링 → 사용자 입찰 → 정산 플로우

```
[일본 옥션 사이트] ──크롤링──> [crawled_items DB]
                                    │
                                    ▼
                            [상품 목록 페이지]
                                    │
                          ┌─────────┼──────────┐
                          ▼         ▼          ▼
                      [Live Bid] [Direct Bid] [Instant Purchase]
                          │         │          │
                          ▼         ▼          ▼
                      [입찰가 검증 & 예치금 차감]
                          │         │          │
                          ▼         ▼          ▼
                      [Google Sheets 동기화]
                          │         │          │
                          ▼         ▼          ▼
                      [낙찰 확인 & 정산 생성]
                          │
                          ▼
                      [WMS 입고 → 감정 → 수선 → 출고]
                          │
                          ▼
                      [배송 (Logen 택배)]
```

### 4.2 입찰 유형

| 유형                             | 설명                    | 상태 플로우                                  |
| -------------------------------- | ----------------------- | -------------------------------------------- |
| **Live Bid** (실시간 경매)       | 실시간 현장 경매 입찰   | first → second → final → completed → shipped |
| **Direct Bid** (다이렉트 입찰)   | 플랫폼에 직접 입찰 제출 | active → completed/cancelled → shipped       |
| **Instant Purchase** (바로 구매) | 고정가 즉시 구매        | pending → completed/cancelled                |

### 4.3 감정 시스템 (CAS System)

```
[감정 요청 접수]
    │
    ├── quicklink: URL 기반 온라인 감정
    ├── offline: 오프라인 실물 감정
    └── from_auction: 옥션 낙찰 상품 감정
    │
    ▼
[감정 진행] (pending → in_review → completed)
    │
    ▼
[감정서 발급] (인증번호, QR코드, PDF)
    │
    ▼
[복원/수선 서비스 연계] (선택적)
```

---

## 5. 서버 시작 프로세스

```javascript
// server.js 초기화 순서
1. dotenv 환경변수 로드
2. Express 앱 생성 + HTTP 서버 + Socket.IO
3. CORS, bodyParser 설정
4. MySQL 세션 스토어 연결
5. 세션 미들웨어 적용
6. 관리자 활동 로깅 미들웨어
7. 메트릭 미들웨어
8. API 라우트 마운트 (/api/*)
9. 정적 파일 서빙 (public/)
10. 호스트 기반 URL 리라이트 (cassystem.com → /appr)
11. HTML 페이지 라우트
12. 에러 핸들링 미들웨어
13. 서버 리스닝 (PORT)
14. 만료 스케줄러 시작
15. Elasticsearch 백그라운드 초기화
```

---

## 6. 환경 변수 (필수)

| 변수명                    | 설명                                           |
| ------------------------- | ---------------------------------------------- |
| `DB_HOST`                 | MySQL 호스트                                   |
| `DB_PORT`                 | MySQL 포트 (기본: 3306)                        |
| `DB_USER`                 | MySQL 사용자                                   |
| `DB_PASSWORD`             | MySQL 비밀번호                                 |
| `DB_NAME`                 | 데이터베이스명                                 |
| `SESSION_SECRET`          | 세션 암호화 키                                 |
| `PORT`                    | 서버 포트 (기본: 3000)                         |
| `NODE_ENV`                | 환경 (production/development)                  |
| `FRONTEND_URL`            | 프론트엔드 URL (QR/링크 생성용)                |
| `ALLOWED_ORIGINS`         | CORS 허용 도메인 (쉼표 구분)                   |
| `ELASTICSEARCH_URL`       | ES 서버 URL (선택, 미설정 시 DB LIKE fallback) |
| `PROXY_IPS`               | 프록시 IP 목록 (쉼표 구분)                     |
| `AWS_REGION`              | AWS 리전                                       |
| `AWS_ACCESS_KEY_ID`       | AWS 액세스 키                                  |
| `AWS_SECRET_ACCESS_KEY`   | AWS 시크릿 키                                  |
| `S3_BUCKET_NAME`          | S3 버킷명                                      |
| `CLOUDFRONT_URL`          | CloudFront CDN URL                             |
| `CURRENCYFREAKS_API_KEY`  | 환율 API 키                                    |
| `ALIGO_API_KEY`           | Aligo 알림톡 API 키                            |
| `ALIGO_USER_ID`           | Aligo 사용자 ID                                |
| `ALIGO_SENDER_KEY`        | Aligo 발신 키                                  |
| `ALIGO_SENDER`            | Aligo 발신 번호                                |
| `POPBILL_LINK_ID`         | Popbill 링크 ID                                |
| `POPBILL_SECRET_KEY`      | Popbill 시크릿 키                              |
| `POPBILL_CORP_NUM`        | Popbill 사업자번호                             |
| `POPBILL_BANK_ACCOUNT_NO` | Popbill 은행 계좌번호                          |
| `NICEPAY_CLIENT_KEY`      | NICEpay 클라이언트 키                          |
| `NICEPAY_SECRET_KEY`      | NICEpay 시크릿 키                              |
| `LOGEN_CUST_ID`           | 로젠 고객 ID                                   |
