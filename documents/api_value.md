# Value API 문서

## 밸류 엔드포인트

### GET https://casastrade.com/api/values

**설명**: 페이지네이션 및 필터링을 지원하는 밸류 상품 데이터 조회  
**매개변수**:

- `page`: 페이지 번호 (기본값: 1)
- `limit`: 페이지당 상품 수 (기본값: 20)
- `brands`: 쉼표로 구분된 브랜드 목록
- `categories`: 쉼표로 구분된 카테고리 목록
- `scheduledDates`: 쉼표로 구분된 날짜 목록
- `aucNums`: 쉼표로 구분된 경매 번호 목록
- `search`: 상품명 검색어
- `ranks`: 쉼표로 구분된 등급 목록

**응답 구조**:

```json
{
  "data": [
    // 상품 목록
    {
      "id": 28690, // 내부 DB ID
      "item_id": "808-22839", // 상품 고유 식별자
      "title": "K18WG Diamond 0.09ct/Turquoise/ Shell pearl ring 7.8g #12", // 상품명
      "original_title": "K18WG Diamond 0.09ct/Turquoise/ Shell pearl ring 7.8g #12", // 원본 상품명
      "scheduled_date": "2025-03-03T15:00:00.000Z", // 경매 예정일
      "auc_num": "2", // 경매 번호
      "category": "귀금속", // 카테고리
      "brand": "jewelry（No Brand）", // 브랜드
      "rank": "B", // 상품 상태 등급
      "starting_price": "71000.00", // 시작가
      "image": "/images/products/2025-03-01T14-42-23_5c3b002b-3b4d-4078-bde0-7ac8cd3feef2.webp", // 대표 이미지
      "description": null, // 상세 설명 (상세 조회 전 null)
      "additional_images": null, // 추가 이미지 (상세 조회 전 null)
      "accessory_code": null, // 부속품 정보
      "created_at": "2025-03-01T15:25:20.000Z" // 생성일
    }
  ],
  "page": 1,
  "limit": 20,
  "totalItems": 92621,
  "totalPages": 4632
}
```

### GET https://casastrade.com/api/values/brands-with-count

**설명**: 밸류 테이블의 브랜드별 상품 수량 조회  
**응답 예시**:

```json
[
  { "brand": "LOUIS VUITTON", "count": 42 },
  { "brand": "Gucci", "count": 28 }
]
```

### GET https://casastrade.com/api/values/scheduled-dates-with-count

**설명**: 밸류 테이블의 예정된 날짜별 상품 수량 조회  
**응답 예시**:

```json
[
  { "Date": "2025-03-01", "count": 15 },
  { "Date": "2025-03-02", "count": 8 }
]
```

### GET https://casastrade.com/api/values/brands

**설명**: 밸류 테이블의 브랜드 목록 조회  
**응답 예시**:

```json
["LOUIS VUITTON", "Gucci", "HERMES"]
```

### GET https://casastrade.com/api/values/categories

**설명**: 밸류 테이블의 카테고리 목록 조회  
**응답 예시**:

```json
["가방", "시계", "귀금속", "악세서리"]
```

### GET https://casastrade.com/api/values/ranks

**설명**: 밸류 테이블의 상품 등급별 수량 조회  
**응답 예시**:

```json
[
  { "rank": "S", "count": 10 },
  { "rank": "A", "count": 20 },
  { "rank": "B", "count": 35 }
]
```

### GET https://casastrade.com/api/values/auc-nums

**설명**: 밸류 테이블의 경매 번호별 상품 수량 조회  
**응답 예시**:

```json
[
  { "auc_num": "1", "count": 120 },
  { "auc_num": "2", "count": 85 }
]
```

## 밸류 상품 상세 엔드포인트

### POST https://casastrade.com/api/detail/value-details/:itemId

**설명**: 특정 밸류 상품의 상세 정보 조회 (상세 정보가 없을 경우 크롤링하여 조회)  
**URL 매개변수**: `itemId`: 밸류 상품 ID  
**응답 예시**:

```json
{
  "id": 28690,
  "item_id": "808-22839",
  "title": "K18WG Diamond 0.09ct/Turquoise/ Shell pearl ring 7.8g #12",
  "original_title": "K18WG Diamond 0.09ct/Turquoise/ Shell pearl ring 7.8g #12",
  "scheduled_date": "2025-03-03T15:00:00.000Z",
  "auc_num": "2",
  "category": "귀금속",
  "brand": "jewelry（No Brand）",
  "rank": "B",
  "starting_price": "71000.00",
  "image": "/images/products/2025-03-01T14-42-23_5c3b002b-3b4d-4078-bde0-7ac8cd3feef2.webp",
  "description": "Colored stone No mark indicating carat\nFrame Scratche(s) & dent(s) with",
  "additional_images": "[\"/images/products/2025-03-03T07-51-34_b8479a86-29c1-4654-b924-310c9ca61295.webp\",\"/images/products/2025-03-03T07-51-34_111247b4-57b1-4ed2-97f8-b198566a87d7.webp\"]",
  "accessory_code": "",
  "created_at": "2025-03-01T15:25:20.000Z"
}
```

## 이미지 처리

모든 이미지 경로는 상대 경로입니다. 이미지 표시를 위해 기본 URL을 앞에 붙여주세요:

```
https://casastrade.com{image_path}
```

`additional_images`는 JSON 문자열로 반환되므로, 배열로 파싱한 후 각 경로에 기본 URL을 붙여주세요.
