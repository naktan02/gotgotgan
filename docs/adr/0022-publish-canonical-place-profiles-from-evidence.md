# 0022: 증거 원장으로부터 Canonical Place Profile을 발행한다

Status: accepted

Date: 2026-09-03

## Context

NAVER, Google, Kakao와 이후 추가될 수집원은 같은 현실 장소에 대해 이름, 주소, 좌표, 영업 상태,
분류와 미디어를 서로 다른 시점과 정밀도로 제공한다. Provider payload를 Canonical Place 행에 바로
덮어쓰면 어떤 출처가 현재 값을 만들었는지 설명할 수 없고, 늦게 도착한 오래된 관찰이 검수된 값을
되돌릴 수 있다. 반대로 모든 사실을 각각의 독립 서비스로 분리하면 하나의 장소 화면을 만들기 위해
너무 많은 얕은 Interface와 분산 transaction이 필요하다.

장소의 현실 영업 상태와 Canonical identity의 merge·redirect·retirement 수명주기도 다른 축이다.
폐업한 장소의 참조는 여전히 유효할 수 있고, 영업 중인 중복 identity는 survivor로 redirect될 수 있다.
지역, Taxonomy, 미디어는 각각 독립적으로 version과 권리를 가지므로 자유 문자열이나 일시적인 Provider
URL을 현재 장소 사실에 복사해서는 안 된다. Search는 빠른 탐색을 위한 projection이지만 이 충돌을
판정하는 권위 저장소가 될 수 없다.

## Decision

1. Places Module은 정규화된 fact assertion의 append-only 원장과 불변 Canonical Place Profile revision,
   현재 revision pointer를 소유한다. Provider raw payload와 브라우저 캡처는 Ingestion에 남는다.
2. 하나의 assertion batch는 정확히 하나의 subject와 Source Observation, observed time, rights profile을
   나타낸다. field별 confidence는 다를 수 있다. 같은 batch ID의 동일 입력은 replay하고 다른 입력은
   충돌로 거부한다.
3. Profile은 이름, 주소, 좌표, 영업 상태, 전화, website, 영업시간, 정확한 Taxonomy/Area version과
   stable media reference를 한 번에 발행하는 깊은 Interface다. 발행 command는 예상 revision, 정책
   version, 사유와 사용한 assertion ID를 요구하며 모든 선택 값은 적격 evidence로 설명되어야 한다.
4. Canonical identity 상태 `active | redirected | retired`와 현실의 영업 상태
   `operating | temporarily-closed | permanently-closed | unknown`을 별도로 유지한다.
5. Areas Module은 다국어 이름을 가진 provider-neutral 계층과 선형 version history를 소유한다.
   Taxonomy Module은 category·attribute node와 Provider category mapping을 소유한다. Profile은 두
   Module의 exact version만 참조한다.
6. Media Module은 Provider URL이 아닌 opaque source identity 또는 내부 object reference를 보존한다.
   display 권리는 append-only decision으로 관리하고, 허용 surface·유효 기간·필수 출처 표기가 모두
   충족된 media만 delivery Adapter가 공개 가능한 `displayUri`로 해석할 수 있다.
7. Search는 catalog change feed를 소비하는 Local Search Projection이다. 검색 문서가 늦거나 다시
   만들어져도 assertion, Profile, Area, Taxonomy 또는 Media 권리의 truth가 되지 않는다.
8. Admin과 수집 Adapter는 Places·Areas·Taxonomy·Media의 공개 application Interface를 사용한다.
   서로의 table을 직접 join해 판정을 우회하지 않는다.

## Consequences

현재 장소 값은 출처, 관찰 시각, 정책과 발행 revision으로 설명할 수 있고 Provider 추가나 재수집이
검수된 사실을 자동으로 덮어쓰지 않는다. 장소 상세, 내 곳곳간, 둘러보기와 Search는 동일한 Profile을
기준으로 하면서 각자의 projection을 독립적으로 최적화할 수 있다. 미디어 권리 만료나 출처 표기 누락은
장소 identity를 변경하지 않고 공개만 즉시 차단한다.

대신 수집에서 화면까지 assertion 기록, 후보 검토, Profile 발행, projection 갱신 단계가 생긴다.
정책 version과 operation receipt를 운영해야 하며, Area·Taxonomy·Media의 exact version 참조를 함께
검증해야 한다. 이 복잡성은 Places Module의 발행 Interface 안에 숨기고 소비자에게 전파하지 않는다.

행 하나를 최근 Provider 값으로 덮어쓰는 방식은 provenance와 replay를 잃으므로 채택하지 않았다.
모든 fact를 별도 microservice로 분리하는 방식도 아직 독립 배포·확장 요구가 없고 transaction 경계만
늘리므로 채택하지 않았다.

## Supersession condition

실제 규모에서 하나의 Profile 발행 transaction이 측정 가능한 병목이 되고, 특정 사실군이 독립적인
가용성·보안·배포 수명주기를 필요로 한다는 운영 증거가 축적될 때 Module 또는 process 분리를
재검토한다. Provider 수 증가나 화면 수 증가는 stable Interface 뒤 Adapter와 projection을 늘리는
문제이므로 그 자체로 이 결정을 뒤집지 않는다.
