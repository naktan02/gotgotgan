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

빈 설치의 제품 분류를 준비할 때는 [product catalog](adapters/product-catalog/README.md)와
owner 전용 [seed 진입점](../../entrypoints/cli/seed-product-taxonomy.ts)을 읽는다. HTTP 시작 시
자동 삽입하지 않는다. 실제 기존 분류와 의미가 충돌하면 버전을 덮어쓰지 않고 중단한다.
