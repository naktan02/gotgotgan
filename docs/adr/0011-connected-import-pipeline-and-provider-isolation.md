# 0011: 연결 계정 Import 파이프라인과 Provider 격리를 분리한다

- 상태: accepted
- 날짜: 2026-08-26

## 배경

연결 계정의 저장 장소는 공식 API, 계정 내보내기, 브라우저 네트워크 응답, DOM 등 서로 다른
방식으로 들어올 수 있다. NAVER의 저장 목록에는 공개 문서화된 OAuth 범위나 내보내기 API가
확인되지 않았으므로 검증하지 않은 내부 endpoint를 제품 코드에 고정하지 않는다.

## 결정

1. `ingestion`이 연결 메타데이터, ImportBatch/ImportItem, 작업 lease와 fencing, 캡처 메타데이터,
   검토 receipt를 소유한다.
2. `providers/adapters/naver`가 NAVER 전용 캡처 형식과 파서를 소유한다. selector, 내부 응답 필드,
   세션 형태는 Ingestion이나 Web로 노출하지 않는다.
3. 수집 방식은 공개·공유 목록 확인, 격리된 Playwright 네트워크 관찰, 검증된 HTTP 재현,
   접근성/DOM, UI 자동화 순으로 선택한다. 실제 관찰 전에는 endpoint나 selector를 만들지 않는다.
4. HTTP는 DB에 작업을 넣고 별도 Worker가 lease를 획득한다. 비밀번호, cookie, profile 경로 대신
   배포가 해석하는 불투명 참조만 저장한다.
5. 캡처 본문은 private artifact adapter에 둔다. 현재 파일 adapter는 AES-256-GCM으로 암호화하고
   DB에는 checksum, parser version, 획득 방식, 보존 기한, 불투명 참조만 둔다.
6. 수집 완료는 preview다. 명시적 create/link/skip 검토가 evidence와 decision을 기록한 뒤
   Canonical Place를 변경하며, 승인된 장소만 기존 개인 상태를 보존하면서 Library에 저장한다.

## 결과

- NAVER 내부 요청이나 화면이 바뀌면 NAVER acquisition leaf와 replay fixture만 바꾼다.
- 동일 요청, 작업 재획득, 검토 재시도는 idempotency key, lease generation, command receipt로
  중복 효과를 막는다.
- 파서·DB·HTTP·암호화 replay는 `source-only`다. 실제 계정 Playwright 캡처와 profile lifecycle은
  test account로 검증하기 전까지 `integration-gated`다.

## 재검토 조건

공식 저장 목록 API가 생기거나 파일 artifact의 용량·복구·다중 노드 요구가 측정되거나 공통
Acquisition Runtime이 별도 배포 경계로 승인되면 adapter와 운영 경계를 새 ADR로 바꾼다.
