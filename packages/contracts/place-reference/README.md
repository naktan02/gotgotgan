# Place Reference 계약

`place-reference.v1.schema.json`은 최초의 cross-service Place reference envelope이다.
`available`은 redirect까지 해석한 불투명한 Canonical Place ID를 포함한다. `unavailable`은
존재하지 않거나 retired 상태인 identity를 나타내며, `redacted`는 private reference의 존재
여부 자체를 의도적으로 숨긴다. consumer는 Place table을 직접 조회하거나 ID만 보고 권한을
추론하지 않고 두 상태를 모두 처리해야 한다.
