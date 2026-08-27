# Writing 모듈

Writing은 짧은 Note와 긴 Entry를 소유한다. Note는 정확히 하나의 Place를 연결하고 Entry는
1개에서 32개의 Place를 연결한다. visibility는 콘텐츠 속성이며 공개 조회는 별도의 허용
목록 projection을 사용한다. 모든 수정은 optimistic version을 확인하고 private revision
이력으로 보존한다.

Command/publication Store와 회원 조회용 `WritingQueries`는 분리한다. 목록은 kind filter와
`(updated_at DESC, id)` keyset cursor로 최대 50개만 반환하고 본문은 280자 preview와 truncation
표시만 제공한다. 전체 본문·생성 시각·현재 version·정렬된 Place link는 owner-scoped 단건 상세에서
반환한다. HTTP transport는 lifecycle이나 optimistic conflict 규칙을 재구현하지 않는다.
