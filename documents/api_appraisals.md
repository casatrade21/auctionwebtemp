# CAS 명품감정시스템 API 및 데이터베이스 명세

## 1. API 요약

### 1.1 인증(Auth) API - 기존 코드 사용

| 메서드 | 엔드포인트         | 설명                      |
| ------ | ------------------ | ------------------------- |
| POST   | `/api/auth/login`  | 로그인                    |
| POST   | `/api/auth/logout` | 로그아웃                  |
| GET    | `/api/auth/user`   | 현재 로그인한 사용자 정보 |

### 1.2 감정(Appraisals) API

| 메서드 | 엔드포인트                                                     | 설명                                          |
| ------ | -------------------------------------------------------------- | --------------------------------------------- |
| POST   | `/api/appr/appraisals`                                         | 감정 신청 (퀵링크/오프라인)                   |
| GET    | `/api/appr/appraisals`                                         | 사용자의 감정 신청 목록 조회 (all/today 포함) |
| GET    | `/api/appr/appraisals/:certificate_number`                     | 특정 감정 신청 상세 조회                      |
| GET    | `/api/appr/appraisals/my`                                      | 마이페이지 종합 정보                          |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber`          | 감정서 정보 조회                              |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber/download` | PDF 감정서 다운로드                           |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber/qrcode`   | 감정서 QR코드 이미지 제공                     |
| GET    | `/api/appr/appraisals/authenticity-guides`                     | 브랜드별 정품 구별법 목록 조회                |
| GET    | `/api/appr/appraisals/authenticity-guides/:brand`              | 특정 브랜드의 정품 구별법 조회                |

### 1.3 복원(Restorations) API

| 메서드 | 엔드포인트                        | 설명                         |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/api/appr/restorations/services` | 복원 서비스 목록 조회        |
| POST   | `/api/appr/restorations`          | 복원 서비스 신청             |
| GET    | `/api/appr/restorations`          | 사용자의 복원 요청 목록 조회 |
| GET    | `/api/appr/restorations/:id`      | 복원 요청 상세 정보 조회     |

### 1.4 사용자(Users) API

| 메서드 | 엔드포인트                     | 설명                                   |
| ------ | ------------------------------ | -------------------------------------- |
| GET    | `/api/appr/users/profile`      | 감정원 관련 프로필 및 멤버십 정보 조회 |
| GET    | `/api/appr/users/subscription` | 구독 정보 조회                         |
| POST   | `/api/appr/users/subscription` | 구독 신청/갱신                         |

### 1.5 결제(Payments) API

| 메서드 | 엔드포인트                    | 설명           |
| ------ | ----------------------------- | -------------- |
| POST   | `/api/appr/payments/prepare`  | 결제 준비      |
| POST   | `/api/appr/payments/approve`  | 결제 승인 요청 |
| GET    | `/api/appr/payments/:orderId` | 결제 정보 조회 |
| POST   | `/api/appr/payments/webhook`  | 결제 웹훅 처리 |
| GET    | `/api/appr/payments/history`  | 결제 내역 조회 |

### 1.6 관리자(Admin) API 요약

| 메서드 | 엔드포인트                                 | 설명                                    |
| ------ | ------------------------------------------ | --------------------------------------- |
| GET    | `/api/appr/admin/users`                    | 회원 목록 조회                          |
| PUT    | `/api/appr/admin/users/:id`                | 회원 정보 수정                          |
| GET    | `/api/appr/admin/appraisals`               | 전체 감정 목록 조회                     |
| GET    | `/api/appr/admin/appraisals/:id`           | 감정 상세 정보 조회                     |
| PUT    | `/api/appr/admin/appraisals/:id`           | 감정 결과 및 상태 업데이트 (통합 API)   |
| GET    | `/api/appr/admin/restoration-services`     | 복원 서비스 목록 조회                   |
| POST   | `/api/appr/admin/restoration-services`     | 복원 서비스 추가                        |
| PUT    | `/api/appr/admin/restoration-services/:id` | 복원 서비스 수정                        |
| DELETE | `/api/appr/admin/restoration-services/:id` | 복원 서비스 비활성화                    |
| GET    | `/api/appr/admin/restorations`             | 전체 복원 요청 목록 조회                |
| GET    | `/api/appr/admin/restorations/:id`         | 복원 요청 상세 정보 조회                |
| PUT    | `/api/appr/admin/restorations/:id`         | 복원 상태 및 이미지 업데이트 (통합 API) |
| GET    | `/api/appr/admin/payments`                 | 결제 내역 조회                          |
| GET    | `/api/appr/admin/payments/:id`             | 결제 상세 정보 조회                     |
| GET    | `/api/appr/admin/authenticity-guides`      | 정품 구별법 목록 조회                   |
| POST   | `/api/appr/admin/authenticity-guides`      | 정품 구별법 추가                        |
| PUT    | `/api/appr/admin/authenticity-guides/:id`  | 정품 구별법 수정                        |
| DELETE | `/api/appr/admin/authenticity-guides/:id`  | 정품 구별법 비활성화                    |

