# 곳곳간

곳곳간은 개인 장소를 저장하고 정리하는 서비스다.
장소 검색, 개인 목록, 방문 기록, 메모, 가져오기와 공유를 맡는다.

제품 이름은 `곳곳간`, 저장소 이름은 `gotgotgan`이다.
코드 안의 기존 계약 이름은 호환성을 위해 `place`를 유지한다.

공통 용어는 [CONTEXT](CONTEXT.md)에서 확인한다.

## 현재 상태

코드와 로컬 기능은 많이 구현돼 있지만
운영 서비스 연결이 모두 끝난 상태는 아니다.

현재 구현된 주요 기능:

- Web과 Backend 기본 구조
- PostgreSQL/PostGIS 사용 구조
- 개인 장소 목록
- 검색과 지도
- 외부 장소 정보 읽기
- 가져오기
- 공개 Collection과 Profile

Gateway, Identity, 외부 장소 서비스, AI 기능은
각각 실제 환경에서 연결 검증이 더 필요하다.

현재 작업 순서는 Workspace의
`plans/place-platform-service-implementation.md`가 관리한다.
README에는 단계별 과거 기록을 쌓지 않는다.

## 폴더 구성

```text
apps/web/              사용자 웹 화면
apps/member-connector/ 장소 가져오기 실험·진단 도구
backend/               API, Worker, 장소 처리 규칙
packages/contracts/    프로젝트 사이에서 쓰는 계약
tests/                 구조·계약·통합 시험
docs/                  제품·아키텍처·운영 문서
deploy/                배포 설정
```

곳곳간은 다른 프로젝트의 DB나 내부 소스를 직접 사용하지 않는다.
다른 프로젝트가 장소 정보가 필요하면 정해진 API나 계약을 사용한다.

외부 장소 서비스에서 받은 정보는 바로 최종 장소 정보가 되지 않는다.
출처를 남긴 뒤 확인 절차를 거쳐 곳곳간의 장소 정보에 반영한다.

개인 별점, 방문 기록, 메모는 외부 장소 정보와 구분해서 보관한다.

## 장소 가져오기

현재 기본 방향은 별도 프로그램 설치 없이 웹에서 가져오는 방식이다.
NAVER 공유 목록 링크를 여러 개 넣는 방식이 주요 경로다.

로그인이 필요한 원격 브라우저 방식은 별도 실험 기능으로 둔다.

자세한 내용:

- [웹 가져오기 결정](docs/adr/0025-web-one-shot-saved-place-imports.md)
- [외부 서비스별 가능성 조사](docs/integrations/saved-place-web-import-feasibility.md)
- [가져오기 처리](backend/src/modules/transfers/README.md)

`apps/member-connector`는 현재 제품 기본 설치 경로가 아니다.
가져오기 방식과 parser를 시험하는 용도로 유지한다.

## 검증

의존성을 설치한 뒤 저장소 루트에서 실행한다.

```powershell
npm run check
```

DB나 브라우저가 필요한 세부 시험은
[문서 인덱스](docs/README.md)에서 해당 기능의 실행 방법을 확인한다.

## 문서

작업을 시작할 때 [문서 인덱스](docs/README.md)를 먼저 본다.
구조, API, 데이터, 보안, 운영 내용은 각 문서가 따로 관리한다.

이 저장소는 다른 Workspace 저장소가 없어도 독립적으로 build/test 가능해야 한다.
