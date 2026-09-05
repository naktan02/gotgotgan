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

현행 account-bound 가져오기는 `transfers` v2 계약을 사용한다. 최소 정보 수집을 불변 snapshot으로
고정한 다음, 회원·operation·connection·관측한 계정 fingerprint·installation·manifest·origin·상한에
묶인 grant를 발급한다. Origin이나 installation ID만으로 회원 또는 Provider 계정을 인증하지 않는다.
로그인 창 종료와 정상 JSON 응답도 안정적인 계정 identity의 증거가 아니다. 실제 identity를 관측하지
못하면 cookie·session token·임의 UUID로 fingerprint를 대신 만들지 않는다.

회원 session 전용 grant BFF와 cookie 없는 capability 전송은 별도 채널이다. 폐기된 v1
`/api/connector/captures` 경로를 재사용하거나 Desktop이 Web Origin을 가장해 연결을 우회하지 않는다.
실제 Desktop의 회원 승인·pairing, 계정 identity 관측과 안전한 spool key 수명주기가 조립되기 전에는
서버 가져오기 capability를 활성화하지 않는다. 상세 상태는
[`회원 로컬 커넥터`](../../apps/member-connector/README.md)를 따른다.

Backend는 OIDC로 확인한 회원에게만 grant를 발급하고 token 원문 대신 digest만 저장한다. 같은 grant
command를 재전송했다고 새 plaintext token을 복원하지 않는다. 재개할 때는 새 command로 동일하게
고정된 manifest의 권한을 재발급받는다. capture는 origin, provider, operation, manifest, 증가 sequence,
checksum과 누적 상한을 확인하며 명시적인 complete 이후에만 SourceSnapshot 완료를 보고한다.
최소 정보 저장과 상세 보강은 독립이고, capture 완료만으로 개인 Collection 변경까지 완료했다고
표시하지 않는다. Collection 반영은 회원의 ImportPlan 승인 후 수행한다.

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

현재 Electron Desktop Adapter는 곳곳간 제어 화면과 Provider 로그인에 별도 임시 session을 사용한다.
Provider 창에는 preload·Node 권한·임의 script 실행을 허용하지 않고 sandbox·context isolation·web
security를 유지한다. 기존 사용자의 브라우저 profile은 읽거나 복사하지 않는다. 앱 종료 시 임시
Provider session을 정리한다. localhost daemon·native-messaging host·browser-control 연결은 없다.

공통 실행 호스트는 주입된 수집 Interface만 사용하고 Provider가 로그인 URL·인증 확인 정책·수집 방식과
parser를 소유한다. 인증 만료·권한 거부·rate limit을 다른 방식으로 조용히 우회하지 않는다. 같은
snapshot 안에서 수집 방식을 바꾸거나 API 결과와 OCR 결과를 암묵적으로 섞지 않는다. 향후 DOM·수동
캡처/OCR은 출처와 검토 정책을 명시해야 하며, 계정 불명 일회 가져오기를 검증된 외부 계정 연결로
가장하지 않는다. 현재는 그 별도 일회 가져오기 계약을 활성화하지 않는다.

개인 Collection Materialization Worker는 Provider profile이나 Provider Adapter를 전혀 사용하지 않는다.
후속 상세 보강에 서버 Provider profile이 필요하다면 사용자 profile과 별개인 배포 소유 read-only
workload로 두고 Provider Place ID만 전달한다. profile reference와 key는 보호 저장소에서 composition
시에만 해석하며 DB, Web payload, 로그에 나타나지 않는다. 공식·공개 상세 경로로 충분하면 서버
profile도 사용하지 않는다.
