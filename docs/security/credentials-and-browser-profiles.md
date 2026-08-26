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

본인 저장목록 획득은 사용자 PC의 전용 client-assisted profile을 목표로 한다. Place는 사용자의
아이디·비밀번호·MFA seed를 받지 않으며 로그인 요청 body, cookie, Provider bearer token, 실제 profile
경로를 서버로 전송하지 않는다. 로그인과 2차 인증 중에는 trace, screenshot, 요청 body capture를
중지하고 인증 완료 상태만 전달한다. 일상용 브라우저 profile을 직접 열지 않으며 전용 profile의 생성,
독점 실행, 종료, 재인증, 철회 책임을 명시한다.

상세 보강용 서버 Provider profile은 사용자 profile과 별개인 배포 소유 read-only workload다.
Fulfillment Worker는 회원 ID를 Provider Adapter에 전달하지 않고 Provider Place ID만 전달한다.
profile reference와 key는 보호 저장소에서 composition 시 해석하며 DB, Web payload, 로그에 나타나지
않는다. 공식·공개 상세 경로로 충분하면 서버 profile도 사용하지 않는다.