## 2. API별 명세

### 2.1 인증(Auth) API

기존과 동일

### 2.2 감정(Appraisals) API

#### 2.2.1 감정 신청 - POST `/api/appr/appraisals`

- **요청 본문**:

  ```json
  {
    "appraisal_type": "quicklink" | "offline",

    // 공통 필드
    "brand": "string",
    "model_name": "string",
    "category": "string",
    "remarks": "string",  // 선택사항

    // 퀵링크 감정 전용 필드
    "product_link": "string",  // 퀵링크용
    "platform": "string",      // 선택사항

    // 오프라인 감정 전용 필드
    "purchase_year": "string",  // 선택사항
    "components_included": ["box", "dustbag", "guarantee-card", "receipt", "tag"],  // 선택사항
    "delivery_info": {
      "name": "string",
      "phone": "string",
      "zipcode": "string",
      "address1": "string",
      "address2": "string"
    }
  }
  ```

- **응답**:
  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "certificate_number": "CAS-YYYYMMDD-XXXX",
      "appraisal_type": "quicklink" | "offline",
      "status": "pending",
      "created_at": "timestamp"
    }
  }
  ```

#### 2.2.2 감정 목록 조회 - GET `/api/appr/appraisals`

**인증**: 선택사항 (로그인 없이도 접근 가능)

- **쿼리 파라미터**:

  - `page`: 페이지 번호 (기본값: 1)
  - `limit`: 페이지당 항목 수 (기본값: 10, 0인 경우 모든 항목 반환)
  - `status`: 상태 필터 (선택사항)
  - `all`: 전체 데이터 조회 (true/false)
  - `today`: 오늘 데이터만 조회 (true/false)
  - `myOnly`: 본인 감정 목록만 조회 (true/false, 로그인 필요)

- **응답 (로그인한 경우)**:

  ```json
  {
    "success": true,
    "appraisals": [
      {
        "id": "uuid",
        "appraisal_type": "quicklink",
        "brand": "string",
        "model_name": "string",
        "status": "pending",
        "result": "pending",
        "certificate_number": "CAS-YYYYMMDD-XXXX",
        "created_at": "timestamp",
        "representative_image": "url"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48,
      "limit": 10
    }
  }
  ```

- **응답 (로그인하지 않은 경우)**:
  ```json
  {
    "success": true,
    "appraisals": [
      {
        "certificate_number": "CAS-YYYYMMDD-XXXX",
        "appraisal_type": "quicklink",
        "brand": "string",
        "model_name": "string",
        "status": "pending",
        "category": "string",
        "created_at": "timestamp"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48,
      "limit": 10
    }
  }
  ```

#### 2.2.3 감정 상세 조회 - GET `/api/appr/appraisals/:certificate_number`

- **응답**:
  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "user_id": "string",
      "certificate_number": "CAS-YYYYMMDD-XXXX",
      "appraisal_type": "quicklink" | "offline",
      "status": "pending" | "in_review" | "completed" | "cancelled",
      "brand": "string",
      "model_name": "string",
      "category": "string",
      "product_link": "string",
      "platform": "string",
      "purchase_year": "string",
      "components_included": ["string"],
      "delivery_info": {},
      "result": "pending" | "authentic" | "fake" | "uncertain",
      "result_notes": "string",
      "images": ["url"],
      "created_at": "timestamp",
      "appraised_at": "timestamp"
    }
  }
  ```

#### 2.2.4 마이페이지 종합 정보 - GET `/api/appr/appraisals/my`

- **응답**:
  ```json
  {
    "success": true,
    "user_info": {
      "id": "string",
      "email": "string",
      "company_name": "string",
      "business_number": "string",
      "address": "string",
      "phone": "string",
      "created_at": "timestamp"
    },
    "membership_info": {
      "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
      "quick_link_credits_remaining": 5,
      "quick_link_monthly_limit": 10,
      "subscription_type": "free" | "paid",
      "subscription_expires_at": "date",
      "offline_appraisal_fee": 38000 | 20000 | 12000
    },
    "recent_appraisals": {
      "appraisals": [
        /* 감정 목록 */
      ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalItems": 48,
        "limit": 10
      }
    }
  }
  ```

#### 2.2.5 감정서 정보 조회 - GET `/api/appr/appraisals/certificate/:certificateNumber`

- **응답**:
  ```json
  {
    "success": true,
    "certificate": {
      "certificate_number": "string",
      "verification_code": "string",
      "appraisal": {
        "certificate_number": "string",
        "brand": "string",
        "model_name": "string",
        "category": "string",
        "appraisal_type": "quicklink" | "offline",
        "created_at": "timestamp",
        "status": "pending" | "in_review" | "completed" | "cancelled"
      }
    }
  }
  ```

#### 2.2.6 PDF 감정서 다운로드 - GET `/api/appr/appraisals/certificate/:certificateNumber/download`

- **응답**: PDF 파일 스트림

#### 2.2.7 감정서 QR코드 이미지 제공 - GET `/api/appr/appraisals/certificate/:certificateNumber/qrcode`

- **응답**: PNG 이미지 스트림

#### 2.2.8 브랜드별 정품 구별법 목록 조회 - GET `/api/appr/appraisals/authenticity-guides`

- **쿼리 파라미터**:
  - `brand`: 브랜드명 (선택사항)
- **응답**:
  ```json
  {
    "success": true,
    "guides": {
      "루이비통": [
        {
          "id": "uuid",
          "brand": "루이비통",
          "guide_type": "로고 비교",
          "title": "로고 비교",
          "description": "정품 루이비통 로고는 정교하고...",
          "authentic_image": "url",
          "fake_image": "url"
        },
        {
          "id": "uuid",
          "brand": "루이비통",
          "guide_type": "가죽 질감 비교",
          "title": "가죽 질감 비교",
          "description": "정품 루이비통 가죽은...",
          "authentic_image": "url",
          "fake_image": "url"
        }
      ],
      "샤넬": [
        /* 샤넬 구별법 목록 */
      ]
    }
  }
  ```

#### 2.2.9 특정 브랜드의 정품 구별법 조회 - GET `/api/appr/appraisals/authenticity-guides/:brand`

- **응답**:
  ```json
  {
    "success": true,
    "brand": "루이비통",
    "guides": [
      {
        "id": "uuid",
        "brand": "루이비통",
        "guide_type": "로고 비교",
        "title": "로고 비교",
        "description": "정품 루이비통 로고는 정교하고...",
        "authentic_image": "url",
        "fake_image": "url"
      },
      {
        "id": "uuid",
        "brand": "루이비통",
        "guide_type": "가죽 질감 비교",
        "title": "가죽 질감 비교",
        "description": "정품 루이비통 가죽은...",
        "authentic_image": "url",
        "fake_image": "url"
      }
    ]
  }
  ```

## 2.3 복원(Restorations) API

### 2.3.1 복원 서비스 목록 조회 - GET `/api/appr/restorations/services`

- **응답**:
  ```json
  {
    "success": true,
    "services": [
      {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "price": "string",
        "estimated_days": 7,
        "before_image": "url",
        "after_image": "url",
        "is_active": true
      }
    ]
  }
  ```

### 2.3.2 복원 서비스 신청 - POST `/api/appr/restorations`

- **요청 본문**:

```json
{
  "certificate_number": "CAS-YYYYMMDD-XXXX",
  "services": [
    {
      "service_id": "uuid",
      "service_name": "string",
      "price": "string"
    }
  ],
  "delivery_info": {
    "name": "string",
    "phone": "string",
    "zipcode": "string",
    "address1": "string",
    "address2": "string"
  },
  "notes": "string"
}
```

- **응답**:

```json
{
  "success": true,
  "restoration": {
    "id": "uuid",
    "appraisal_id": "uuid",
    "certificate_number": "CAS-YYYYMMDD-XXXX",
    "status": "pending",
    "total_price": "string",
    "estimated_completion_date": "date",
    "created_at": "timestamp"
  }
}
```

### 2.3.3 복원 요청 목록 조회 - GET `/api/appr/restorations`

- **쿼리 파라미터**:
  - `page`: 페이지 번호 (기본값: 1)
  - `limit`: 페이지당 항목 수 (기본값: 10)
  - `status`: 상태 필터 (선택사항)
- **응답**:
  ```json
  {
    "success": true,
    "restorations": [
      {
        "id": "uuid",
        "appraisal_id": "uuid",
        "status": "pending" | "in_progress" | "completed" | "cancelled",
        "total_price": "string",
        "created_at": "timestamp",
        "estimated_completion_date": "date",
        "completed_at": "timestamp",
        "brand": "string",
        "model_name": "string"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48,
      "limit": 10
    }
  }
  ```

### 2.3.4 복원 요청 상세 조회 - GET `/api/appr/restorations/:id`

- **응답**:
  ```json
  {
    "success": true,
    "restoration": {
      "id": "uuid",
      "appraisal_id": "uuid",
      "certificate_number": "CAS-YYYYMMDD-XXXX",
      "status": "pending" | "in_progress" | "completed" | "cancelled",
      "services": [
        {
          "service_id": "uuid",
          "service_name": "string",
          "price": "string",
          "status": "pending" | "in_progress" | "completed"
        }
      ],
      "total_price": "string",
      "delivery_info": {
        "name": "string",
        "phone": "string",
        "zipcode": "string",
        "address1": "string",
        "address2": "string"
      },
      "notes": "string",
      "images": {
        "before": ["url"],
        "after": ["url"],
        "progress": ["url"]
      },
      "estimated_completion_date": "date",
      "completed_at": "timestamp",
      "created_at": "timestamp",
      "appraisal": {
        "id": "uuid",
        "brand": "string",
        "model_name": "string",
        "category": "string",
        "images": ["url"]
      }
    }
  }
  ```

## 2.6 관리자(Admin) API

#### 2.6.1 회원 관리

- **GET `/api/appr/admin/users`**: 회원 목록 조회

  - **쿼리 파라미터**:
    - `page`: 페이지 번호 (기본값: 1)
    - `limit`: 페이지당 항목 수 (기본값: 20)
    - `search`: 검색어 (선택사항, ID/이메일/회사명)
  - **응답**:
    ```json
    {
      "success": true,
      "users": [
        {
          "id": "string",
          "email": "string",
          "company_name": "string",
          "phone": "string",
          "created_at": "timestamp",
          "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
          "quick_link_credits_remaining": 5,
          "quick_link_monthly_limit": 10,
          "quick_link_subscription_type": "free" | "paid",
          "quick_link_subscription_expires_at": "date"
        }
      ],
      "pagination": {
        "total": 100,
        "totalPages": 5,
        "currentPage": 1,
        "limit": 20
      }
    }
    ```

- **PUT `/api/appr/admin/users/:id`**: 회원 정보 수정
  - **요청 본문**:
    ```json
    {
      "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
      "quick_link_credits_remaining": 10,
      "quick_link_monthly_limit": 10,
      "offline_appraisal_fee": 38000,
      "quick_link_subscription_type": "free" | "paid",
      "quick_link_subscription_expires_at": "date"
    }
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "user": {
        "id": "string",
        "email": "string",
        "company_name": "string",
        "phone": "string",
        "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
        "quick_link_credits_remaining": 10,
        "quick_link_monthly_limit": 10,
        "quick_link_subscription_type": "free" | "paid",
        "quick_link_subscription_expires_at": "date",
        "offline_appraisal_fee": 38000
      }
    }
    ```

#### 2.6.2 감정 관리

- **GET `/api/appr/admin/appraisals`**: 전체 감정 목록 조회

  - **쿼리 파라미터**:
    - `page`: 페이지 번호 (기본값: 1)
    - `limit`: 페이지당 항목 수 (기본값: 20)
    - `status`: 상태 필터 (선택사항)
    - `result`: 결과 필터 (선택사항)
    - `type`: 유형 필터 (선택사항)
    - `search`: 검색어 (선택사항, 브랜드/모델명/사용자ID/인증서번호)
  - **응답**:

    ```json
    {
      "success": true,
      "appraisals": [
        {
          "id": "uuid",
          "user_id": "string",
          "appraisal_type": "quicklink" | "offline",
          "status": "pending" | "in_review" | "completed" | "cancelled",
          "brand": "string",
          "model_name": "string",
          "category": "string",
          "result": "pending" | "authentic" | "fake" | "uncertain",
          "certificate_number": "CAS-YYYYMMDD-XXXX",
          "created_at": "timestamp",
          "user_email": "string",
          "company_name": "string",
          "representative_image": "url"
        }
      ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalItems": 100,
        "limit": 20
      }
    }
    ```

- **GET `/api/appr/admin/appraisals/:id`**: 감정 상세 정보 조회

  - **응답**:
    ```json
    {
      "success": true,
      "appraisal": {
        "id": "uuid",
        "user_id": "string",
        "appraisal_type": "quicklink" | "offline",
        "status": "pending" | "in_review" | "completed" | "cancelled",
        "certificate_number": "CAS-YYYYMMDD-XXXX",
        "brand": "string",
        "model_name": "string",
        "category": "string",
        "product_link": "string",
        "platform": "string",
        "purchase_year": "string",
        "components_included": ["string"],
        "delivery_info": {},
        "result": "pending" | "authentic" | "fake" | "uncertain",
        "result_notes": "string",
        "images": ["url"],
        "user_email": "string",
        "company_name": "string",
        "created_at": "timestamp"
      }
    }
    ```

- **PUT `/api/appr/admin/appraisals/:id`**: 감정 결과 및 상태 업데이트 (통합 API)

  - 결과 입력 (authentic/fake/uncertain)
  - 결과 노트 작성
  - 이미지 업로드
  - 복원 서비스 제안 (새로 추가됨)
  - PDF 업로드
  - 필요한 경우 QR 코드 자동 생성
  - 크레딧 자동 차감 (결과에 따라)
  - 상태(status) 자동 변경

  **요청**: `multipart/form-data`

  ```
  result: "authentic" | "fake" | "uncertain"
  result_notes: "string"
  suggested_restoration_services: ["uuid", "uuid"] (선택사항, 복원 서비스 ID 배열)
  images: 파일[] (선택사항)
  pdf: 파일 (선택사항, 감정서 PDF)
  ```

  **응답**:

  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "certificate_number": "CAS-YYYYMMDD-XXXX",
      "status": "completed",
      "result": "authentic",
      "result_notes": "string",
      "images": ["url"],
      "suggested_restoration_services": [
        {
          "id": "uuid",
          "name": "string",
          "description": "string",
          "price": 50000
        }
      ],
      "certificate_url": "url",
      "qrcode_url": "url",
      "appraised_at": "timestamp"
    },
    "credit_info": {
      "deducted": true,
      "remaining": 5
    }
  }
  ```

#### 2.6.3 복원 서비스 관리

- **GET `/api/appr/admin/restoration-services`**: 복원 서비스 목록 조회

  - **응답**:
    ```json
    {
      "success": true,
      "services": [
        {
          "id": "uuid",
          "name": "string",
          "description": "string",
          "price": "string",
          "estimated_days": 7,
          "before_image": "url",
          "after_image": "url",
          "is_active": true,
          "created_at": "timestamp",
          "updated_at": "timestamp"
        }
      ]
    }
    ```

- **POST `/api/appr/admin/restoration-services`**: 복원 서비스 추가

  - **요청**: `multipart/form-data`
    ```
    name: "string"
    description: "string"
    price: "string"
    estimated_days: 7
    before_image: 파일 (선택사항)
    after_image: 파일 (선택사항)
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "service": {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "price": "string",
        "estimated_days": 7,
        "before_image": "url",
        "after_image": "url",
        "is_active": true
      }
    }
    ```

- **PUT `/api/appr/admin/restoration-services/:id`**: 복원 서비스 수정

  - **요청**: `multipart/form-data`
    ```
    name: "string" (선택사항)
    description: "string" (선택사항)
    price: "string" (선택사항)
    estimated_days: 7 (선택사항)
    before_image: 파일 (선택사항)
    after_image: 파일 (선택사항)
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "service": {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "price": "string",
        "estimated_days": 7,
        "before_image": "url",
        "after_image": "url",
        "is_active": true
      }
    }
    ```

- **DELETE `/api/appr/admin/restoration-services/:id`**: 복원 서비스 비활성화
  - **응답**:
    ```json
    {
      "success": true,
      "message": "복원 서비스가 비활성화되었습니다."
    }
    ```

#### 2.6.4 복원 요청 관리

- **GET `/api/appr/admin/restorations`**: 전체 복원 요청 목록 조회

  - **쿼리 파라미터**:
    - `page`: 페이지 번호 (기본값: 1)
    - `limit`: 페이지당 항목 수 (기본값: 20)
    - `status`: 상태 필터 (선택사항)
    - `search`: 검색어 (선택사항, 브랜드/모델명/사용자ID/이메일)
  - **응답**:
    ```json
    {
      "success": true,
      "restorations": [
        {
          "id": "uuid",
          "appraisal_id": "uuid",
          "status": "pending" | "in_progress" | "completed" | "cancelled",
          "total_price": "string",
          "created_at": "timestamp",
          "estimated_completion_date": "date",
          "completed_at": "timestamp",
          "brand": "string",
          "model_name": "string",
          "user_id": "string",
          "user_email": "string",
          "company_name": "string"
        }
      ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalItems": 100,
        "limit": 20
      }
    }
    ```

- **GET `/api/appr/admin/restorations/:id`**: 복원 요청 상세 정보 조회

  - **응답**:
    ```json
    {
      "success": true,
      "restoration": {
        "id": "uuid",
        "appraisal_id": "uuid",
        "certificate_number": "CAS-YYYYMMDD-XXXX",
        "status": "pending" | "in_progress" | "completed" | "cancelled",
        "services": [
          {
            "service_id": "uuid",
            "service_name": "string",
            "price": "string",
            "status": "pending" | "in_progress" | "completed"
          }
        ],
        "total_price": "string",
        "delivery_info": {
          "name": "string",
          "phone": "string",
          "zipcode": "string",
          "address1": "string",
          "address2": "string"
        },
        "notes": "string",
        "images": {
          "before": ["url"],
          "after": ["url"],
          "progress": ["url"]
        },
        "user_email": "string",
        "company_name": "string",
        "estimated_completion_date": "date",
        "completed_at": "timestamp",
        "created_at": "timestamp",
        "appraisal": {
          "id": "uuid",
          "brand": "string",
          "model_name": "string",
          "category": "string",
          "images": ["url"]
        }
      }
    }
    ```

- **PUT `/api/appr/admin/restorations/:id`**: 복원 상태 및 이미지 업데이트 (통합 API)
  - **요청**: `multipart/form-data`
    ```
    status: "pending" | "in_progress" | "completed" | "cancelled" (선택사항)
    estimated_completion_date: "date" (선택사항)
    completed_at: "date" (선택사항)
    services: "JSON 문자열" (선택사항, 서비스 상태 업데이트)
    before_images: 파일[] (선택사항)
    after_images: 파일[] (선택사항)
    progress_images: 파일[] (선택사항)
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "restoration": {
        "id": "uuid",
        "status": "in_progress" | "completed" | "cancelled" | "pending",
        "estimated_completion_date": "date",
        "services": [
          {
            "service_id": "uuid",
            "service_name": "string",
            "price": "string",
            "status": "in_progress" | "completed" | "pending"
          }
        ],
        "images": {
          "before": ["url"],
          "after": ["url"],
          "progress": ["url"]
        }
      }
    }
    ```

#### 2.6.5 결제 관리

- **GET `/api/appr/admin/payments`**: 결제 내역 조회

  - **쿼리 파라미터**:
    - `page`: 페이지 번호 (기본값: 1)
    - `limit`: 페이지당 항목 수 (기본값: 20)
    - `status`: 상태 필터 (선택사항)
    - `type`: 상품 유형 필터 (선택사항)
    - `startDate`: 시작 날짜 필터 (선택사항)
    - `endDate`: 종료 날짜 필터 (선택사항)
    - `search`: 검색어 (선택사항, 주문번호/상품명/사용자ID/이메일)
  - **응답**:
    ```json
    {
      "success": true,
      "payments": [
        {
          "id": "uuid",
          "user_id": "string",
          "order_id": "ORDER_TIMESTAMP_XXX",
          "product_type": "quicklink_subscription" | "certificate_issue" | "restoration_service",
          "product_name": "string",
          "amount": 29000,
          "status": "pending" | "ready" | "completed" | "failed" | "cancelled" | "vbank_ready" | "vbank_expired",
          "payment_method": "card",
          "paid_at": "timestamp",
          "created_at": "timestamp",
          "user_email": "string",
          "company_name": "string"
        }
      ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalItems": 100,
        "limit": 20
      }
    }
    ```

- **GET `/api/appr/admin/payments/:id`**: 결제 상세 정보 조회
  - **응답**:
    ```json
    {
      "success": true,
      "payment": {
        "id": "uuid",
        "user_id": "string",
        "order_id": "ORDER_TIMESTAMP_XXX",
        "payment_gateway_transaction_id": "string",
        "product_type": "quicklink_subscription" | "certificate_issue" | "restoration_service",
        "product_name": "string",
        "amount": 29000,
        "status": "pending" | "ready" | "completed" | "failed" | "cancelled" | "vbank_ready" | "vbank_expired",
        "payment_method": "card",
        "raw_response_data": {},
        "card_info": {},
        "receipt_url": "url",
        "related_resource_id": "uuid",
        "related_resource_type": "appraisal" | "restoration",
        "paid_at": "timestamp",
        "created_at": "timestamp",
        "user_email": "string",
        "company_name": "string"
      },
      "related_resource": {
        "type": "appraisal" | "restoration",
        "data": {}
      }
    }
    ```

#### 2.6.6 정품 구별법 관리

- **GET `/api/appr/admin/authenticity-guides`**: 정품 구별법 목록 조회

  - **쿼리 파라미터**:
    - `brand`: 브랜드 필터 (선택사항)
    - `is_active`: 활성화 상태 필터 (선택사항, true/false)
  - **응답**:
    ```json
    {
      "success": true,
      "guides": [
        {
          "id": "uuid",
          "brand": "string",
          "guide_type": "string",
          "title": "string",
          "description": "string",
          "authentic_image": "url",
          "fake_image": "url",
          "is_active": true,
          "created_at": "timestamp",
          "updated_at": "timestamp"
        }
      ]
    }
    ```

- **POST `/api/appr/admin/authenticity-guides`**: 정품 구별법 추가

  - **요청**: `multipart/form-data`
    ```
    brand: "string"
    guide_type: "string"
    title: "string"
    description: "string"
    authentic_image: 파일 (선택사항)
    fake_image: 파일 (선택사항)
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "guide": {
        "id": "uuid",
        "brand": "string",
        "guide_type": "string",
        "title": "string",
        "description": "string",
        "authentic_image": "url",
        "fake_image": "url",
        "is_active": true
      }
    }
    ```

- **PUT `/api/appr/admin/authenticity-guides/:id`**: 정품 구별법 수정

  - **요청**: `multipart/form-data`
    ```
    brand: "string" (선택사항)
    guide_type: "string" (선택사항)
    title: "string" (선택사항)
    description: "string" (선택사항)
    authentic_image: 파일 (선택사항)
    fake_image: 파일 (선택사항)
    is_active: "true" | "false" (선택사항)
    ```
  - **응답**:
    ```json
    {
      "success": true,
      "guide": {
        "id": "uuid",
        "brand": "string",
        "guide_type": "string",
        "title": "string",
        "description": "string",
        "authentic_image": "url",
        "fake_image": "url",
        "is_active": true
      }
    }
    ```

- **DELETE `/api/appr/admin/authenticity-guides/:id`**: 정품 구별법 비활성화
  - **응답**:
    ```json
    {
      "success": true,
      "message": "정품 구별법이 비활성화되었습니다."
    }
    ```

## 3. 데이터베이스 구조

### 3.1 users 테이블 (사용자 정보)

기존 테이블 사용

### 3.2 appr_users 테이블 (감정 서비스 관련 사용자 추가 정보)

```sql
CREATE TABLE appr_users (
  user_id VARCHAR(50) PRIMARY KEY,                -- users 테이블의 id 참조
  tier ENUM('까사트레이드 회원', '제휴사 회원', '일반회원') DEFAULT '일반회원',
  quick_link_credits_remaining INT DEFAULT 0,
  quick_link_monthly_limit INT DEFAULT 0,
  quick_link_subscription_type ENUM('free', 'paid') DEFAULT 'free',
  quick_link_subscription_expires_at DATETIME NULL,
  offline_appraisal_fee INT DEFAULT 38000,
  last_reset_date DATE NULL,                      -- 크레딧 마지막 리셋 날짜
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.3 appraisals 테이블 (감정 신청 및 결과)

```sql
CREATE TABLE appraisals (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,                -- users 테이블의 id 참조
  appraisal_type ENUM('quicklink', 'offline') NOT NULL,
  status ENUM('pending', 'in_review', 'completed', 'cancelled') DEFAULT 'pending',
  certificate_number VARCHAR(50) NOT NULL,     -- 인증서 번호 (자동 생성)

  -- 신청자 정보
  applicant_name VARCHAR(50),
  applicant_phone VARCHAR(20),
  applicant_email VARCHAR(100),

  -- 상품 정보 (공통)
  brand VARCHAR(100) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  remarks TEXT NULL,

  -- 퀵링크 감정 정보
  product_link TEXT NULL,                      -- 퀵링크용 상품 URL
  platform VARCHAR(50) NULL,                   -- 퀵링크용 거래 플랫폼

  -- 오프라인 감정 정보
  purchase_year VARCHAR(10) NULL,
  components_included JSON NULL,               -- ["box", "dustbag", "guarantee-card", "receipt", "tag"]

  -- 오프라인 배송 정보
  delivery_info JSON NULL,                     -- { name, phone, zipcode, address1, address2 }

  -- 감정 결과
  result ENUM('authentic', 'fake', 'uncertain', 'pending') DEFAULT 'pending',
  result_notes TEXT NULL,                      -- 감정 결과 내용 (결과에 대한 텍스트)
  images JSON NULL,                            -- 이미지 URL 배열

  -- 복원 서비스 제안
  suggested_restoration_services JSON NULL,    -- 추천 복원 서비스 정보

  -- 감정서 관련
  certificate_url VARCHAR(255) NULL,           -- 감정서 PDF URL
  qrcode_url VARCHAR(255) NULL,                -- QR코드 이미지 URL

  -- 크레딧 관련
  credit_deducted BOOLEAN DEFAULT FALSE,       -- 크레딧 차감 여부

  -- 시간 정보
  appraised_at DATETIME NULL,                  -- 감정 완료 시간
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.4 restoration_services 테이블 (복원 서비스 목록)

```sql
CREATE TABLE restoration_services (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  price VARCHAR(255) NOT NULL,
  estimated_days INT NOT NULL,
  before_image VARCHAR(255) NULL,
  after_image VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.5 restoration_requests 테이블 (복원 신청)

```sql
CREATE TABLE restoration_requests (
  id VARCHAR(36) PRIMARY KEY,
  appraisal_id VARCHAR(36) NOT NULL,
  certificate_number VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  services JSON NOT NULL,
  status ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
  total_price VARCHAR(255) NOT NULL,
  delivery_info JSON NOT NULL,
  notes TEXT NULL,
  images JSON NULL,
  estimated_completion_date DATE NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.6 payments 테이블 (결제 내역)

```sql
CREATE TABLE payments (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,                -- users 테이블의 id 참조
  order_id VARCHAR(100) NOT NULL UNIQUE,       -- PG사 주문번호 (`Moid`)
  payment_gateway_transaction_id VARCHAR(100) NULL, -- PG사 거래번호 (`TID`)
  product_type ENUM('quicklink_subscription' | 'certificate_issue' | 'restoration_service') NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'ready', 'completed', 'failed', 'cancelled', 'vbank_ready', 'vbank_expired', 'auth_failed', 'auth_signature_mismatch', 'approval_signature_mismatch', 'server_error', 'approval_api_failed') DEFAULT 'pending',
  payment_method VARCHAR(50) NULL,
  raw_response_data JSON NULL,                 -- PG사 응답 원본 데이터
  card_info JSON NULL,                         -- 카드 결제 정보
  receipt_url VARCHAR(255) NULL,               -- 영수증 URL
  related_resource_id VARCHAR(36) NULL,        -- 연관 리소스 ID (appraisal_id, restoration_request_id)
  related_resource_type VARCHAR(50) NULL,      -- 연관 리소스 타입 (appraisal, restoration)
  paid_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.7 authenticity_guides 테이블 (정품 구별법)

```sql
CREATE TABLE authenticity_guides (
  id VARCHAR(36) PRIMARY KEY,
  brand VARCHAR(100) NOT NULL,                 -- 브랜드명 (루이비통, 샤넬, 에르메스 등)
  guide_type VARCHAR(100) NOT NULL,            -- 구별법 유형 (로고 비교, 가죽 질감 비교 등)
  title VARCHAR(255) NOT NULL,                 -- 구별법 제목
  description TEXT NOT NULL,                   -- 구별법 설명
  authentic_image VARCHAR(255) NULL,           -- 정품 이미지 URL
  fake_image VARCHAR(255) NULL,                -- 가품 이미지 URL
  is_active BOOLEAN DEFAULT TRUE,              -- 활성화 여부
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```
