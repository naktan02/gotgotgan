# 0011: 연결 계정 Import 파이프라인과 Provider 격리를 분리한다

- 상태: accepted
- 날짜: 2026-08-26

회원 session 획득 방식에 관한 결정 9~11은
[`0012-cross-browser-member-connector.md`](0012-cross-browser-member-connector.md)가 구체화한다.
전용 Playwright profile은 주 회원 흐름이 아니라 진단·재현·E2E·통제된 fallback이다.

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
6. 안정된 Provider identity가 없거나 불완전·충돌 사유가 있는 결과는 preview다. 명시적
   create/link/skip 검토가 evidence와 decision을 기록한 뒤 Canonical Place를 변경하며, 승인된
   장소만 기존 개인 상태를 보존하면서 Library에 저장한다.
7. 사용자가 목록 가져오기를 승인한 것은 그 목록 장소를 개인 Library에 저장하려는 intent로 본다.
   안정된 Provider Place Identity가 이미 Canonical Place에 연결돼 있으면 외부 상세 요청 없이 정책
   decision을 기록하고 자동 저장한다. 연결되지 않았으면 Provider Identity별 공동 Fulfillment Job에
   intent를 연결한다. 같은 장소를 여러 회원이 요청해도 상세 보강은 한 번만 수행한다.
8. Fulfillment Worker는 회원이나 사용자 profile을 Provider 상세 Adapter에 전달하지 않는다. 먼저
   Canonical link를 확인하고 miss일 때만 배포 소유의 read-only Provider profile 또는 더 낮은 상태의
   공식·공개 상세 경로를 호출한다. 충분한 증거는 Canonical create와 각 회원 Library 저장으로 이어지고,
   불완전하거나 충돌하는 결과는 자동 생성하지 않고 `needs-review`로 전환한다.
9. 본인 목록 획득의 목표 경계는 사용자 PC의 client-assisted Connector다. ADR 0012에 따라 현재
   browser profile에 설치되는 하나의 다중 Provider 확장을 사용한다. 로그인·MFA·CAPTCHA는 실제
   Provider 창에서 사용자가 처리하고 인증 요청 body, cookie, token, profile 경로는 Place 서버로
   보내지 않는다. 이 Connector와 실제 NAVER 내부 요청은 관찰 전까지 계속 integration-gated다.
10. 현재 전용-profile 진단 CLI는 로그인과 관찰을 분리한다. 로그인에는 캡처를 연결하지 않는다. 관찰은 Provider
    하위 origin의 값 없는 endpoint 후보만 발견하고, 명시적으로 허용한 exact origin의 bounded JSON만
    키·타입 구조로 변환한다. profile·보고서는 저장소 밖에 두며 서버 제출은 별도 계약 전까지 금지한다.
11. 현재 진단용 로컬 전체 수집기는 first-party 페이지의 인증 context 안에서만 folder/bookmark를 끝까지
    pagination한다. NAVER current/legacy schema 차이는 Provider leaf가 흡수하고 개인 필드는 CLI에
    출력하지 않는다. 현재 결과는 메모리에서 폐기한다. 회원 동의와 일회성·짧은 수명의 upload grant를
    소유하는 versioned network contract 전에는 Web cookie나 장기 token으로 제출을 우회하지 않는다.

## 결과

- NAVER 내부 요청이나 화면이 바뀌면 NAVER acquisition leaf와 replay fixture만 바꾼다.
- 동일 요청, 작업 재획득, 검토 재시도는 idempotency key, lease generation, command receipt로
  중복 효과를 막는다.
- ImportItem과 Fulfillment Intent는 같은 transaction에 기록되어 프로세스 중단 시 신청이 유실되지
  않는다. Provider Identity의 unique job은 여러 회원 요청을 합치고, Library command는 item ID를
  사용해 Worker 재실행에도 중복 저장을 막는다.
- 사용자 목록 profile과 서버 상세 보강 profile의 소유권·수명주기·장애 상태가 섞이지 않는다.
- 파서·DB·HTTP·암호화 replay와 회원 로컬 profile 로그인·비식별 구조 관찰은 `source-only`다.
  실제 저장 목록 acquisition, capture 제출, 서버 상세 profile은 관찰 자료로 검증하기 전까지
  `integration-gated`다.

## 재검토 조건

공식 저장 목록 API가 생기거나 client-assisted Connector의 실제 profile/IPC 요구가 관찰되거나,
파일 artifact의 용량·복구·다중 노드 요구가 측정되거나 공통
Acquisition Runtime이 별도 배포 경계로 승인되면 adapter와 운영 경계를 새 ADR로 바꾼다.
