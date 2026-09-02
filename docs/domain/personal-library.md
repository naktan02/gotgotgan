# 개인 Library

## Collection-first 권위 모델

곳곳간에서 즐겨찾기는 회원이 직접 만든 Collection이다. 한 Place가 회원 소유 Collection 하나
이상에 포함되어 있을 때만 그 회원의 즐겨찾기이며, 별도의 `saved` 또는 `wanted` boolean은 새 제품
Interface의 권위 사실이 아니다. 하나의 Place는 여러 Collection에 동시에 포함될 수 있다.

Library Module은 Collection, ordered membership, Tag, 현재 Personal Rating, 비공개 Rating 변경 이력,
import·copy provenance를 소유한다. Rating과 Tag는 Collection membership과 독립이다. 마지막
membership을 제거해도 Rating과 Tag는 남는다. Visit은 Visits Module, Note와 Entry는 Writing Module이
소유하므로 Library schema에 중복 저장하거나 Collection 제거에 연동해 삭제하지 않는다.

이 모델은 ADR 0021에서 accepted 상태다. 다만 현재 source-only v1 persistence와 HTTP/package 계약에는
`saved`, `wanted`, 정수 `position`이 남아 있다. 아직 active environment는 없으며 아래 v2 Interface와
전환은 구현 대상이다. 문서의 목표 모델을 현재 배포된 기능으로 해석하지 않는다.

## 공개 Interface와 Module 경계

흔한 사용자 흐름은 다음 Interface로 제공한다.

- `PersonalLibraryWorkspace`는 Collection 목록, 선택된 Collection의 장소, 필터·정렬·지도 scope를
  bounded page로 읽는다. Place 표시 사실은 Library가 다른 schema를 join하지 않고 조립 계층이
  주입한 공개 projection에서 받는다.
- `PlaceFiling`은 한 Place를 여러 Collection에 넣거나 빼는 최종 목표 membership 집합을 한 command로
  적용한다. 화면에 보이지 않은 Collection membership을 지우지 않으며, 변경 대상 Collection을
  결정적 순서로 잠그고 전부 성공하거나 전부 실패한다.
- `CollectionOrder`는 Place를 `first`, `last`, `before`, `after` anchor 기준으로 이동한다. database
  정수 `position`은 Interface 밖으로 노출하지 않는다.

특수 흐름은 일반 workspace Interface를 비대하게 만들지 않는다.

- `ImportedCollectionMaterializer`는 Provider 목록을 private Collection과 ordered membership으로
  멱등 반영하고 원본 provenance를 보존한다.
- `PublishedCollectionExchange`는 공개 projection과 전체·일부 복사를 소유한다.
- `PersonalRatingLedger`는 현재 Rating과 변경 이력을 소유한다.

Admin과 NAVER·Google·Kakao Provider Adapter는 Library table을 직접 조회하거나 수정하지 않는다.
각각 필요한 application Interface를 호출한다. Library도 Places, Search, Visits, Writing schema를
직접 join하지 않는다. 이 Seam은 소유권을 지키면서 Provider 수와 사용자 화면이 늘어날 때 Library
내부 변경의 파급을 제한한다.

## 동시성, 순서와 재시도

Collection 변경은 화면이 읽은 불투명한 Collection version을 예상 버전으로 보낸다. version이 다르면
아무 값도 쓰지 않고 충돌을 반환한다. 순서는 anchor placement로 요청하고, Adapter가 이를 내부
ordering representation으로 해석한다. 동일 command ID로 완료된 요청은 version 비교보다 먼저 같은
결과를 replay하므로 응답 유실 뒤 재시도해도 membership, 순서 또는 provenance를 중복 생성하지 않는다.

여러 Collection을 바꾸는 `PlaceFiling`은 한 transaction에서 처리한다. 일부 Collection만 바뀐
부분 성공은 허용하지 않는다. 한 command가 다룰 Collection 수와 workspace page 크기는 계약에서
제한하며, pagination된 chooser가 조회하지 않은 membership은 현재 상태를 유지한다.

## Personal Rating

Personal Rating은 0.1부터 5.0까지 소수 첫째 자리로 저장한다. 따라서 “4.4 이상” 같은 회원
질의를 provider rating 의미와 섞지 않고 처리할 수 있다. Rating write는 현재 값을 바꾸는 동시에
비공개 rating event를 추가하며 provider rating과 Canonical Place 사실은 변경하지 않는다.

command는 화면이 읽은 불투명한 Rating version을 예상 버전으로 포함한다. 같은 회원·Place의 write는
직렬화되며 현재 version이 다르면 아무 값도 쓰지 않고 충돌을 반환한다. 완료된 command의 동일 ID
재전송은 replay되어 중복 rating event를 만들지 않는다.

