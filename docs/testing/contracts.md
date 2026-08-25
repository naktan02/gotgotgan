# Contract tests

Contract checks parse every machine-readable artifact, assert version identity and delivery state,
and later compare generated clients/servers against published fixtures. Breaking compatibility needs
a new major version and migration evidence.

HTTP와 PlaceReference 계약의 원본은 `packages/contracts/src`의 Zod schema이다. OpenAPI와 JSON
Schema는 `npm run generate:contracts`로 생성하며 사람이 별도 원본처럼 수정하지 않는다.
`npm run check:contracts`는 생성 결과를 임시 경로에서 다시 만들고 저장소 산출물과 byte 단위로
비교하므로, 원본만 바꾸고 생성물을 갱신하지 않거나 생성물만 고친 변경을 거부한다. Backend
transport와 Web BFF client도 같은 package export를 사용해 enum과 validation을 반복 정의하지 않는다.

Deployment tests exercise the producer release CLI through its command boundary. They fix the exact
two-image/four-role `release-source.v1` declaration, validate one attested `linux/amd64` subject per
image, require independent SBOM/provenance artifact locations, and prove one release record binds
both platform digests to the same source commit. Workflow contract tests keep publication manual,
same-commit-CI-gated, attested, digest-smoked, and free of promotion or cluster authority.
