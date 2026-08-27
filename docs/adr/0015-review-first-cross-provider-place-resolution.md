# 0015: Cross-provider 장소 동일성은 평가와 검토를 먼저 거친다

Status: accepted

Date: 2026-08-28

## Context

NAVER, Google, Kakao의 같은 장소는 이름이 한 글자씩 다르거나 번역·로마자 표기일 수 있다. 반대로
같은 이름의 지점, 같은 건물의 다른 층, 이전·폐점한 장소는 서로 다른 정체성일 수 있다. Provider
identity 하나를 Canonical Place에 너무 일찍 연결하면 이후 merge/split과 개인 Library 출처까지
오염된다. 기존 Ingestion은 관측과 최종 Resolution Decision을, Places는 canonical lifecycle을
소유하지만 cross-provider 비교 자체의 표현·후보 검색·버전 관리 책임은 분리되어 있지 않았다.

## Decision

Backend 내부에 독립 business-capability인 `resolution` 모듈을 둔다. 새 service나 별도 database가
아니며 production composition에서 Ingestion과 Places의 공개 interface 사이에 조립한다.

Resolution은 Provider Place Identity별 최신 Source Observation을 raw-preserving Place Evidence
Representation으로 투영한다. 원문 이름과 language tag는 보존하고 정규화 text·script·phone key·
website host 등은 별도 파생 field로 둔다. 서로 다른 script의 이름은 불일치가 아니라 비교 불가로
취급한다. PostGIS 거리, `pg_trgm` 이름·주소, 정확한 전화·website host로 후보를 제한하고, 거리,
이름, 주소, 전화, website, category, 명시적 branch/floor, 관찰 시점을 독립 feature로 평가한다.

평가 결과는 policy-versioned immutable Match Assessment로 저장한다. `likely-same`, `needs-review`,
`likely-different`는 검토 우선순위일 뿐 Resolution Decision이 아니다. Resolution interface는
Canonical Place 생성·link·merge·split·retire port를 제공하지 않는다. 사람이 승인하거나 별도로
수용된 정책이 만든 Ingestion Resolution Decision만 composition을 거쳐 Places command가 될 수 있다.
AI·embedding은 결정 권한이 없고, 재현 가능한 deterministic baseline과 labelled evaluation dataset을
앞설 수 없다.

## Consequences

다국어 원문과 비교용 표현을 함께 보존해 normalization 변경을 재평가할 수 있고, 후보 검색·feature
계산·판정 정책을 한 깊은 module interface 뒤에서 교체할 수 있다. 잘못된 자동 병합의 영향 범위가
Canonical Place와 개인 데이터로 번지는 것을 막는다. 대신 Stage 8A의 `likely-same`도 자동 연결되지
않으므로 review/evaluation slice가 준비될 때까지 중복 Canonical Place가 남을 수 있다.

## Supersession condition

Korean/Latin 교차 표기, 동명 지점, 같은 건물의 다른 branch/floor, 이전·폐점과 시간 차이를 포함한
대표 labelled dataset에서 자동 link 정책의 precision과 split 복구 비용이 합의된 기준을 지속해서
충족하고, accepted decision·lineage·rollback 운영 증거까지 확보되면 review-only 기본값을 재검토한다.
