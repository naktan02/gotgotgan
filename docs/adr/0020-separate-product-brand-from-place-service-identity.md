# 0020: 제품 브랜드와 Place 서비스 식별자를 분리한다

Status: accepted

Date: 2026-09-03

## Context

제품 이름을 `Place`에서 `곳곳간`으로 확정했고 로컬 폴더와 GitHub 저장소도 사람이 식별하기 쉬운
영문 slug로 바꿔야 한다. 그러나 `place`는 이미 npm scope, 환경 변수, HTTP·Connector 계약,
데이터베이스 역할, Compose 리소스와 릴리스 식별자에 사용된다. 브랜드 변경과 이 식별자들의 동시
변경은 단순 이름 변경이 아니라 데이터·프로토콜 마이그레이션이 된다.

## Decision

- 사용자에게 표시하는 제품명은 `곳곳간`이다.
- 로컬 폴더와 GitHub 저장소 slug는 `gotgotgan`이다.
- `Place`와 `place`는 장소 도메인 또는 호환성이 필요한 내부 서비스 식별자로 유지한다.
- `@place/*`, `PLACE_*`, `/v1/places`, `urn:place:*`, `place-*.v1`, 데이터베이스·네트워크·볼륨과
  릴리스 ID는 별도의 versioned migration이 승인되기 전까지 변경하지 않는다.
- GitHub 저장소 주소를 검증하거나 OCI source provenance로 기록하는 값만 새 저장소 주소로 바꾼다.
- 사용자 문구에서 제품을 가리키는 `Place`는 `곳곳간`으로 바꾸되 `Canonical Place`, `placeId`처럼
  장소 엔티티를 뜻하는 용어는 번역하거나 일괄 치환하지 않는다.

## Consequences

브랜드와 저장소는 제품 의도에 맞게 바뀌면서 기존 계약, 데이터, 배포 리소스와 Connector가 유지된다.
코드 검색만으로 브랜드 변경 대상을 판별할 수 없으므로 사용자 문구와 내부 식별자를 구분해 검토해야
한다. 향후 `admin-web`도 내부 package scope는 `@place/admin-web`을 사용하고 표시명만 `곳곳간 Admin`을
사용할 수 있다.

## Supersession condition

외부 소비자, 배포 환경, 데이터와 Connector를 포함하는 명시적 versioned migration이 승인되고 기존
`place` namespace의 지원 종료 조건과 rollback 절차가 검증된 경우에만 내부 식별자 변경을 재검토한다.
