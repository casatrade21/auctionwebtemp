# 수선 대상/비대상 분리 처리 요청서 (개발자 전달용)

## 1) 요청 목적
- 사용자 제공 명단(고객명+가방명)은 **수선 중/수선 예정**이므로 `국내도착` 그룹으로 유지/복귀.
- 명단과 **같은 예정일 + 같은 경매장(auc_num)**에 속한 나머지 낙찰건은 수선 비대상으로 보고 `출고됨`으로 보냄.
- 단, **이미 출고됨 상태인 건은 그대로 두고 스킵**.
- `수선내용`은 매칭 기준에서 완전히 무시.

## 2) 대상 기간
- `2026-01-01` ~ `2026-02-25` (로컬/DB 기준 날짜)

## 3) 입력 원본
- 원본 시드 파일: `documents/dev_request_repair_done_to_domestic_2026-02-25_seed.tsv`
- 컬럼:
  - `customer_raw`
  - `product_raw`

## 4) 매칭 규칙 (권장)
- 고객명 정규화:
  - 앞의 `*` 제거
  - 괄호 내 아이디 제거 (예: `(monloulou)`, `(. mirray0660)`)
  - 공백/줄바꿈 정리
- 상품명 정규화:
  - 대소문자 무시
  - 특수문자/중복 공백 제거
  - 긴 문자열 일부만 있는 경우를 감안해 `LIKE %...%` + 토큰 매칭 병행
- 매칭은 `wms_items + crawled_items + users (+ 필요시 wms_repair_cases)` 조인 기준.
- 우선 시드에서 **A그룹(명단 매칭건)**을 확정.

## 5) 그룹 규칙
- A그룹: 시드 매칭건(수선 대상)
  - 처리: `국내도착` 상태로 유지/복귀
- B그룹: A그룹과 같은 `예정일(date)` + `경매장(auc_num)` 조합의 낙찰건 중 A그룹 제외 건
  - 처리: `출고됨`으로 변경
  - 단, 이미 출고됨이면 스킵(무변경)

## 6) 변경 규칙
- A그룹(국내도착):
  - `wms_items.current_location_code = 'DOMESTIC_ARRIVAL_ZONE'`
  - `wms_items.current_status = 'DOMESTIC_ARRIVED'`
  - `wms_repair_cases`가 있으면 `ARRIVED + 수선필드 초기화` 적용
- B그룹(출고됨):
  - 이미 출고됨(`OUTBOUND_ZONE` 등)이면 스킵
  - 출고 전 상태면 `wms_items.current_location_code = 'OUTBOUND_ZONE'`
  - `wms_items.current_status = 'OUTBOUND_READY'`(운영 기준 코드에 맞춰 적용)
  - 관련 수선 케이스는 필요 시 `DONE` 또는 운영 규칙에 맞게 정리

## 7) 작업 순서 (운영 반영 가이드)
1. 시드 매칭 결과를 먼저 `CSV`로 추출해서 사용자 확인 (`seed_match_preview.csv`)
2. A그룹 기준으로 같은 예정일+경매장 확장한 B그룹 결과를 `CSV`로 추출 (`cohort_expansion_preview.csv`)
3. A/B 그룹 최종 확정본(`final_target_preview.csv`) 생성
4. 백업 테이블/스냅샷 생성 후 트랜잭션으로 업데이트
5. 업데이트 후 결과 검증 CSV 생성 (`after_update_check.csv`)

## 8) 주의
- 운영 DB 반영 작업이므로, 반드시:
  - 사전 백업
  - dry-run(SELECT only)
  - 트랜잭션
  - 롤백 계획 확보
- 본 요청은 “수선 대상(A) / 출고 대상(B) 분리” 목적.
