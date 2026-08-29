# Published content

공개 Collection/Writing page의 표현만 소유한다. 읽기 projection은 `platform/publications`, 인증된
Collection copy는 `platform/library`의 좁은 Adapter를 사용하며 Backend origin·token·membership을
알지 못한다. `PublishedCollectionActions`는 한 copy attempt를 재사용해 결과 유실 재시도에서 같은
command와 private target ID를 보존한다. 원본 공동 편집, 개인 metadata, 공개 discovery는 이 feature의
책임이 아니다.
