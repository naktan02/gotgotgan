# Taxonomy PostgreSQL adapter

Taxonomy Node의 버전은 append-only다. 같은 `(key, version)`의 동일 재시도는 replay이고,
다른 의미로 재사용하면 conflict다. 현재 projection은 key별 최신 version 중 active node만
공개한다.
