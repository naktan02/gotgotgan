# Writing 모듈

Writing은 짧은 Note와 긴 Entry를 소유한다. Note는 정확히 하나의 Place를 연결하고 Entry는
1개에서 32개의 Place를 연결한다. visibility는 콘텐츠 속성이며 공개 조회는 별도의 허용
목록 projection을 사용한다. 모든 수정은 optimistic version을 확인하고 private revision
이력으로 보존한다.
