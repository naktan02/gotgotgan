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

Stage 7.5 completion adds versioned process, membership, command-result, preference, Visit summary,
and public-content response schemas. Generated OpenAPI includes every implemented Backend and Web
BFF route. The repository route-inventory guard fails when source and the generated operation list
diverge, and contract validation rejects a JSON 2xx response without an authored schema.

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

`src/`의 TypeScript/Zod schema가 HTTP, Connector, Places, Search, Taxonomy, PlaceReference 계약의 단일
작성 원본이다. Backend, Web, Member Connector는 `@place/contracts`의 명시적 subpath export를
import한다. Connector는 `@place/contracts/connector`만 사용한다. `http/openapi.v1.json`,
`connector/place-connector.v1.schema.json`, `place-reference/place-reference.v1.schema.json`은 다음
명령으로 생성되는 배포 산출물이며 사람이 같은 enum이나 field 목록을 다시 관리하는 원본이 아니다.
내부 공통 UUID, Provider key, 공개 Place summary shape은 각각 `src/primitives.ts`,
`src/providers/`, `src/place-summary/` leaf가 소유한다. 각 공개
subpath는 이를 재사용하거나 기존 위치에서 재-export하며 Contracts architecture guard가
Imports/Connector에서 Search·HTTP로 향하는 역방향 의존성을 거부한다.

`@place/contracts/places`는 `place-detail.v1`을 소유한다. `available`/`redirected`는 공개 Canonical
Place 사실과 선택적인 회원 개인 상태를 분리한다. 인증된 회원의 Canonical Place에 공개 Search
문서가 아직 없으면 `pending`이 개인 상태만 반환하며 이름·좌표·Taxonomy 같은 공개 사실을 꾸며 넣지
않는다. 아직 수집 근거가 없는 Provider 상세 필드도 허용하지 않는다.

`@place/contracts/library`는 `library-command-result.v1`, `library-place-preferences.v1`과 bounded `library-place-list.v3`, `library-place-facets.v1`, `library-collection-list.v1`,
`library-collection-detail.v1`, `library-tag-list.v1` projection을 소유한다. 모든 page limit은
1~50이고 cursor는 불투명하다. 개인 목록은 회원 ID를 browser 입력으로 받지 않으며, 장소 표시
정보는 `@place/contracts/places`의 공개 summary만 재사용한다. Place 목록은 반복 `tagIds` 최대
20개와 `all`/`any` match mode, 지역·Taxonomy key를 축별 최대 10개까지 받고 응답과 cursor에
정규화된 filter를 보존한다. Facet 응답은 saved/sample/projected Place 수와 완전 여부를 함께 반환한다. Library command
union은 Collection rename/delete와 Place move/remove, Tag rename/delete/untag까지 같은 command ID
replay 규칙을 사용한다. `set-place-preferences`는 saved/wanted/Personal Rating 목표 상태 전체와
nullable `expectedUpdatedAt`을 요구하며 offset timestamp를 UTC로 정규화한다.

Collection-first v2 계약은 기존 소비자를 깨지 않도록 같은 subpath에 additive하게 제공한다. 새
`PersonalLibraryWorkspace`, `PlaceFiling`, `CollectionOrder` schema에서 즐겨찾기는 `all` 또는 특정
Collection membership 범위로만 표현하며 `saved`/`wanted`와 정수 position을 허용하지 않는다. Collection
목록과 장소 목록 cursor는 독립적이고, write는 불투명 Collection revision과 anchor placement, 응답
유실 후 replay 가능한 operation receipt 및 존재 정보를 누출하지 않는 안정 rejection을 사용한다.

`@place/contracts/visits`는 `visit-record-result.v1`, `visit-summary.v1`과 회원·fingerprint·임의 evidence를 노출하지 않는 bounded
`visit-history.v1`을 소유한다. `@place/contracts/writing`은 `writing-command-result.v1`과 본문을 최대 280자 preview로 제한한
`writing-list.v2`와 소유자 단건 전체 본문용 `writing-detail.v1`을 분리한다. 목록과 상세는 서버가
처음 저장한 불변 `createdAt`과 마지막 저장 시각 `updatedAt`을 함께 반환한다. 목록은 page limit
1~50과 용도에 묶인 불투명 cursor를 사용한다.

Connector 계약은 Place page command, extension event, operation-bound upload grant, bounded capture
batch와 receipt를 정의한다. cookie, 비밀번호, 임의 upload URL, 내부 Backend 주소는 schema가 허용하지
않는다. 자세한 의미와 delivery state는 `docs/api/connector-v1.md`에 기록한다.

Import 계약의 `enriching` batch/item 상태와 progress count는 Provider Place Identity별 공동
Fulfillment가 진행 중임을 나타낸다. 이 projection에는 내부 job ID, 회원 ID, Provider profile·cookie,
서버 endpoint가 포함되지 않는다. Canonical cache hit, miss 상세 보강, 검토 전환은 같은 공개 상태
계약을 사용한다. `place-import-batch-list.v1`은 exact state 또는 all filter와 최대 50개 이력을,
`place-import-batch-detail.v1`은 원본 목록·항목 순서의 최대 200개 Item page를 정의한다. 두 cursor는
각각 filter와 batch에 묶인 불투명 값이다.

```powershell
npm run generate:contracts
npm run check:contracts
```

생성기 freshness test는 source와 저장된 JSON이 다르면 실패한다. 계약을 수정할 때 source,
생성 산출물, consumer test를 한 변경으로 제출한다.
