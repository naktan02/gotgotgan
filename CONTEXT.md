# 곳곳간 용어

코드와 계약에서 쓰는 이름은 유지하되 뜻은 쉽게 설명한다.
비슷해 보이는 용어가 무엇과 다른지도 함께 적는다.

| 용어 | 뜻 | 헷갈리지 말 것 |
|---|---|---|
| External Principal | 로그인 제공자가 확인한 한 사람의 식별 정보다. `(issuer, subject)`로 구분한다. | 이메일, 브라우저가 보낸 역할, Membership |
| Membership | 한 사람이 곳곳간 사용에 동의한 뒤 생기는 곳곳간 회원 관계다. | Identity 계정, 로그인 Session |
| Authority Role | 곳곳간 관리 권한이다. `member`, `reviewer`, `administrator`, `owner`가 있다. | User Grade, Product Tier |
| Platform Role | Identity가 관리하는 전체 플랫폼 관리 등급이다. 곳곳간 권한과는 별개다. | 곳곳간 Authority Role |
| Platform Owner Projection | 현재 Platform Owner를 곳곳간의 유일한 `owner`로 연결한 상태다. | Identity DB 복사, 브라우저 역할 값 |
| User Grade | 참여도나 평판처럼 회원을 분류하는 곳곳간 내부 등급이다. 관리 권한은 주지 않는다. | Authority Role, Product Tier |
| Product Tier | 유료 기능이나 사용량 제한을 나누는 상품 등급이다. 관리 권한은 주지 않는다. | Authority Role, User Grade |
| Membership Consent | 회원이 현재 필수 서비스 문서에 동의했다는 버전이 있는 기록이다. | 로그인 동의, 마케팅 동의 |
| Resource Grant | 특정 장소나 기능에 대해 따로 준 권한이다. | 전체 역할, 브라우저가 보낸 값 |
| Anonymous Visitor | 로그인하지 않은 사용자다. 공개로 허용한 정보만 볼 수 있다. | 회원, 로그인 Guest |
| Public Projection | 로그인하지 않은 사용자에게 공개하기로 고른 필드만 모은 정보다. | 원본 DB 행, 비공개 필드 |
| Access Decision | 현재 요청을 허용할지 거절할지 곳곳간이 내린 결과다. | 화면에서 버튼을 숨기는 것, Gateway 라우팅 |
| Canonical Place | 곳곳간이 관리하는 하나의 실제 장소 ID다. 외부 지도 서비스와 독립적이다. | 외부 서비스의 장소 항목 |
| Canonical Place Profile | 한 Canonical Place를 현재 어떻게 설명할지 정한 검증된 정보 묶음이다. | 외부 서비스 원본 응답 |
| Place Operational Status | 영업 중, 임시 휴업, 폐업, 모름 같은 장소 운영 상태다. | Canonical Place 자체를 없애는 것 |
| Source Observation | 특정 시점에 외부 서비스에서 읽어 온 장소 정보 기록이다. | Canonical Place를 바로 바꾸는 명령 |
| Provider Observation | 외부 서비스의 장소 ID와 연결된 Source Observation이다. 개인이 쓴 값과 구분한다. | 개인 별칭, 계정 소유권 |
| Shared Catalog Contribution | 검토 가능한 외부 장소 정보를 공용 장소 설명에 반영하기 위한 후보 값이다. | 개인 메모, 태그, 별점, 방문 기록 |
| Provider Place Identity | 외부 서비스가 가진 장소 ID다. 하나의 Canonical Place에 연결할 수 있다. | Canonical Place ID, 외부 계정 ID |
| Place Candidate | Source Observation을 정리해 Canonical Place와 연결할지 판단하기 전의 후보 장소다. | 확정된 Canonical Place |
| Place Evidence Representation | 서로 같은 장소인지 비교하기 쉽게 Source Observation을 가공한 자료다. | 원본 관찰 기록, 최종 장소 정보 |
| Match Assessment | 두 장소 관찰이 같은 장소일 가능성을 비교한 기록이다. | 실제 병합 결정 |
| Place Cluster Proposal | 여러 외부 장소 ID가 같은 실제 장소일 수 있다고 묶어 본 후보 그룹이다. | 확정된 Canonical Place |
| Cluster Verification | 후보 그룹이 타당한지 규칙·외부 검증·사람 검토로 판단한 기록이다. | 장소를 실제로 병합할 권한 |
| Resolution Decision | 장소 후보를 어떻게 처리할지 최종 분류한 기록이다. | DB 변경 자체 |
| Imported Place Fulfillment Intent | 사용자가 가져온 외부 장소를 자기 Library에 저장하고 싶다는 요청이다. | 외부 로그인 Session, Canonical Place |
| Place Fulfillment Job | 같은 외부 장소에 대한 여러 저장 요청을 묶어 Canonical Place와 Library에 반영하는 작업이다. | 외부 상세정보 수집 작업 |
| Provider Place Detail State | 외부 장소 상세정보가 준비 중인지, 준비됐는지, 못 가져왔는지 나타내는 상태다. | 개인 저장 성공 여부 |
| Provider Place Detail Job | 외부 장소 하나의 상세정보를 가져와 정리하는 작업이다. 회원 브라우저와는 별개다. | Place Fulfillment Job |
| NAVER TraceForge Detail Source | TraceForge Runner와 NAVER Pack 결과를 NAVER 장소 상세정보로 바꾸는 연결 코드다. | TraceForge Studio, 로그인 우회 기능 |
| Place Redirect | 병합된 예전 Canonical Place ID에서 살아남은 ID로 안내하는 연결이다. | 삭제, 단순 별칭 |
| Place Lineage | 장소 병합·분리로 ID와 외부 연결이 어떻게 바뀌었는지 남긴 이력이다. | 현재 장소 상태 |
| Personal Library | 회원이 자기 장소, Collection, 태그와 개인 별점을 정리하는 공간이다. | 공용 장소 정보, 방문 이력 |
| Collection | 회원이 만든 순서가 있는 장소 목록이다. | 시스템 분류, 외부 서비스 폴더 자체 |
| Personal Alias | 회원이 자기 Library에서 알아보기 쉽게 붙인 이름이다. | 공식 장소명, 외부 서비스 장소명 |
| Collection Color Token | Collection을 지도와 목록에서 구분하기 위해 고르는 제한된 색상 값이다. | 임의 CSS 색상, 장소 분류 |
| Favorite Place | 한 개 이상의 Collection에 들어 있는 Canonical Place다. | 방문 기록, 개인 별점, 외부 즐겨찾기 |
| Source List | 외부 서비스에서 관찰한 저장 목록 또는 폴더다. 이름과 순서를 보존한다. | 곳곳간 Collection |
| One-shot Import Source | 계정을 계속 연결하지 않고 링크·파일·임시 원격 Session으로 한 번 가져온 입력이다. | 장기 계정 연결, 자동 새로고침 권한 |
| Shared-link Import Batch | 사용자가 한 번에 제출한 여러 공유 링크와 각 링크의 결과 묶음이다. | 외부 계정 전체 목록 |
| Remote-browser Import Session | 격리된 원격 브라우저에 사용자가 직접 로그인해 한 번 가져오는 Session이다. | 사용자 PC cookie 재사용, 장기 로그인 저장 |
| Collection Import Provenance | 어떤 가져오기 입력과 외부 목록이 한 Collection을 만들었는지 남긴 출처 기록이다. | 외부 계정 소유권, 공동 소유권 |
| Collection Place Import Provenance | Collection 안의 한 장소가 어떤 외부 항목에서 들어왔는지 남긴 출처 기록이다. | Canonical Place ID 자체 |
| Personal Rating | 한 회원이 장소에 준 현재 0.1~5.0 개인 별점이다. 변경 이력은 비공개다. | 외부 서비스 별점, 전체 평균 |
| Visit | 회원이 한 장소에 실제로 방문한 한 번의 기록이다. 여러 번 만들 수 있다. | 저장·가고 싶음 상태 |
| Note | 장소와 연결할 수 있는 짧은 글이다. 공개 범위를 따로 가진다. | Entry |
| Entry | 여러 장소와 연결할 수 있는 긴 글이다. 공개 범위를 따로 가진다. | Note |
| Unlisted Projection | 링크를 아는 사람만 볼 수 있고 검색 목록에는 나오지 않는 공개 정보다. | 비공개 데이터, 로그인 권한 |
| Public Profile | 회원이 공개하기로 한 이름과 공개 Collection만 보여 주는 프로필이다. | 로그인 계정, 모든 공유 자료 |
| Public Handle | Public Profile 주소에 쓰는 고유한 이름이다. 한 번 사용 후 다른 사람에게 넘기지 않는다. | 실명, 이메일, 로그인 subject |
| Retired Public Handle | 삭제된 프로필이 쓰던 Handle을 다시 쓰지 못하게 보관한 상태다. | 숨긴 프로필, 복구 가능한 로그인명 |
| Public Profile Report | 공개 프로필에 문제가 있다고 회원이 정해진 사유로 신고한 기록이다. | 제재 결정, 공개 댓글 |
| Public Profile Moderation | 운영자가 공개 프로필을 계속 보여 줄지 막을지 정한 상태다. | 회원 정지, 사용자의 공개/비공개 선택 |
| Profile Moderation Decision | 운영자가 공개 프로필 표시 상태를 바꾸거나 유지한 변경 불가 기록이다. | 신고 자체, 이의제기 |
| Public Profile Moderation Notice | 프로필이 차단·복구·이의제기 기각됐음을 소유자에게 보여 주는 알림 기록이다. | 이메일·푸시 발송 자체 |
| Public Profile Appeal | 차단된 프로필 소유자가 해당 결정 한 건을 다시 검토해 달라고 요청한 기록이다. | 자유 형식 문의, 자동 복구 |
| Profile Appeal Resolution | 이의제기를 받아들일지 거절할지 검토자가 내린 최종 기록이다. | 프로필 공개 설정 변경 |
| Collection Copy | 공개된 Collection을 다른 회원이 자기 Collection으로 새로 복사한 결과다. | 원본 Collection 공동 편집 |
| Place Reference | 다른 제품이 장소를 가리킬 때 쓰는 버전이 있는 ID다. | 다른 DB의 foreign key 직접 연결 |
| Taxonomy Node | 장소를 분류하는 곳곳간 공용 카테고리 또는 속성이다. | 외부 서비스의 원문 카테고리 |
| Area Node | 국가·도시·동네 같은 지역을 계층으로 표현한 곳곳간 지역 분류다. | 자유 형식 주소, 현재 지도 화면 |
| Canonical Media Reference | Canonical Place에 연결할 미디어를 가리키는 안정된 ID다. 표시 가능 여부는 별도로 확인한다. | 복사한 외부 이미지 파일, 임시 URL |
| Local Search Projection | 검색을 빠르게 하기 위해 준비한 제한된 장소 정보와 개인 상태다. 원본보다 늦을 수 있다. | Canonical Place 원본 정보 |
| Search Source Outcome | 검색에 참여한 한 데이터 원천이 정상·부분 성공·사용 불가 중 어떤 결과를 냈는지 나타낸다. | 검색 전체 실패 여부 |
| Search Cursor | 같은 검색을 다음 페이지부터 이어 보기 위한 내부 값이다. | 노출된 DB offset, 단순 페이지 번호 |
| Search Corpus | 어디에서 검색할지 정한 데이터 범위다. 공용 장소 또는 회원의 저장 장소가 될 수 있다. | 이름·조건을 어떻게 해석할지 |
| Search Intent | 입력을 장소·지역 이름으로 볼지, 조건 조합으로 볼지 나타낸다. | 검색할 데이터 범위 |
| Geographic Destination | 국가·도시·동네 이름으로 지도를 이동할 때 쓰는 공개 지리 참조다. | Canonical Place, 정확한 행정 경계 |
