# Credentials and browser profiles

Identity login and Place provider connections are different. Provider-account tables store metadata
plus opaque secret/profile references; provider passwords, cookies, MFA seeds, browser profile paths,
and provider bearer tokens do not enter those tables, source, contracts, logs, or browser payloads.
The confidential browser BFF is a separate exception: it stores its access/refresh token payload only
as authenticated ciphertext in `browser_auth`, while encryption keys remain deployment secrets outside
the database. Browser cookies still contain opaque IDs only.

The Web OIDC runtime reads the database URL, confidential client secret, and AES-256-GCM keyring only
from deployment-referenced secret files. Secret contents must be exactly one non-empty line. The
keyring uses canonical unpadded base64url for each 32-byte key, names one active key, rejects duplicate
IDs, and may retain prior keys only for decryption during rotation. File paths and secret contents are
not returned in configuration errors. Direct browser or ordinary environment secret values are not
part of the configuration interface.

본인 저장목록 획득의 목표 경계는 회원 기기의 host-neutral Connector다. 확장 프로그램은 선택 가능한
실행 Adapter일 뿐 필수 설치물이 아니다. 곳곳간은 사용자의 아이디·비밀번호·MFA seed를 받지 않으며 로그인 요청 body, cookie,
Provider bearer token, 실제 profile 경로를 서버로 전송하지 않는다. 가져오기마다 Provider session을
조용히 점검하고 만료됐을 때만 실제 Provider 로그인 탭에서 사용자가 인증한다. 로그인과 2차 인증 중에는
trace, screenshot, 요청 body capture를 하지 않는다.

Connector 실행 호스트는 Web/BFF가 발급한 짧은 수명의 일회성 grant로만 capture를 제출한다. grant는 Identity,
Provider, operation, Import 멱등 키, expiry, nonce, item/byte/batch 상한과 공개 Place origin에 묶는다.
Web cookie, 장기 bearer, 임의 upload URL, private Backend 주소를 Connector에 전달하지 않는다. 선택형 확장의 Provider host
permission은 선택 시점에 exact origin 단위로 요청하고 build allowlist 밖 주소는 호출하지 않는다.
한 회원의 여러 browser 설치는 별도 회전 가능한 설치 참조로 관리한다. Place 연결 해제는 Place grant와
논리 연결만 철회하고 Provider cookie를 변경하지 않는다.

현재 versioned Connector schema와 source-only Adapter가 이 경계를 강제한다. grant origin과 page
sender origin이 정확히 일치해야 하고 capture upload는 같은 공개 origin의 고정
`/api/connector/captures` 경로만 사용한다. redirect와 cookie 전송을 거부하며 receipt의 operation,
sequence, checksum이 요청과 일치해야 한다. Chromium·Firefox manifest의 기본 권한은 `storage`이고,
NAVER는 `https://pages.map.naver.com/*`만 optional host permission으로 선언한다. 사용자가 NAVER
가져오기를 선택한 즉시 클릭에서만 이를 요청하며 Kakao·Google 권한은 아직 선언하지 않는다.

Backend는 OIDC로 확인한 회원에게만 grant를 발급하고 token 원문 대신 digest만 저장한다. 동일한
멱등 요청을 재개하면 operation과 ImportBatch는 유지하되 token을 회전해 이전 값을 폐기한다. capture는
공개 origin, provider, operation, 증가 sequence, checksum과 누적 상한을 모두 확인한다. 원본은
배포 keyring의 AES-256-GCM으로 private volume에 저장하고 DB에는 불투명 `capture:` 참조와 보존 기한만
남긴다. 캡처 파일과 DB 확정 사이의 장애는 `pending` receipt로 재개하며, 보존 만료 sweep이 DB와
파일 삭제를 조정한다.

현재 Playwright 진단 도구는 저장소 밖 절대 경로의 전용 Chrome profile만 열고
로그인과 관찰을 별도 명령으로 분리한다. 로그인 명령에는 response listener가 없다. 관찰 명령은
`naver.com` 계열의 query 없는
응답 메타데이터만 발견하고, 운영자가 정확히 허용한 origin에서만 크기가 제한된 JSON을 메모리에서
키·타입 구조로 즉시 변환한다. header, request body, response 값, cookie, token, screenshot, trace,
profile 경로는 보고서에 남지 않으며 서버 전송도 구현하지 않았다. private 보고서와 profile은 서로
겹치지 않는 저장소 밖 디렉터리를 사용한다. 이 전용 profile은 평소 로그인 session을 재사용하지
못하므로 주 회원 경계가 아니라 Playwright 진단·fixture/replay·E2E·통제된 fallback이다.

전체 저장목록 수집도 first-party page 안에서 실행해 cookie와 요청 header를 브라우저 context 밖으로
꺼내지 않는다. 진단 CLI는 계속 합계만 출력하고 값을 폐기한다. production 실행 호스트는 로그인된
회원이 승인한 일회성·짧은 수명의 upload grant로만 캡처를 제출하며, Web session cookie나 장기 bearer
token을 설정으로 복사하지 않는다.

현재 source에는 사용자별 서버, localhost daemon, native-messaging host가 없다. desktop shell이나
browser-control Adapter는 별도 보안·live 검증 후에만 추가하며 수동 캡처/OCR은 출처와 검토 필요 여부를
versioned 계약에 명시한 뒤 같은 Ingestion 경계로 제출한다.

개인 Collection Materialization Worker는 Provider profile이나 Provider Adapter를 전혀 사용하지 않는다.
후속 상세 보강에 서버 Provider profile이 필요하다면 사용자 profile과 별개인 배포 소유 read-only
workload로 두고 Provider Place ID만 전달한다. profile reference와 key는 보호 저장소에서 composition
시에만 해석하며 DB, Web payload, 로그에 나타나지 않는다. 공식·공개 상세 경로로 충분하면 서버
profile도 사용하지 않는다.
