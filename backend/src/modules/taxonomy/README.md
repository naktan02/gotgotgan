# Taxonomy 모듈

Taxonomy는 provider-neutral 분류 Node의 append-only version과 현재 active projection을
소유한다.

```text
domain/       Node key, parent, label, kind, version 불변식
application/  version publish와 현재 projection 조회
adapters/     `taxonomy.node_versions` PostgreSQL 구현
transport/    공개 read-only `/v1/taxonomy/nodes`
tests/        publish/replay/conflict와 current projection 행동
```

식당, 카페, 여행지는 고정 enum이 아니다. 운영 데이터가 category/attribute Node와 parent
관계를 정의한다. 같은 `(key, version)`의 같은 내용은 replay이고 다른 내용은 conflict다.
