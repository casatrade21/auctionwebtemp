# Database Schema: app_data

> 자동 생성일: 2026. 3. 2. 오후 8:08:08

## 테이블 목록 (총 40개)

| # | 테이블명 | 설명 | 엔진 | 예상 행 수 | 생성일 |
|---|----------|------|------|------------|--------|
| 1 | [admin_activity_logs](#admin_activity_logs) | - | InnoDB | 24058 | 2026. 2. 19. |
| 2 | [admin_panel_permissions](#admin_panel_permissions) | - | InnoDB | 3 | 2026. 2. 18. |
| 3 | [admin_settings](#admin_settings) | - | InnoDB | 1 | 2025. 10. 1. |
| 4 | [appraisals](#appraisals) | - | InnoDB | 609 | 2026. 2. 10. |
| 5 | [appr_users](#appr_users) | - | InnoDB | 2 | 2026. 2. 2. |
| 6 | [authenticity_guides](#authenticity_guides) | - | InnoDB | 20 | 2025. 5. 21. |
| 7 | [bids](#bids) | - | InnoDB | 405 | 2026. 2. 6. |
| 8 | [courier_companies](#courier_companies) | - | InnoDB | 6 | 2026. 3. 2. |
| 9 | [crawled_items](#crawled_items) | - | InnoDB | 79245 | 2026. 3. 2. |
| 10 | [daily_settlements](#daily_settlements) | - | InnoDB | 562 | 2026. 2. 6. |
| 11 | [deposit_transactions](#deposit_transactions) | - | InnoDB | 7570 | 2026. 3. 2. |
| 12 | [direct_bids](#direct_bids) | - | InnoDB | 8904 | 2026. 2. 24. |
| 13 | [filter_settings](#filter_settings) | - | InnoDB | 362 | 2025. 4. 11. |
| 14 | [instant_purchases](#instant_purchases) | 바로 구매 테이블 | InnoDB | 4 | 2026. 3. 2. |
| 15 | [invoices](#invoices) | - | InnoDB | 170 | 2025. 5. 1. |
| 16 | [live_bids](#live_bids) | - | InnoDB | 15560 | 2026. 2. 24. |
| 17 | [main_banners](#main_banners) | - | InnoDB | 2 | 2025. 6. 9. |
| 18 | [member_groups](#member_groups) | - | InnoDB | 2 | 2026. 2. 20. |
| 19 | [notices](#notices) | - | InnoDB | 3 | 2025. 3. 18. |
| 20 | [payments](#payments) | - | InnoDB | 2 | 2026. 2. 2. |
| 21 | [popbill_documents](#popbill_documents) | - | InnoDB | 142 | 2026. 2. 12. |
| 22 | [recommend_settings](#recommend_settings) | - | InnoDB | 4 | 2025. 9. 15. |
| 23 | [restoration_requests](#restoration_requests) | - | InnoDB | 0 | 2026. 2. 2. |
| 24 | [restoration_services](#restoration_services) | - | InnoDB | 9 | 2025. 6. 1. |
| 25 | [sessions](#sessions) | - | InnoDB | 129 | 2024. 10. 7. |
| 26 | [shipments](#shipments) | - | InnoDB | 0 | 2026. 3. 2. |
| 27 | [translation_cache](#translation_cache) | - | InnoDB | 54302 | 2025. 10. 11. |
| 28 | [used_bank_transactions](#used_bank_transactions) | - | InnoDB | 81 | 2026. 2. 6. |
| 29 | [users](#users) | - | InnoDB | 428 | 2026. 2. 23. |
| 30 | [user_accounts](#user_accounts) | - | InnoDB | 389 | 2026. 2. 2. |
| 31 | [user_member_groups](#user_member_groups) | - | InnoDB | 157 | 2026. 2. 20. |
| 32 | [values_items](#values_items) | - | InnoDB | 1506648 | 2025. 12. 12. |
| 33 | [wishlists](#wishlists) | - | InnoDB | 3299 | 2026. 2. 2. |
| 34 | [wms_items](#wms_items) | - | InnoDB | 277 | 2026. 2. 15. |
| 35 | [wms_locations](#wms_locations) | - | InnoDB | 12 | 2026. 2. 15. |
| 36 | [wms_member_onboarding](#wms_member_onboarding) | - | InnoDB | 0 | 2026. 2. 15. |
| 37 | [wms_repair_cases](#wms_repair_cases) | - | InnoDB | 86 | 2026. 2. 25. |
| 38 | [wms_repair_sheet_settings](#wms_repair_sheet_settings) | - | InnoDB | 2 | 2026. 2. 27. |
| 39 | [wms_repair_vendors](#wms_repair_vendors) | - | InnoDB | 7 | 2026. 2. 24. |
| 40 | [wms_scan_events](#wms_scan_events) | - | InnoDB | 132 | 2026. 2. 15. |

---

## admin_activity_logs

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 24058 | **Auto Increment**: 25684

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `actor_user_id` | `bigint(20)` | O | `NULL` | - | - | - |
| 3 | `actor_login_id` | `varchar(120)` | O | `NULL` | MUL | - | - |
| 4 | `actor_name` | `varchar(200)` | O | `NULL` | - | - | - |
| 5 | `actor_role` | `varchar(60)` | O | `NULL` | - | - | - |
| 6 | `action_method` | `varchar(10)` | X | NULL | - | - | - |
| 7 | `action_path` | `varchar(255)` | X | NULL | MUL | - | - |
| 8 | `action_menu` | `varchar(120)` | O | `NULL` | - | - | - |
| 9 | `action_title` | `varchar(255)` | O | `NULL` | - | - | - |
| 10 | `action_summary` | `text` | O | `NULL` | - | - | - |
| 11 | `action_label` | `varchar(255)` | O | `NULL` | - | - | - |
| 12 | `target_type` | `varchar(100)` | O | `NULL` | - | - | - |
| 13 | `target_id` | `varchar(120)` | O | `NULL` | - | - | - |
| 14 | `ip_address` | `varchar(64)` | O | `NULL` | - | - | - |
| 15 | `user_agent` | `varchar(255)` | O | `NULL` | - | - | - |
| 16 | `http_status` | `int(11)` | O | `NULL` | - | - | - |
| 17 | `detail_json` | `longtext` | O | `NULL` | - | - | - |
| 18 | `created_at` | `datetime` | X | `current_timestamp()` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_admin_activity_actor` | `actor_login_id` | NO | BTREE |
| `idx_admin_activity_created_at` | `created_at` | NO | BTREE |
| `idx_admin_activity_path` | `action_path` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## admin_panel_permissions

- **엔진**: InnoDB | **문자셋**: latin1_swedish_ci | **예상 행 수**: 3 | **Auto Increment**: 17

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `user_id` | `int(11)` | X | NULL | UNI | - | - |
| 3 | `is_superadmin` | `tinyint(1)` | X | `0` | - | - | - |
| 4 | `allowed_menus` | `text` | O | `NULL` | - | - | - |
| 5 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 6 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `user_id` | `user_id` | YES | BTREE |

---

## admin_settings

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 1 | **Auto Increment**: 2

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `crawl_schedule` | `varchar(5)` | X | NULL | - | - | - |
| 3 | `notice` | `mediumtext` | X | NULL | - | - | - |
| 4 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 5 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 6 | `require_login_for_features` | `tinyint(1)` | O | `0` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## appraisals

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 609 | **Auto Increment**: 708

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `appraisal_type` | `enum('quicklink','offline','from_auction')` | X | NULL | - | - | - |
| 3 | `status` | `enum('pending','in_review','completed','cancelled')` | O | `'pending'` | - | - | - |
| 4 | `applicant_name` | `varchar(50)` | O | `NULL` | - | - | - |
| 5 | `applicant_phone` | `varchar(20)` | O | `NULL` | - | - | - |
| 6 | `applicant_email` | `varchar(100)` | O | `NULL` | - | - | - |
| 7 | `brand` | `varchar(100)` | X | NULL | - | - | - |
| 8 | `model_name` | `varchar(255)` | X | NULL | - | - | - |
| 9 | `category` | `varchar(50)` | X | NULL | - | - | - |
| 10 | `remarks` | `text` | O | `NULL` | - | - | - |
| 11 | `product_link` | `text` | O | `NULL` | - | - | - |
| 12 | `platform` | `varchar(50)` | O | `NULL` | - | - | - |
| 13 | `purchase_year` | `varchar(10)` | O | `NULL` | - | - | - |
| 14 | `components_included` | `longtext` | O | `NULL` | - | - | - |
| 15 | `delivery_info` | `longtext` | O | `NULL` | - | - | - |
| 16 | `result` | `enum('authentic','fake','uncertain','pending')` | O | `'pending'` | - | - | - |
| 17 | `result_notes` | `text` | O | `NULL` | - | - | - |
| 18 | `images` | `longtext` | O | `NULL` | - | - | - |
| 19 | `certificate_number` | `varchar(50)` | O | `NULL` | - | - | - |
| 20 | `tccode` | `varchar(50)` | O | `'NONE'` | - | - | - |
| 21 | `certificate_url` | `varchar(255)` | O | `NULL` | - | - | - |
| 22 | `pdf_data` | `longtext` | O | `NULL` | - | - | - |
| 23 | `qrcode_url` | `varchar(255)` | O | `NULL` | - | - | - |
| 24 | `credit_deducted` | `tinyint(1)` | O | `0` | - | - | - |
| 25 | `appraised_at` | `datetime` | O | `NULL` | - | - | - |
| 26 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 27 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 28 | `suggested_restoration_services` | `longtext` | O | `NULL` | - | - | - |
| 29 | `qr_access_key` | `varchar(32)` | O | `NULL` | MUL | - | QR코드 접근키 (인증서별 고유) |
| 30 | `user_id` | `int(11)` | X | NULL | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_qr_access_key` | `qr_access_key` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## appr_users

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 2 | **Auto Increment**: 3

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `tier` | `enum('까사트레이드 회원','제휴사 회원','일반회원')` | X | `'일반회원'` | - | - | - |
| 3 | `quick_link_credits_remaining` | `int(11)` | O | `0` | - | - | - |
| 4 | `quick_link_monthly_limit` | `int(11)` | X | `0` | - | - | - |
| 5 | `quick_link_subscription_type` | `enum('free','paid')` | O | `'free'` | - | - | - |
| 6 | `quick_link_subscription_expires_at` | `date` | O | `NULL` | - | - | - |
| 7 | `offline_appraisal_fee` | `int(11)` | X | `38000` | - | - | - |
| 8 | `zipcode` | `varchar(10)` | O | `NULL` | - | - | - |
| 9 | `address1` | `varchar(255)` | O | `NULL` | - | - | - |
| 10 | `address2` | `varchar(255)` | O | `NULL` | - | - | - |
| 11 | `last_reset_date` | `date` | O | `NULL` | - | - | - |
| 12 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 13 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 14 | `user_id` | `int(11)` | X | NULL | UNI | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `user_id` | `user_id` | YES | BTREE |

---

## authenticity_guides

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 20

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `varchar(36)` | X | NULL | PRI | - | - |
| 2 | `brand` | `varchar(100)` | X | NULL | - | - | - |
| 3 | `guide_type` | `varchar(100)` | X | NULL | - | - | - |
| 4 | `title` | `varchar(255)` | X | NULL | - | - | - |
| 5 | `description` | `text` | X | NULL | - | - | - |
| 6 | `authentic_image` | `varchar(255)` | O | `NULL` | - | - | - |
| 7 | `fake_image` | `varchar(255)` | O | `NULL` | - | - | - |
| 8 | `is_active` | `tinyint(1)` | O | `1` | - | - | - |
| 9 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 10 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## bids

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 405 | **Auto Increment**: 817

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(255)` | X | NULL | MUL | - | - |
| 3 | `first_price` | `decimal(10,2)` | X | NULL | - | - | - |
| 4 | `second_price` | `decimal(10,2)` | O | `NULL` | - | - | - |
| 5 | `final_price` | `decimal(10,2)` | O | `NULL` | - | - | - |
| 6 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 7 | `image` | `varchar(255)` | O | `NULL` | - | - | - |
| 8 | `user_id` | `int(11)` | O | `NULL` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_item_id` | `item_id` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## courier_companies

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 6

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `code` | `varchar(20)` | X | NULL | PRI | - | 택배사 코드 |
| 2 | `name` | `varchar(50)` | X | NULL | - | - | 택배사명 |
| 3 | `is_active` | `tinyint(1)` | O | `1` | - | - | - |
| 4 | `sort_order` | `int(11)` | O | `0` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `code` | YES | BTREE |

---

## crawled_items

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 79245 | **Auto Increment**: 4229106

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(255)` | X | NULL | MUL | - | - |
| 3 | `title` | `varchar(1000)` | O | `NULL` | MUL | - | - |
| 4 | `original_title` | `varchar(1000)` | O | `NULL` | - | - | - |
| 5 | `scheduled_date` | `datetime` | O | `NULL` | - | - | - |
| 6 | `auc_num` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 7 | `category` | `varchar(255)` | O | `NULL` | - | - | - |
| 8 | `brand` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 9 | `rank` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 10 | `starting_price` | `decimal(20,2)` | O | `NULL` | - | - | - |
| 11 | `image` | `varchar(255)` | O | `NULL` | - | - | - |
| 12 | `description` | `mediumtext` | O | `NULL` | - | - | - |
| 13 | `additional_images` | `mediumtext` | O | `NULL` | - | - | - |
| 14 | `accessory_code` | `varchar(255)` | O | `NULL` | - | - | - |
| 15 | `additional_info` | `longtext` | O | `NULL` | - | - | - |
| 16 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 17 | `bid_type` | `enum('live','direct','instant')` | X | NULL | MUL | - | - |
| 18 | `original_scheduled_date` | `datetime` | O | `NULL` | - | - | - |
| 19 | `is_enabled` | `tinyint(1)` | X | `1` | MUL | - | - |
| 20 | `is_expired` | `tinyint(1)` | O | `0` | MUL | - | - |
| 21 | `recommend` | `int(11)` | X | `0` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_auc_num` | `auc_num` | NO | BTREE |
| `idx_bid_type_scheduled` | `bid_type`, `scheduled_date` | NO | BTREE |
| `idx_ci_fulltext_title` | `title` | NO | FULLTEXT |
| `idx_crawled_items_is_enabled` | `is_enabled` | NO | BTREE |
| `idx_crawled_items_recommend` | `recommend` | NO | BTREE |
| `idx_is_expired` | `is_expired` | NO | BTREE |
| `idx_item_id_auc_num` | `item_id`, `auc_num` | YES | BTREE |
| `idx_main_query` | `brand`, `category`, `scheduled_date`, `bid_type` | NO | BTREE |
| `idx_price_sort` | `brand`, `category`, `starting_price` | NO | BTREE |
| `idx_rank` | `rank` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## daily_settlements

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 562 | **Auto Increment**: 887

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `settlement_date` | `date` | X | NULL | MUL | - | - |
| 3 | `item_count` | `int(11)` | O | `0` | - | - | - |
| 4 | `total_japanese_yen` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 5 | `total_amount` | `decimal(15,2)` | X | NULL | - | - | - |
| 6 | `exchange_rate` | `decimal(10,4)` | X | NULL | - | - | - |
| 7 | `fee_amount` | `decimal(15,2)` | X | NULL | - | - | - |
| 8 | `vat_amount` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 9 | `appraisal_fee` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 10 | `appraisal_vat` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 11 | `appraisal_count` | `int(11)` | O | `0` | - | - | - |
| 12 | `final_amount` | `decimal(15,2)` | X | NULL | - | - | - |
| 13 | `completed_amount` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 14 | `admin_memo` | `text` | O | `NULL` | - | - | - |
| 15 | `paid_at` | `timestamp` | O | `NULL` | - | - | - |
| 16 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 17 | `repair_fee` | `int(11)` | O | `0` | - | - | 수선 수수료 |
| 18 | `repair_vat` | `int(11)` | O | `0` | - | - | 수선 수수료 VAT |
| 19 | `repair_count` | `int(11)` | O | `0` | - | - | 수선 접수 개수 |
| 20 | `payment_method` | `enum('deposit','bank_api','manual')` | O | `NULL` | - | - | deposit:예치금, bank_api:오픈뱅킹, manual:수동 |
| 21 | `depositor_name` | `varchar(100)` | O | `NULL` | - | - | 입금자명 |
| 22 | `bank_tran_id` | `varchar(20)` | O | `NULL` | - | - | 금융결제원 거래ID |
| 23 | `payment_status` | `enum('unpaid','pending','paid')` | O | `'unpaid'` | MUL | - | - |
| 24 | `user_id` | `int(11)` | O | `NULL` | MUL | - | - |
| 25 | `matched_at` | `datetime` | O | `NULL` | - | - | - |
| 26 | `matched_amount` | `decimal(15,2)` | O | `NULL` | - | - | - |
| 27 | `matched_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 28 | `retry_count` | `int(11)` | O | `0` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_pending_settlement` | `payment_status`, `retry_count`, `settlement_date` | NO | BTREE |
| `idx_settlement_date` | `settlement_date` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `unique_user_date` | `user_id`, `settlement_date` | YES | BTREE |

---

## deposit_transactions

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 7570 | **Auto Increment**: 7769

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `type` | `enum('charge','deduct','refund')` | X | NULL | MUL | - | charge:충전, deduct:차감, refund:환불 |
| 3 | `status` | `enum('pending','confirmed','rejected')` | O | `'confirmed'` | MUL | - | - |
| 4 | `amount` | `decimal(15,2)` | X | NULL | - | - | - |
| 5 | `balance_after` | `decimal(15,2)` | O | `NULL` | - | - | 거래 후 잔액 (개인 회원만) |
| 6 | `related_type` | `enum('direct_bid','live_bid','instant_purchase','settlement_adjust','appraisal','repair','charge_request','refund_request')` | O | `NULL` | MUL | - | - |
| 7 | `related_id` | `bigint(20)` | O | `NULL` | - | - | 관련 ID |
| 8 | `bank_tran_id` | `varchar(20)` | O | `NULL` | - | - | 금융결제원 거래고유번호 |
| 9 | `description` | `text` | O | `NULL` | - | - | 설명 |
| 10 | `depositor_name` | `varchar(100)` | O | `NULL` | - | - | 입금자명 |
| 11 | `admin_memo` | `text` | O | `NULL` | - | - | - |
| 12 | `created_at` | `timestamp` | O | `current_timestamp()` | MUL | - | - |
| 13 | `processed_at` | `timestamp` | O | `NULL` | - | - | - |
| 14 | `user_id` | `int(11)` | X | NULL | MUL | - | - |
| 15 | `matched_at` | `datetime` | O | `NULL` | - | - | 매칭 성공 시각 |
| 16 | `matched_amount` | `decimal(15,2)` | O | `NULL` | - | - | 매칭된 금액 |
| 17 | `matched_name` | `varchar(100)` | O | `NULL` | - | - | 매칭된 입금자명 |
| 18 | `retry_count` | `int(11)` | O | `0` | - | - | 재시도 횟수 (최대 12) |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_pending` | `status`, `retry_count`, `created_at` | NO | BTREE |
| `idx_related` | `related_type`, `related_id` | NO | BTREE |
| `idx_type` | `type` | NO | BTREE |
| `idx_user_created` | `created_at` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## direct_bids

- **엔진**: InnoDB | **문자셋**: latin1_swedish_ci | **예상 행 수**: 8904 | **Auto Increment**: 12822

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(50)` | X | NULL | MUL | - | - |
| 3 | `current_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 4 | `status` | `enum('active','completed','shipped','cancelled')` | O | `'active'` | MUL | - | - |
| 5 | `shipping_status` | `varchar(30)` | X | `'pending'` | - | - | - |
| 6 | `submitted_to_platform` | `tinyint(1)` | O | `0` | - | - | - |
| 7 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 8 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 9 | `winning_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 10 | `appr_id` | `int(11)` | O | `NULL` | - | - | - |
| 11 | `notification_sent_at` | `datetime` | O | `NULL` | - | - | - |
| 12 | `completed_at` | `timestamp` | O | `NULL` | - | - | - |
| 13 | `repair_requested_at` | `datetime` | O | `NULL` | - | - | 수선 접수 시간 |
| 14 | `repair_details` | `text` | O | `NULL` | - | - | - |
| 15 | `repair_fee` | `int(11)` | O | `NULL` | - | - | 수선 비용 (원화, VAT 포함) |
| 16 | `user_id` | `int(11)` | O | `NULL` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_direct_bids_item_status_price` | `item_id`, `status`, `current_price` | NO | BTREE |
| `idx_direct_bids_status_updated` | `status`, `updated_at` | NO | BTREE |
| `idx_direct_bids_user_item` | `user_id`, `item_id` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `unique_user_item` | `user_id`, `item_id` | YES | BTREE |

---

## filter_settings

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 362 | **Auto Increment**: 75809

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `filter_type` | `enum('date','brand','category')` | X | NULL | MUL | - | - |
| 3 | `filter_value` | `varchar(255)` | X | NULL | MUL | - | - |
| 4 | `is_enabled` | `tinyint(1)` | O | `1` | - | - | - |
| 5 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 6 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_filter_settings_type` | `filter_type` | NO | BTREE |
| `idx_filter_settings_type_enabled` | `filter_type`, `is_enabled` | NO | BTREE |
| `idx_filter_settings_type_value` | `filter_type`, `filter_value` | NO | BTREE |
| `idx_filter_settings_value` | `filter_value` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `unique_filter` | `filter_type`, `filter_value` | YES | BTREE |

---

## instant_purchases

> 바로 구매 테이블

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 4 | **Auto Increment**: 5

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `user_id` | `int(11)` | X | NULL | MUL | - | - |
| 3 | `item_id` | `varchar(50)` | X | NULL | MUL | - | - |
| 4 | `purchase_price` | `decimal(15,2)` | X | `0.00` | - | - | 구매가 (일본 엔) |
| 5 | `status` | `enum('pending','completed','cancelled')` | X | `'pending'` | MUL | - | - |
| 6 | `shipping_status` | `enum('pending','completed','domestic_arrived','processing','shipped')` | X | `'pending'` | MUL | - | - |
| 7 | `platform_response` | `longtext` | O | `NULL` | - | - | BrandAuc API 응답 데이터 |
| 8 | `completed_at` | `datetime` | O | `NULL` | - | - | - |
| 9 | `appr_id` | `int(11)` | O | `NULL` | - | - | 감정서 ID |
| 10 | `repair_requested_at` | `datetime` | O | `NULL` | - | - | - |
| 11 | `repair_details` | `text` | O | `NULL` | - | - | - |
| 12 | `repair_fee` | `decimal(15,2)` | O | `0.00` | - | - | - |
| 13 | `created_at` | `datetime` | X | `current_timestamp()` | MUL | - | - |
| 14 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_created_at` | `created_at` | NO | BTREE |
| `idx_item_id` | `item_id` | NO | BTREE |
| `idx_shipping_status` | `shipping_status` | NO | BTREE |
| `idx_status` | `status` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## invoices

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 170 | **Auto Increment**: 7412

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `date` | `datetime` | O | `NULL` | MUL | - | - |
| 3 | `auc_num` | `varchar(2)` | X | NULL | - | - | - |
| 4 | `status` | `varchar(10)` | O | `NULL` | - | - | - |
| 5 | `amount` | `bigint(20)` | O | `NULL` | - | - | - |
| 6 | `created_at` | `timestamp` | X | `current_timestamp()` | - | - | - |
| 7 | `updated_at` | `timestamp` | X | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `unique_invoice` | `date`, `auc_num` | YES | BTREE |

---

## live_bids

- **엔진**: InnoDB | **문자셋**: latin1_swedish_ci | **예상 행 수**: 15560 | **Auto Increment**: 16304

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(50)` | X | NULL | - | - | - |
| 3 | `first_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 4 | `second_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 5 | `final_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 6 | `status` | `enum('first','second','final','completed','shipped','cancelled')` | O | `'first'` | MUL | - | - |
| 7 | `shipping_status` | `varchar(30)` | X | `'pending'` | - | - | - |
| 8 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 9 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 10 | `winning_price` | `decimal(12,2)` | O | `NULL` | - | - | - |
| 11 | `appr_id` | `int(11)` | O | `NULL` | - | - | - |
| 12 | `notification_sent_at` | `datetime` | O | `NULL` | - | - | - |
| 13 | `request_sent_at` | `datetime` | O | `NULL` | - | - | - |
| 14 | `completed_at` | `timestamp` | O | `NULL` | - | - | - |
| 15 | `repair_requested_at` | `datetime` | O | `NULL` | - | - | 수선 접수 시간 |
| 16 | `repair_details` | `text` | O | `NULL` | - | - | - |
| 17 | `repair_fee` | `int(11)` | O | `NULL` | - | - | 수선 비용 (원화, VAT 포함) |
| 18 | `user_id` | `int(11)` | O | `NULL` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_live_bids_status_updated` | `status`, `updated_at` | NO | BTREE |
| `idx_live_bids_user_item` | `user_id`, `item_id` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `unique_user_item` | `user_id`, `item_id` | YES | BTREE |

---

## main_banners

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 2

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `varchar(255)` | X | NULL | PRI | - | - |
| 2 | `title` | `varchar(255)` | O | `NULL` | - | - | - |
| 3 | `subtitle` | `varchar(255)` | O | `NULL` | - | - | - |
| 4 | `description` | `mediumtext` | X | NULL | - | - | - |
| 5 | `banner_image` | `varchar(500)` | O | `NULL` | - | - | - |
| 6 | `button_text` | `varchar(100)` | O | `NULL` | - | - | - |
| 7 | `button_link` | `varchar(500)` | O | `NULL` | - | - | - |
| 8 | `display_order` | `int(11)` | O | `0` | - | - | - |
| 9 | `is_active` | `tinyint(1)` | O | `1` | - | - | - |
| 10 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 11 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## member_groups

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 2 | **Auto Increment**: 399

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `name` | `varchar(100)` | X | NULL | UNI | - | - |
| 3 | `sort_order` | `int(11)` | O | `0` | - | - | - |
| 4 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `uk_name` | `name` | YES | BTREE |

---

## notices

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 3 | **Auto Increment**: 51

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `title` | `varchar(255)` | X | NULL | - | - | - |
| 3 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 4 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 5 | `image_url` | `varchar(255)` | X | NULL | - | - | 공지사항 이미지 경로 |
| 6 | `target_url` | `varchar(255)` | O | `NULL` | - | - | 이미지 클릭시 이동할 URL (선택사항) |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## payments

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 2

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `varchar(36)` | X | NULL | PRI | - | - |
| 2 | `order_id` | `varchar(100)` | X | NULL | UNI | - | - |
| 3 | `payment_gateway_transaction_id` | `varchar(100)` | O | `NULL` | - | - | - |
| 4 | `product_type` | `enum('quicklink_subscription','certificate_issue','restoration_service')` | X | NULL | - | - | - |
| 5 | `product_name` | `varchar(255)` | X | NULL | - | - | - |
| 6 | `amount` | `decimal(10,2)` | X | NULL | - | - | - |
| 7 | `status` | `enum('pending','completed','failed','cancelled','auth_failed','auth_signature_mismatch','approval_signature_mismatch','server_error','approval_api_failed')` | O | `'pending'` | - | - | - |
| 8 | `payment_method` | `varchar(50)` | O | `NULL` | - | - | - |
| 9 | `raw_response_data` | `longtext` | O | `NULL` | - | - | - |
| 10 | `card_info` | `longtext` | O | `NULL` | - | - | - |
| 11 | `receipt_url` | `varchar(255)` | O | `NULL` | - | - | - |
| 12 | `related_resource_id` | `varchar(36)` | O | `NULL` | - | - | - |
| 13 | `related_resource_type` | `varchar(50)` | O | `NULL` | - | - | - |
| 14 | `paid_at` | `datetime` | O | `NULL` | - | - | - |
| 15 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 16 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 17 | `user_id` | `int(11)` | X | NULL | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `order_id` | `order_id` | YES | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## popbill_documents

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 142 | **Auto Increment**: 143

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `type` | `enum('taxinvoice','cashbill')` | X | NULL | - | - | 문서 유형 |
| 3 | `mgt_key` | `varchar(50)` | X | NULL | UNI | - | 문서번호 |
| 4 | `related_type` | `enum('deposit','settlement')` | X | NULL | MUL | - | - |
| 5 | `related_id` | `int(11)` | X | NULL | - | - | deposit_transactions.id or daily_settlements.id |
| 6 | `user_id` | `int(11)` | X | NULL | MUL | - | - |
| 7 | `confirm_num` | `varchar(24)` | O | `NULL` | - | - | 국세청승인번호 |
| 8 | `amount` | `decimal(15,2)` | X | NULL | - | - | 발행 금액 |
| 9 | `status` | `enum('issued','failed')` | O | `'issued'` | - | - | - |
| 10 | `error_message` | `text` | O | `NULL` | - | - | - |
| 11 | `created_at` | `datetime` | O | `current_timestamp()` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_related` | `related_type`, `related_id` | NO | BTREE |
| `idx_user` | `user_id` | NO | BTREE |
| `mgt_key` | `mgt_key` | YES | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

### 외래 키

| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |
|------------|------|-------------|----------|
| `popbill_documents_ibfk_1` | `user_id` | `users` | `id` |

---

## recommend_settings

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 4 | **Auto Increment**: 16

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `rule_name` | `varchar(255)` | O | `NULL` | - | - | - |
| 3 | `conditions` | `longtext` | O | `NULL` | - | - | - |
| 4 | `recommend_score` | `int(11)` | O | `NULL` | - | - | - |
| 5 | `is_enabled` | `tinyint(1)` | O | `1` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## restoration_requests

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 0

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `varchar(36)` | X | NULL | PRI | - | - |
| 2 | `appraisal_id` | `varchar(36)` | X | NULL | - | - | - |
| 3 | `certificate_number` | `varchar(50)` | O | `NULL` | - | - | - |
| 4 | `services` | `longtext` | X | NULL | - | - | - |
| 5 | `status` | `enum('pending','in_progress','completed','cancelled')` | O | `'pending'` | - | - | - |
| 6 | `total_price` | `varchar(255)` | X | NULL | - | - | - |
| 7 | `delivery_info` | `longtext` | X | NULL | - | - | - |
| 8 | `notes` | `text` | O | `NULL` | - | - | - |
| 9 | `images` | `longtext` | O | `NULL` | - | - | - |
| 10 | `estimated_completion_date` | `date` | O | `NULL` | - | - | - |
| 11 | `completed_at` | `datetime` | O | `NULL` | - | - | - |
| 12 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 13 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 14 | `user_id` | `int(11)` | X | NULL | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## restoration_services

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 9

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `varchar(36)` | X | NULL | PRI | - | - |
| 2 | `name` | `varchar(100)` | X | NULL | - | - | - |
| 3 | `description` | `text` | O | `NULL` | - | - | - |
| 4 | `price` | `varchar(255)` | X | NULL | - | - | - |
| 5 | `estimated_days` | `varchar(50)` | X | NULL | - | - | 예상 소요일 (예: "7일", "7~10일") |
| 6 | `before_image` | `varchar(255)` | O | `NULL` | - | - | - |
| 7 | `after_image` | `varchar(255)` | O | `NULL` | - | - | - |
| 8 | `is_active` | `tinyint(1)` | O | `1` | - | - | - |
| 9 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 10 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |

---

## sessions

- **엔진**: InnoDB | **문자셋**: latin1_swedish_ci | **예상 행 수**: 129

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `session_id` | `varchar(128)` | X | NULL | PRI | - | - |
| 2 | `expires` | `int(11) unsigned` | X | NULL | - | - | - |
| 3 | `data` | `mediumtext` | O | `NULL` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `session_id` | YES | BTREE |

---

## shipments

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 0 | **Auto Increment**: 1

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `bid_type` | `enum('live','direct','instant')` | X | NULL | MUL | - | - |
| 3 | `bid_id` | `int(11)` | X | NULL | - | - | - |
| 4 | `wms_item_id` | `int(11)` | O | `NULL` | MUL | - | - |
| 5 | `user_id` | `int(11)` | X | NULL | MUL | - | - |
| 6 | `logen_slip_no` | `varchar(11)` | O | `NULL` | MUL | - | 로젠 송장번호 |
| 7 | `logen_order_no` | `varchar(100)` | O | `NULL` | - | - | 자체 주문번호 |
| 8 | `logen_bran_cd` | `varchar(4)` | O | `NULL` | - | - | 배송점코드 |
| 9 | `logen_class_cd` | `varchar(10)` | O | `NULL` | - | - | 분류코드 |
| 10 | `logen_fare_ty` | `varchar(3)` | O | `NULL` | - | - | 운임타입코드 |
| 11 | `courier_code` | `varchar(20)` | X | `'LOGEN'` | - | - | 택배사 코드 |
| 12 | `tracking_number` | `varchar(50)` | O | `NULL` | MUL | - | 송장번호 |
| 13 | `receiver_name` | `varchar(100)` | X | NULL | - | - | - |
| 14 | `receiver_phone` | `varchar(20)` | X | NULL | - | - | - |
| 15 | `receiver_cell_phone` | `varchar(20)` | O | `NULL` | - | - | - |
| 16 | `receiver_zipcode` | `varchar(10)` | O | `NULL` | - | - | - |
| 17 | `receiver_address` | `text` | X | NULL | - | - | - |
| 18 | `receiver_address_detail` | `varchar(500)` | O | `NULL` | - | - | - |
| 19 | `sender_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 20 | `sender_phone` | `varchar(20)` | O | `NULL` | - | - | - |
| 21 | `sender_cell_phone` | `varchar(20)` | O | `NULL` | - | - | - |
| 22 | `sender_address` | `text` | O | `NULL` | - | - | - |
| 23 | `item_name` | `varchar(1000)` | O | `NULL` | - | - | - |
| 24 | `item_count` | `int(11)` | O | `1` | - | - | - |
| 25 | `goods_amount` | `int(11)` | O | `0` | - | - | 물품금액 |
| 26 | `is_jeju` | `tinyint(1)` | O | `0` | - | - | - |
| 27 | `is_island` | `tinyint(1)` | O | `0` | - | - | 연륙도서 |
| 28 | `is_mountain` | `tinyint(1)` | O | `0` | - | - | 산간 |
| 29 | `dlv_fare` | `int(11)` | O | `0` | - | - | 택배운임 |
| 30 | `extra_fare` | `int(11)` | O | `0` | - | - | 할증운임 |
| 31 | `jeju_fare` | `int(11)` | O | `0` | - | - | 제주운임 |
| 32 | `island_fare` | `int(11)` | O | `0` | - | - | 연륙도서운임 |
| 33 | `mountain_fare` | `int(11)` | O | `0` | - | - | 산간운임 |
| 34 | `total_fare` | `int(11)` | O | `0` | - | - | 총 운임 |
| 35 | `status` | `enum('ready','slip_issued','order_registered','picked_up','in_transit','out_for_delivery','delivered','failed','returned')` | O | `'ready'` | MUL | - | - |
| 36 | `tracking_data` | `longtext` | O | `NULL` | - | - | 화물추적 API 응답 캐시 |
| 37 | `tracking_last_status` | `varchar(100)` | O | `NULL` | - | - | 최근 화물상태명 |
| 38 | `last_tracked_at` | `datetime` | O | `NULL` | - | - | - |
| 39 | `delivered_at` | `datetime` | O | `NULL` | - | - | - |
| 40 | `logen_registered_at` | `datetime` | O | `NULL` | - | - | 로젠 주문 등록 시각 |
| 41 | `logen_result_cd` | `varchar(20)` | O | `NULL` | - | - | - |
| 42 | `logen_result_msg` | `text` | O | `NULL` | - | - | - |
| 43 | `admin_memo` | `text` | O | `NULL` | - | - | - |
| 44 | `created_at` | `datetime` | O | `current_timestamp()` | MUL | - | - |
| 45 | `updated_at` | `datetime` | O | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_bid` | `bid_type`, `bid_id` | NO | BTREE |
| `idx_created` | `created_at` | NO | BTREE |
| `idx_slip` | `logen_slip_no` | NO | BTREE |
| `idx_status` | `status` | NO | BTREE |
| `idx_tracking` | `tracking_number` | NO | BTREE |
| `idx_user` | `user_id` | NO | BTREE |
| `idx_wms` | `wms_item_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## translation_cache

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 54302 | **Auto Increment**: 53757

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `source_text` | `text` | X | NULL | MUL | - | - |
| 3 | `translated_text` | `text` | X | NULL | - | - | - |
| 4 | `created_at` | `datetime` | O | `current_timestamp()` | - | - | - |
| 5 | `updated_at` | `datetime` | O | `current_timestamp()` | MUL | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_source` | `source_text` | NO | BTREE |
| `idx_updated` | `updated_at` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## used_bank_transactions

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 81 | **Auto Increment**: 82

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `tid` | `varchar(32)` | X | NULL | UNI | - | 팝빌 거래내역 ID |
| 3 | `trade_dt` | `varchar(14)` | X | NULL | - | - | 거래일시 |
| 4 | `trade_amount` | `decimal(15,2)` | X | NULL | - | - | - |
| 5 | `account_name` | `varchar(100)` | O | `NULL` | - | - | 입금자명 |
| 6 | `used_by_type` | `enum('deposit','settlement')` | X | NULL | - | - | - |
| 7 | `used_by_id` | `int(11)` | X | NULL | - | - | - |
| 8 | `used_at` | `datetime` | O | `current_timestamp()` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_tid` | `tid` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `tid` | `tid` | YES | BTREE |

---

## users

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 428 | **Auto Increment**: 437

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `login_id` | `varchar(100)` | X | NULL | UNI | - | - |
| 3 | `registration_date` | `date` | O | `NULL` | - | - | - |
| 4 | `password` | `varchar(64)` | O | `NULL` | - | - | - |
| 5 | `email` | `varchar(100)` | O | `NULL` | - | - | - |
| 6 | `business_number` | `varchar(20)` | O | `NULL` | - | - | - |
| 7 | `company_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 8 | `phone` | `varchar(20)` | O | `NULL` | - | - | - |
| 9 | `address` | `text` | O | `NULL` | - | - | - |
| 10 | `is_active` | `tinyint(1)` | O | `NULL` | - | - | - |
| 11 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 12 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 13 | `commission_rate` | `decimal(5,2)` | O | `NULL` | - | - | - |
| 14 | `document_type` | `enum('cashbill','taxinvoice')` | X | `'cashbill'` | - | - | - |
| 15 | `role` | `enum('normal','appr')` | O | `'appr'` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `id_new` | `id` | YES | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `unique_login_id` | `login_id` | YES | BTREE |

---

## user_accounts

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 389

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `account_type` | `enum('individual','corporate')` | X | `'individual'` | MUL | - | - |
| 2 | `deposit_balance` | `decimal(15,2)` | O | `0.00` | - | - | 예치금 잔액 |
| 3 | `daily_limit` | `decimal(15,2)` | O | `0.00` | - | - | 일별 한도 |
| 4 | `daily_used` | `decimal(15,2)` | O | `0.00` | - | - | 당일 사용액 |
| 5 | `limit_reset_date` | `date` | O | `NULL` | - | - | 한도 초기화 기준일 |
| 6 | `fintech_use_num` | `varchar(24)` | O | `NULL` | MUL | - | 핀테크이용번호 |
| 7 | `access_token` | `text` | O | `NULL` | - | - | 오픈뱅킹 액세스 토큰 |
| 8 | `refresh_token` | `text` | O | `NULL` | - | - | 오픈뱅킹 리프레시 토큰 |
| 9 | `token_expires_at` | `timestamp` | O | `NULL` | - | - | 토큰 만료 시각 |
| 10 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 11 | `updated_at` | `timestamp` | O | `current_timestamp()` | - | on update current_timestamp() | - |
| 12 | `user_id` | `int(11)` | X | NULL | PRI | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_account_type` | `account_type` | NO | BTREE |
| `idx_fintech` | `fintech_use_num` | NO | BTREE |
| `PRIMARY` | `user_id` | YES | BTREE |

---

## user_member_groups

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 157

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `user_id` | `int(11)` | X | NULL | PRI | - | - |
| 2 | `group_id` | `int(11)` | X | NULL | PRI | - | - |
| 3 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_umg_group_id` | `group_id` | NO | BTREE |
| `PRIMARY` | `user_id`, `group_id` | YES | BTREE |

### 외래 키

| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |
|------------|------|-------------|----------|
| `fk_umg_group_id` | `group_id` | `member_groups` | `id` |
| `fk_umg_user` | `user_id` | `users` | `id` |

---

## values_items

- **엔진**: InnoDB | **문자셋**: utf8mb4_unicode_ci | **예상 행 수**: 1506648 | **Auto Increment**: 3345930

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(255)` | X | NULL | MUL | - | - |
| 3 | `title` | `varchar(1000)` | O | `NULL` | MUL | - | - |
| 4 | `original_title` | `varchar(1000)` | O | `NULL` | - | - | - |
| 5 | `scheduled_date` | `datetime` | O | `NULL` | MUL | - | - |
| 6 | `auc_num` | `varchar(255)` | O | `NULL` | - | - | - |
| 7 | `category` | `varchar(255)` | O | `NULL` | - | - | - |
| 8 | `brand` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 9 | `rank` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 10 | `starting_price` | `decimal(20,2)` | O | `NULL` | - | - | - |
| 11 | `image` | `varchar(255)` | O | `NULL` | MUL | - | - |
| 12 | `description` | `mediumtext` | O | `NULL` | - | - | - |
| 13 | `additional_images` | `mediumtext` | O | `NULL` | - | - | - |
| 14 | `accessory_code` | `varchar(255)` | O | `NULL` | - | - | - |
| 15 | `additional_info` | `longtext` | O | `NULL` | - | - | - |
| 16 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 17 | `final_price` | `decimal(20,2)` | O | `NULL` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_additional_filters` | `rank`, `auc_num`, `scheduled_date` | NO | BTREE |
| `idx_item_id` | `item_id` | NO | BTREE |
| `idx_item_id_auc_num` | `item_id`, `auc_num` | YES | BTREE |
| `idx_main_filters` | `brand`, `category`, `scheduled_date` | NO | BTREE |
| `idx_price_sort` | `brand`, `category`, `final_price` | NO | BTREE |
| `idx_sort_scheduled_id` | `scheduled_date`, `item_id` | NO | BTREE |
| `idx_title_search` | `title` | NO | BTREE |
| `idx_values_items_image` | `image` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## wishlists

- **엔진**: InnoDB | **문자셋**: latin1_swedish_ci | **예상 행 수**: 3299 | **Auto Increment**: 41232

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `varchar(255)` | X | NULL | MUL | - | - |
| 3 | `created_at` | `timestamp` | O | `current_timestamp()` | - | - | - |
| 4 | `favorite_number` | `int(11)` | O | `1` | MUL | - | - |
| 5 | `user_id` | `int(11)` | O | `NULL` | MUL | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_item_id` | `item_id` | NO | BTREE |
| `idx_user_id` | `user_id` | NO | BTREE |
| `idx_wishlists_favorite_number` | `favorite_number` | NO | BTREE |
| `idx_wishlists_item_id` | `item_id` | NO | BTREE |
| `idx_wishlists_user_favorite` | `user_id`, `favorite_number` | NO | BTREE |
| `idx_wishlists_user_id` | `user_id` | NO | BTREE |
| `idx_wishlists_user_item` | `user_id`, `item_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## wms_items

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 277 | **Auto Increment**: 281

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_uid` | `varchar(40)` | X | NULL | UNI | - | - |
| 3 | `member_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 4 | `auction_source` | `varchar(30)` | O | `NULL` | - | - | - |
| 5 | `auction_lot_no` | `varchar(80)` | O | `NULL` | - | - | - |
| 6 | `external_barcode` | `varchar(120)` | O | `NULL` | UNI | - | - |
| 7 | `internal_barcode` | `varchar(120)` | O | `NULL` | UNI | - | - |
| 8 | `request_type` | `tinyint(4)` | X | `0` | - | - | - |
| 9 | `current_status` | `varchar(50)` | X | `'INBOUND'` | MUL | - | - |
| 10 | `current_location_code` | `varchar(50)` | X | `'INBOUND_ZONE'` | MUL | - | - |
| 11 | `hold_reason` | `varchar(255)` | O | `NULL` | - | - | - |
| 12 | `metadata_text` | `longtext` | O | `NULL` | - | - | - |
| 13 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 14 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |
| 15 | `source_bid_type` | `varchar(20)` | O | `NULL` | MUL | - | - |
| 16 | `source_bid_id` | `bigint(20)` | O | `NULL` | - | - | - |
| 17 | `source_item_id` | `varchar(120)` | O | `NULL` | MUL | - | - |
| 18 | `source_scheduled_date` | `datetime` | O | `NULL` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_wms_items_location` | `current_location_code` | NO | BTREE |
| `idx_wms_items_status` | `current_status` | NO | BTREE |
| `idx_wms_source_bid` | `source_bid_type`, `source_bid_id` | NO | BTREE |
| `idx_wms_source_item` | `source_item_id` | NO | BTREE |
| `item_uid` | `item_uid` | YES | BTREE |
| `PRIMARY` | `id` | YES | BTREE |
| `uq_wms_external_barcode` | `external_barcode` | YES | BTREE |
| `uq_wms_internal_barcode` | `internal_barcode` | YES | BTREE |

### 외래 키

| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |
|------------|------|-------------|----------|
| `fk_wms_items_location_code` | `current_location_code` | `wms_locations` | `code` |

---

## wms_locations

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 12 | **Auto Increment**: 258501

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `int(11)` | X | NULL | PRI | auto_increment | - |
| 2 | `code` | `varchar(50)` | X | NULL | UNI | - | - |
| 3 | `name` | `varchar(100)` | X | NULL | - | - | - |
| 4 | `sort_order` | `int(11)` | X | `0` | - | - | - |
| 5 | `is_active` | `tinyint(1)` | X | `1` | - | - | - |
| 6 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 7 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `code` | `code` | YES | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## wms_member_onboarding

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 0 | **Auto Increment**: 1

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `member_name` | `varchar(100)` | X | NULL | - | - | - |
| 3 | `phone` | `varchar(40)` | O | `NULL` | - | - | - |
| 4 | `signup_sheet_row_id` | `varchar(40)` | O | `NULL` | - | - | - |
| 5 | `owner_staff_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 6 | `onboarding_status` | `varchar(50)` | X | `'NEW'` | MUL | - | - |
| 7 | `note` | `varchar(500)` | O | `NULL` | - | - | - |
| 8 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 9 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_wms_member_onboarding_status` | `onboarding_status` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

---

## wms_repair_cases

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 86 | **Auto Increment**: 87

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `bigint(20)` | X | NULL | MUL | - | - |
| 3 | `repair_sheet_row_id` | `varchar(40)` | O | `NULL` | - | - | - |
| 4 | `proposal_status` | `varchar(50)` | X | `'REPAIR_PROPOSED'` | - | - | - |
| 5 | `work_status` | `varchar(50)` | X | `'WAITING'` | - | - | - |
| 6 | `result_status` | `varchar(50)` | X | `'OPEN'` | - | - | - |
| 7 | `note` | `varchar(500)` | O | `NULL` | - | - | - |
| 8 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 9 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |
| 10 | `decision_type` | `varchar(30)` | O | `NULL` | - | - | - |
| 11 | `vendor_name` | `varchar(120)` | O | `NULL` | - | - | - |
| 12 | `repair_note` | `text` | O | `NULL` | - | - | - |
| 13 | `repair_amount` | `decimal(14,2)` | O | `NULL` | - | - | - |
| 14 | `proposal_text` | `longtext` | O | `NULL` | - | - | - |
| 15 | `internal_note` | `text` | O | `NULL` | - | - | - |
| 16 | `created_by` | `varchar(100)` | O | `NULL` | - | - | - |
| 17 | `updated_by` | `varchar(100)` | O | `NULL` | - | - | - |
| 18 | `case_state` | `varchar(30)` | X | `'PROPOSED'` | - | - | - |
| 19 | `proposed_at` | `datetime` | O | `NULL` | - | - | - |
| 20 | `accepted_at` | `datetime` | O | `NULL` | - | - | - |
| 21 | `rejected_at` | `datetime` | O | `NULL` | - | - | - |
| 22 | `completed_at` | `datetime` | O | `NULL` | - | - | - |
| 23 | `external_synced_at` | `datetime` | O | `NULL` | - | - | - |
| 24 | `external_sent_at` | `datetime` | O | `NULL` | - | - | - |
| 25 | `repair_eta` | `varchar(120)` | O | `NULL` | - | - | - |
| 26 | `internal_sent_at` | `datetime` | O | `NULL` | - | - | - |
| 27 | `internal_synced_at` | `datetime` | O | `NULL` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `idx_wms_repair_cases_item` | `item_id` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

### 외래 키

| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |
|------------|------|-------------|----------|
| `fk_wms_repair_cases_item` | `item_id` | `wms_items` | `id` |

---

## wms_repair_sheet_settings

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 2 | **Auto Increment**: 6

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `setting_key` | `varchar(60)` | X | NULL | UNI | - | - |
| 3 | `sheet_url` | `varchar(600)` | O | `NULL` | - | - | - |
| 4 | `sheet_id` | `varchar(180)` | O | `NULL` | - | - | - |
| 5 | `sheet_gid` | `varchar(40)` | O | `NULL` | - | - | - |
| 6 | `updated_by` | `varchar(100)` | O | `NULL` | - | - | - |
| 7 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 8 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `uq_wms_repair_sheet_settings_key` | `setting_key` | YES | BTREE |

---

## wms_repair_vendors

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 7 | **Auto Increment**: 132914

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `name` | `varchar(120)` | X | NULL | UNI | - | - |
| 3 | `is_active` | `tinyint(1)` | X | `1` | - | - | - |
| 4 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |
| 5 | `updated_at` | `datetime` | X | `current_timestamp()` | - | on update current_timestamp() | - |
| 6 | `sheet_url` | `varchar(600)` | O | `NULL` | - | - | - |
| 7 | `sheet_id` | `varchar(180)` | O | `NULL` | - | - | - |
| 8 | `sheet_gid` | `varchar(40)` | O | `NULL` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `PRIMARY` | `id` | YES | BTREE |
| `uq_wms_repair_vendor_name` | `name` | YES | BTREE |

---

## wms_scan_events

- **엔진**: InnoDB | **문자셋**: utf8mb4_general_ci | **예상 행 수**: 132 | **Auto Increment**: 139

### 컬럼

| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |
|---|--------|------|------|--------|-----|------|------|
| 1 | `id` | `bigint(20)` | X | NULL | PRI | auto_increment | - |
| 2 | `item_id` | `bigint(20)` | X | NULL | MUL | - | - |
| 3 | `barcode_input` | `varchar(120)` | X | NULL | - | - | - |
| 4 | `from_location_code` | `varchar(50)` | O | `NULL` | MUL | - | - |
| 5 | `to_location_code` | `varchar(50)` | X | NULL | MUL | - | - |
| 6 | `prev_status` | `varchar(50)` | O | `NULL` | - | - | - |
| 7 | `next_status` | `varchar(50)` | X | NULL | - | - | - |
| 8 | `action_type` | `varchar(50)` | X | `'MOVE'` | - | - | - |
| 9 | `staff_name` | `varchar(100)` | O | `NULL` | - | - | - |
| 10 | `note` | `varchar(500)` | O | `NULL` | - | - | - |
| 11 | `created_at` | `datetime` | X | `current_timestamp()` | - | - | - |

### 인덱스

| 인덱스명 | 컬럼 | 유니크 | 타입 |
|----------|------|--------|------|
| `fk_wms_scan_events_from_location` | `from_location_code` | NO | BTREE |
| `idx_wms_scan_events_item` | `item_id` | NO | BTREE |
| `idx_wms_scan_events_to_location` | `to_location_code` | NO | BTREE |
| `PRIMARY` | `id` | YES | BTREE |

### 외래 키

| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |
|------------|------|-------------|----------|
| `fk_wms_scan_events_from_location` | `from_location_code` | `wms_locations` | `code` |
| `fk_wms_scan_events_item` | `item_id` | `wms_items` | `id` |
| `fk_wms_scan_events_to_location` | `to_location_code` | `wms_locations` | `code` |

---

