# Note와 Entry

Note와 Entry는 각각 짧은 글과 긴 글이다. Note는 정확히 하나의 Canonical Place를 연결하고,
Entry는 서로 다른 1개에서 32개의 Canonical Place를 연결한다. private, unlisted, public은
별도 콘텐츠 종류가 아니라 authorization이 관리하는 visibility 속성이다. 공유 visibility에는
불투명한 publication ID가 필요하다.

수정할 때는 expected version을 확인하고 비공개 revision 이력을 추가한다. 익명 조회는 owner
identity와 revision을 제외한 별도의 허용 목록 projection을 실행한다. 향후 Diary나 Task
서비스는 Writing table을 공유하지 않고 `place-reference.v1`로 Place를 연결한다.
