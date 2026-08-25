# 0010: 입력 중 장소 발견과 Canonical 승격을 분리한다

- 상태: accepted
- 날짜: 2026-08-26

## 배경

Canonical Place가 비어 있는 초기 환경에서도 사용자는 일반 지도 서비스처럼 일부 이름, 지역,
오타·표기 변형을 입력해 실제 후보를 골라야 한다. 모든 장소를 선수집하면 비용·갱신·중복 해결
범위가 불필요하게 커지고, 반대로 입력 문자열을 즉시 Canonical Place나 공개 별칭으로 만들면
오타와 공급자별 이름 차이가 공용 데이터에 섞인다.

제출된 페이지 검색과 입력 중 후보 검색은 지연 시간, pagination, 수명주기, 선택 의미도 다르다.
공급자 세션 토큰이나 credential을 브라우저에 주지 않으면서 NAVER, Kakao, Google의 서로 다른
기능도 한 UI 계약으로 다뤄야 한다.

## 결정

`place-search.v1`은 유지하고 `place-suggestions.v1`을 별도 계약으로 둔다. Search는 다음 세 가지를
소유한다.

1. 브라우저에는 불투명 UUID만 주는 10분 suggestion session
2. 표시된 공급자 후보를 15분 동안 보존하는 replaceable Discovery Projection
3. canonical/Discovery/provider source를 공정하게 합치고 지점·지역·분류·출처를 보존하는 ranking

표시 impression은 Canonical Place, SourceObservation, 공개 이름 지식을 만들지 않는다. 사용자가
후보를 명시적으로 선택하거나 열면 Ingestion의 fingerprint-idempotent SourceObservation을 한 번
기록한다. save, wanted, visit, rating, note, collection, share, PlaceReference 의도로 안정된 Place ID가
필요할 때만 Candidate와 ResolutionDecision을 기록하고 Places의 별도 멱등 command로 create/link한다.

Search는 Ingestion이나 Places 구현을 import하지 않는다. Search가 소유한 materialization port를
HTTP production composition이 Ingestion과 Places 공개 interface에 연결한다. Ingestion도 Places를
import하지 않고 consumer-owned canonical materialization port만 사용한다. 따라서 관측·판정 규칙,
Discovery 저장소, 공급자 adapter가 서로 역참조 없이 바뀐다.

공급자 자동완성은 adapter별로 독립 구현한다. Google은 문서화된 Autocomplete를 사용하고 실제
공급자 session token은 공개 session ID에서 서버에서만 파생한다. Kakao와 NAVER는 현재 공식 keyword/
local search fallback을 명시적으로 사용한다. 응답에는 API key, cookie, browser profile, provider
session token, raw payload를 포함하지 않는다.

## 결과

- 빈 Canonical DB에서도 활성 공급자와 로컬 Discovery가 후보를 제공한다.
- 같은 후보를 같은 session에서 다시 보면 suggestion ID와 evidence ID를 재사용한다.
- provider 장애는 source별 unavailable로 격리되고 다른 후보는 유지된다.
- 선택과 승격 재시도는 동일 observation/candidate/decision/canonical link를 재생한다.
- 위치가 있는 승격 결과만 Search의 unverified canonical projection에 투영하며, 더 높은 source version의
  검증 projection을 덮어쓰지 않는다.
- 전체 지역 선수집은 기본 경로가 아니다. 측정된 zero-result·latency·비용·장애율이 필요성을 보일
  때만 동일 Discovery Projection에 제한적으로 seed한다.
- Crawlee/Playwright는 connected-account import나 검증된 browser-assisted provider adapter의 선택지이며
  입력할 때마다 브라우저를 실행하는 hot path가 아니다.

## 재검토 조건

Discovery가 독립 확장·배포·복구 수명주기를 요구하면 공개 Search port를 유지한 채 별도 runtime이나
database로 이동한다. provider 비용이나 장애 때문에 선별 seed가 필요하면 측정 근거와 retention을
별도 ADR로 기록한다. 입력 문자열을 직접 Canonical Place 또는 공용 alias로 만드는 방식으로는
되돌리지 않는다.