## Collection 공개와 복사

Collection은 정렬된 Canonical Place reference를 소유하며 기본 visibility는 private이다. public과
unlisted Collection에는 불투명한 publication ID가 필요하다. 공개된 Collection을 복사하면 독립된
private Collection과 출처 provenance가 생성된다. 정렬된 Place reference만 복사하며 Rating, Tag,
Visit, Writing, ownership은 복사하지 않는다.

공개 조회의 각 reference에는 별도 공개 Place projection의 summary를 결합할 수 있지만 이는 Library
소유 데이터가 아니며, projection이 늦으면 `null`이어도 reference와 순서는 유지된다.

공유 상태 변경은 읽었던 불투명한 Collection version을 예상 버전으로 사용한다. 첫 공유가 ID를 만들고
unlisted/public 전환은 같은 링크를 유지한다. private 전환은 ID를 폐기해 기존 링크를 되살릴 수 없고,
나중에 다시 공유하면 새 ID를 만든다. 복사는 공유 상태를 확인한 transaction 안에서 source를 잠그므로
공유 해제와 복사 중 먼저 시작한 operation만 명확한 순서로 완료된다.

부분 복사는 사용자가 명시적으로 선택한 Place reference의 원본 상대 순서를 유지한다. 전체·부분 복사
모두 개인 Rating, Tag, Visit, Writing과 import provenance를 복사하지 않는다.

## Provider 목록 가져오기

연결 계정에서 가져온 Provider 폴더는 회원별 private Collection을 처음 만드는 입력이다. Provider의
목록 ID·이름·순서는 `Collection Import Provenance`로 보존하고, 목록 안 장소 순서는 Collection
membership ordering으로 보존한다. 같은 Provider 연결과 목록 ID를 다시 가져오면 같은 Collection에
멱등 반영한다. 회원이 곳곳간에서 Collection 이름을 바꾼 뒤에는 Provider 쪽 이름이 바뀌어도 이를
덮어쓰지 않고 원본 이름 snapshot만 갱신한다.

각 membership의 `Collection Place Import Provenance`는 Source Connection·List·Item ID와 Provider
Place ID를 별도 열로 보존한다. 따라서 NAVER·Google·Kakao의 식별자가 섞이지 않고, 재수집과 후속
상세 관찰이 동일한 원본 항목과 Provider Place Identity를 정확히 찾을 수 있다. 같은 원본 목록의
여러 Source Item이 하나의 Canonical Place membership으로 합쳐져도 Source Item별 provenance는
각각 유지한다.

Provider 폴더는 개인 정리 방식이므로 Taxonomy Node가 아니다. 하나의 Canonical Place가 여러 원본
폴더에 있으면 Canonical Place는 하나지만 각 Collection membership과 Source Item provenance는 모두
유지한다. Provider의 저장·관심 상태는 import evidence일 뿐 곳곳간의 공통 `saved`/`wanted` 상태로
승격하지 않는다.

## 사용자 수명주기

회원의 수동 관리 화면에서 새 Collection은 private으로 생성한다. Collection 삭제는 해당 Collection의
membership과 Library 소유 provenance를 정리하지만 Canonical Place, Rating, Tag, Visit, Writing,
Provider 원본 목록은 삭제하지 않는다. Collection에서 Place 하나를 제거하거나 순서를 바꾸는 것도
같은 원칙을 따른다. Tag 삭제는 모든 회원 소유 Tag 연결을 지우지만 Place와 Collection membership은
남긴다. Provider 원본을 실제로 변경하는 outbound sync는 이 관리 수명주기와 별도다.

## v1 호환과 전환

기존 `saved`/`wanted` 기반 Place list, facet, 검색 signal, Place detail과 Web tab은 v1
Compatibility Adapter의 소비자다. 이 경계는 기존 source-only 검증을 보존하기 위한 임시 지원이며 새
기능을 추가하지 않는다. v2의 favorite 판단은 항상 Collection membership만 사용한다.

전환은 다음 순서를 지킨다.

1. Collection version, command receipt 결과, anchor ordering과 v2 read model을 additive migration과
   versioned 계약으로 추가한다.
2. 가져오기, 사용자 앱, 검색 projection, 공개 복사 순으로 새 Interface로 옮긴다.
3. `saved=true` 또는 `wanted=true`이면서 어느 Collection에도 속하지 않은 legacy orphan 수가 0인지
   cutover audit로 검증한다.
4. audit가 0일 때만 v1 write를 닫고 read Compatibility Adapter를 제거한다.
5. audit가 0이 아니면 전환을 중단하고 데이터별 reconciliation을 승인받는다. “저장됨” 또는
   “가고 싶음” 특별 Collection을 자동 생성해 사용자 카테고리처럼 보이게 하지 않는다.
