# 0021: Collection membership을 즐겨찾기의 유일한 기준으로 삼는다

Status: accepted

Date: 2026-09-03

## Context

현재 source-only Library v1은 회원과 Place 사이의 `saved`, `wanted`, `personalRating`을 하나의
preference row로 관리하고, 저장 목록·검색·facet의 1차 상태도 `saved` 또는 `wanted`로 표현한다.
Collection은 그 위에 별도로 장소를 담는 조직 수단이다. 그러나 곳곳간에서 사용자가 말하는
즐겨찾기는 시스템이 정한 “저장됨” 또는 “가고 싶음” 상태가 아니라, 사용자가 직접 만들고 이름 붙인
카테고리다. 두 모델을 함께 유지하면 “내 즐겨찾기에 있다”는 질문에 preference와 Collection이 서로
다른 답을 줄 수 있다.

가져온 NAVER·Google·Kakao 목록도 각 Provider의 저장 상태를 공통 boolean으로 평탄화하는 것이 아니라
회원의 private Collection으로 materialize해야 한다. 공개 목록 복사, 순서 변경, 지도 범위, 검색의
개인 signal도 같은 즐겨찾기 기준을 사용해야 한다. 동시에 Rating, Tag, Visit, Writing은 장소를
즐겨찾기에서 제거해도 사라지지 않는 독립 기록이어야 한다.

## Decision

1. 회원의 즐겨찾기 여부를 판단하는 유일한 권위 사실은 그 회원이 소유한 하나 이상의 Collection에
   Place가 포함되어 있는지다. Collection은 사용자가 이름·설명·표지·공개 범위·순서를 관리하는
   1급 도메인 객체다.
2. `saved`와 `wanted`는 새 제품 Interface에서 퇴역한다. 기존 v1 HTTP·package 계약과 persistence는
   consumer 전환 기간에만 Compatibility Adapter 뒤에서 유지할 수 있으며, 새 UI와 새 Module이 이를
   즐겨찾기 의미로 읽거나 쓰지 않는다.
3. Rating과 Tag는 Library가 소유하되 Collection membership과 독립이다. Visit은 Visits Module,
   Writing은 Writing Module이 계속 소유한다. 마지막 Collection membership을 제거해도 Rating, Tag,
   Visit, Writing은 삭제하거나 초기화하지 않는다.
4. 사용자 앱의 흔한 흐름은 다음의 좁고 깊은 Interface로 제공한다.
   - `PersonalLibraryWorkspace`: Collection 중심 목록·필터·지도 scope를 읽는다.
   - `PlaceFiling`: 한 Place를 하나 이상의 Collection에 원자적으로 분류하거나 제외한다.
   - `CollectionOrder`: Collection 내부 장소 순서를 이동한다.
5. 특수 producer와 consumer에는 별도 Interface를 둔다.
   - `ImportedCollectionMaterializer`: Provider 원본 목록·항목 순서와 provenance를 private Collection에
     멱등 반영한다.
   - `PublishedCollectionExchange`: 공개 projection과 전체·일부 복사를 수행하되 개인 기록은 옮기지
     않는다.
   - `PersonalRatingLedger`: 현재 Rating과 불변 변경 이력을 관리한다.
6. 외부 Interface에는 database 정수 `position`을 노출하지 않는다. Collection 변경은 불투명한
   version을 비교하고, 순서 이동은 `first`, `last`, `before`, `after` anchor placement로 표현한다.
   동일 command ID의 성공 결과는 응답 유실 뒤에도 재생할 수 있어야 한다.
7. 각 Module은 소유 schema에 Locality를 유지한다. Admin과 Provider Adapter는 Library schema를 직접
   읽거나 쓰지 않고 위 Interface를 사용한다. Library도 Places, Search, Visits, Writing schema를
   join하지 않으며 필요한 공개 Place projection은 조립 계층에서 주입받는다.
8. 전환은 additive schema와 versioned v2 계약을 먼저 추가하고 consumer를 순서대로 옮긴 뒤 v1을
   제거한다. 현재 active environment가 없으므로 `saved=true` 또는 `wanted=true`이면서 어느
   Collection에도 속하지 않은 legacy orphan 수가 0임을 cutover audit로 증명해야 한다. 이 조건을
   자동 생성한 “저장됨”·“가고 싶음” 특별 Collection으로 우회하지 않는다. audit가 0이 아니면 전환을
   중단하고 해당 데이터의 명시적 reconciliation 계획을 먼저 승인한다.

## Consequences

사용자 언어와 데이터 권위가 하나로 합쳐져 홈, 내 곳곳간, 가져오기, 공개 복사와 향후 내보내기가
같은 즐겨찾기 의미를 사용한다. 흔한 분류 동작은 `PlaceFiling` 하나에 transaction, 잠금 순서,
optimistic concurrency와 command replay를 숨겨 더 깊은 Module이 된다. Provider 추가도
`ImportedCollectionMaterializer`의 안정된 Interface 바깥으로 parser 차이를 밀어낼 수 있다.

반면 기존 `saved`/`wanted` 기반 query, facet, 검색 signal, Place detail과 Web 화면은 v2로
순차 전환해야 한다. 호환 기간에는 두 계약이 공존하지만 두 상태를 동시에 권위 사실로 취급할 수
없다. Compatibility Adapter에는 지원 consumer와 제거 조건을 명시하고 새 기능을 추가하지 않는다.

## Supersession condition

실제 운영 데이터와 사용성 검증에서 Collection membership만으로는 표현할 수 없는 독립적이고 반복
가능한 사용자 의도가 확인되고, 그 의도를 Collection으로 모델링할 때의 오류와 비용이 승인 기준을
넘을 때만 별도 상태를 재검토한다. Provider가 가진 “저장”·“가고 싶음” 표시는 그 자체로 이 결정을
뒤집는 근거가 아니며 Source Observation 또는 import provenance로만 보존한다.
