# Place 계약

이 패키지는 Place가 소유하는 HTTP, Connector, event, Tool, stable reference 계약의 기계 판독 배포
경계다. 첫 계약이 생기기 전까지 폴더는 문서에만 존재할 수 있다.

`family-navigation` is a provisional consumer contract because the workspace composer owner is not
yet selected. Its fixture proves only that Place can render an explicitly inactive manifest.

The HTTP contract publishes source-only browser authentication, current-membership, current-consent,
membership-onboarding, and authority-role administration operations. It distinguishes browser BFF
operations from bearer-authenticated backend operations. Publication describes owned
request/response semantics; it does not declare an active Identity client, production database
composition, or Gateway route.

`deploy/application-runtime.json` is the machine-readable source-only process/exposure declaration.
It fixes Web as the future public process, keeps Backend and Worker internal, and forbids browser-to-
Backend and cross-project database connections without making a deployment active.

`membership/membership-policy.v1.schema.json` defines the deployment-owned current consent versions
and initial non-authority grade/tier values. It defines shape and bounds only; the repository contains
no production policy instance or default.

`operations/application-deployment-plan.v1.schema.json` defines the sanitized source-only activation
and rollback plan for one immutable Web/Backend application unit. `operations/database-recovery-
evidence.v1.schema.json` defines the bounded proof emitted only after disposable database-level
backup and isolated restore verification. Neither document contains environment values, credentials,
or a claim that an environment is active.

`place-reference/place-reference.v1.schema.json`은 안정적인 cross-product 결과 envelope을
공개한다. available reference에는 해석된 Canonical Place ID만 포함하고 unavailable과
redacted 결과에는 identifier를 포함하지 않는다. Stage 4 HTTP schema도 인증 command의
membership을 browser 입력에서 제외하고 두 anonymous 공개 projection을 구분한다.

## 생성 규칙

`src/`의 TypeScript/Zod schema가 HTTP, Connector, Search, Taxonomy, PlaceReference 계약의 단일
작성 원본이다. Backend, Web, Member Connector는 `@place/contracts`의 명시적 subpath export를
import한다. Connector는 `@place/contracts/connector`만 사용한다. `http/openapi.v1.json`,
`connector/place-connector.v1.schema.json`, `place-reference/place-reference.v1.schema.json`은 다음
명령으로 생성되는 배포 산출물이며 사람이 같은 enum이나 field 목록을 다시 관리하는 원본이 아니다.

Connector 계약은 Place page command, extension event, operation-bound upload grant, bounded capture
batch와 receipt를 정의한다. cookie, 비밀번호, 임의 upload URL, 내부 Backend 주소는 schema가 허용하지
않는다. 자세한 의미와 delivery state는 `docs/api/connector-v1.md`에 기록한다.

Import 계약의 `enriching` batch/item 상태와 progress count는 Provider Place Identity별 공동
Fulfillment가 진행 중임을 나타낸다. 이 projection에는 내부 job ID, 회원 ID, Provider profile·cookie,
서버 endpoint가 포함되지 않는다. Canonical cache hit, miss 상세 보강, 검토 전환은 같은 공개 상태
계약을 사용한다.

```powershell
npm run generate:contracts
npm run check:contracts
```

생성기 freshness test는 source와 저장된 JSON이 다르면 실패한다. 계약을 수정할 때 source,
생성 산출물, consumer test를 한 변경으로 제출한다.
