# Note와 Entry

Note와 Entry는 각각 짧은 글과 긴 글이다. Note는 정확히 하나의 Canonical Place를 연결하고,
Entry는 서로 다른 1개에서 32개의 Canonical Place를 연결한다. private, unlisted, public은
별도 콘텐츠 종류가 아니라 authorization이 관리하는 visibility 속성이다. 공유 visibility에는
불투명한 publication ID가 필요하다.

수정할 때는 expected version을 확인하고 비공개 revision 이력을 추가한다. 익명 조회는 owner
identity와 revision을 제외한 별도의 허용 목록 projection을 실행한다. 향후 Diary나 Task
서비스는 Writing table을 공유하지 않고 `place-reference.v1`로 Place를 연결한다.

Personal Library의 첫 Web writer는 선택한 Place의 private Note만 만든다. 브라우저는 visibility나
publication ID를 정하지 않고, server Adapter가 private을 고정한다. 응답 유실은 동일 command ID와
payload로 재시도하고 version conflict에서는 초안을 자동 덮어쓰지 않는다. multi-Place Entry와 공유
visibility 편집은 이 작은 Interface에 섞지 않는다. 현재 Note의 사용자 입력은 본문뿐이며 제목과 사진
첨부는 없다. 서버가 최초 `createdAt`을 고정하고 저장 때마다 `updatedAt`, version, 불변 revision을
갱신한다. 블로그형 Entry 작성과 미디어 저장은 별도의 제품 흐름이 확정될 때까지 도입하지 않는다.
