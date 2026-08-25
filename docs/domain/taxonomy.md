# Taxonomy

Taxonomy is hierarchical, versioned, and provider-neutral. Restaurant, cafe, and travel destination
are examples rather than top-level hard-coded truth. Provider categories map to canonical nodes and
attributes through reviewable rules with aliases and effective versions.

Stage 5부터 Node는 data-defined `key`, optional `parentKey`, 사용자 label, `category` 또는
`attribute` kind, 증가하는 version으로 표현한다. 같은 key의 최신 active version만 공개
projection에 나타난다. 과거 version을 고쳐 쓰지 않으며 Provider 원문 category는 이후
mapping evidence로 연결한다.
