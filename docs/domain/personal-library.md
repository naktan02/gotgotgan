# 개인 Library

Library는 Collection, Tag, 저장·가고 싶음 preference, 현재 Personal Rating, 비공개 평점
변경 이력, 복사 provenance를 소유한다. 저장과 가고 싶음은 서로 독립적인 boolean이며
어느 것도 Visit을 의미하지 않는다. `visited`는 Visits 모듈에서 파생하며 Library 상태로
중복 저장하지 않는다.

Personal Rating은 0.1부터 5.0까지 소수 첫째 자리로 저장한다. 따라서 “4.4 이상” 같은 회원
질의를 provider rating 의미와 섞지 않고 처리할 수 있다. 평점 변경 시 현재 projection을
갱신하고 비공개 rating event를 추가한다. provider rating과 Canonical Place 사실은 변경하지
않는다.

Collection은 정렬된 Canonical Place reference를 소유한다. 기본 visibility는 private이다.
public과 unlisted Collection에는 불투명한 publication ID가 필요하다. 공개된 Collection을
복사하면 독립된 private Collection과 출처 provenance가 생성된다. 정렬된 Place reference만
복사하며 Rating, Tag, Visit, Writing, ownership은 복사하지 않는다.

연결 계정에서 가져온 Provider 폴더는 회원별 private Collection을 처음 만드는 입력이다. Provider의
목록 ID·이름·순서는 `Collection Import Provenance`로 보존하고, 목록 안 장소 순서는 Collection
membership 위치로 보존한다. 같은 Provider 연결과 목록 ID를 다시 가져오면 같은 Collection에
멱등 반영한다. 회원이 Place에서 Collection 이름을 바꾼 뒤에는 Provider 쪽 이름이 바뀌어도 이를
덮어쓰지 않고 원본 이름 snapshot만 갱신한다.

Provider 폴더는 개인 정리 방식이므로 Taxonomy Node가 아니다. 하나의 Canonical Place가 여러 원본
폴더에 있으면 저장 preference와 Canonical Place는 하나지만 각 Collection membership은 모두 유지한다.
