# 개인 Library

Library는 Collection, Tag, 저장·가고 싶음 preference, 현재 Personal Rating, 비공개 평점
변경 이력, 복사 provenance를 소유한다. 저장과 가고 싶음은 서로 독립적인 boolean이며
어느 것도 Visit을 의미하지 않는다. `visited`는 Visits 모듈에서 파생하며 Library 상태로
중복 저장하지 않는다.

Personal Rating은 0.1부터 5.0까지 소수 첫째 자리로 저장한다. 따라서 “4.4 이상” 같은 회원
질의를 provider rating 의미와 섞지 않고 처리할 수 있다. 평점 변경 시 현재 projection을
갱신하고 비공개 rating event를 추가한다. provider rating과 Canonical Place 사실은 변경하지
않는다.

저장·가고 싶음·Personal Rating 변경은 부분 toggle이 아니라 세 값의 최종 목표 상태를 한 command로
기록한다. command는 화면이 읽었던 preference `updatedAt`을 예상 버전으로 포함한다. 같은 회원·Place의
write는 직렬화되며 현재 버전이 다르면 아무 값도 쓰지 않고 충돌을 반환한다. 적용된 command의 동일
ID 재전송은 replay되고, 성공한 write의 `updatedAt`은 이전 값보다 반드시 커진다.

Collection은 정렬된 Canonical Place reference를 소유한다. 기본 visibility는 private이다.
public과 unlisted Collection에는 불투명한 publication ID가 필요하다. 공개된 Collection을
복사하면 독립된 private Collection과 출처 provenance가 생성된다. 정렬된 Place reference만
복사하며 Rating, Tag, Visit, Writing, ownership은 복사하지 않는다.
공개 조회의 각 reference에는 별도 공개 Place projection의 summary를 결합할 수 있지만 이는 Library
소유 데이터가 아니며, projection이 늦으면 `null`이어도 reference와 순서는 유지된다.

공유 상태 변경은 읽었던 Collection `updatedAt`을 예상 버전으로 사용한다. 첫 공유가 ID를 만들고
unlisted/public 전환은 같은 링크를 유지한다. private 전환은 ID를 폐기해 기존 링크를 되살릴 수 없고,
나중에 다시 공유하면 새 ID를 만든다. 복사는 공유 상태를 확인한 transaction 안에서 source를 잠그므로
공유 해제와 복사 중 먼저 시작한 operation만 명확한 순서로 완료된다.

연결 계정에서 가져온 Provider 폴더는 회원별 private Collection을 처음 만드는 입력이다. Provider의
목록 ID·이름·순서는 `Collection Import Provenance`로 보존하고, 목록 안 장소 순서는 Collection
membership 위치로 보존한다. 같은 Provider 연결과 목록 ID를 다시 가져오면 같은 Collection에
멱등 반영한다. 회원이 Place에서 Collection 이름을 바꾼 뒤에는 Provider 쪽 이름이 바뀌어도 이를
덮어쓰지 않고 원본 이름 snapshot만 갱신한다.

각 membership의 `Collection Place Import Provenance`는 Source Connection·List·Item ID와 Provider
Place ID를 별도 열로 보존한다. 따라서 NAVER·Google·Kakao의 식별자가 섞이지 않고, 재수집과 후속
상세 관찰이 동일한 원본 항목과 Provider Place Identity를 정확히 찾을 수 있다. 같은 원본 목록의
여러 Source Item이 하나의 Canonical Place membership으로 합쳐져도 Source Item별 provenance는
각각 유지한다.

Provider 폴더는 개인 정리 방식이므로 Taxonomy Node가 아니다. 하나의 Canonical Place가 여러 원본
폴더에 있으면 저장 preference와 Canonical Place는 하나지만 각 Collection membership은 모두 유지한다.

회원의 수동 관리 화면에서 새 Collection은 private으로 생성한다. Collection 삭제는 해당 Collection의
membership과 Library 소유 provenance를 정리하지만 Canonical Place, 저장 preference, Provider 원본
목록은 삭제하지 않는다. Collection에서 Place 하나를 제거하거나 순서를 바꾸는 것도 같은 원칙을
따른다. Tag 삭제는 모든 회원 소유 Tag 연결을 지우지만 Place는 남긴다. Provider 원본을 실제로
변경하는 outbound sync는 이 관리 수명주기와 별도다.
