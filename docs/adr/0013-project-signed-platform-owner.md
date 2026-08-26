# ADR 0013: 서명된 Platform Owner를 Place Owner로 투영한다

- Status: Accepted
- Date: 2026-08-27

Identity가 정확히 한 명의 `platform_owner`와 audience 전용 단기 서명 assertion을 소유하고, Place는
이를 검증해 자기 Membership의 유일한 `owner`로 원자적으로 투영한다. ZITADEL/IAM 관리자를 그대로
신뢰하거나 Identity DB를 조회하는 안, 각 제품에 Owner를 수동 등록하는 안은 각각 권한 혼동·강결합·
운영 반복을 만들기 때문에 제외했다.

Place는 `owner_revision`이 증가할 때 이전 Owner를 보존된 로컬 역할로 복귀시키고 새 Owner를 승격하며
감사 기록을 남긴다. 브라우저 값은 권한 증거가 아니고, `platform_admin`·`platform_operator`도 Place의
`administrator`·`reviewer`를 자동 부여하지 않는다. Membership, 동의, 정지, 리소스 권한과 최종 접근
판정은 계속 Place가 소유한다. 중앙 검증이 불확실하면 활성화된 연동 경로는 실패 폐쇄한다.

ADR 0003과 ADR 0007의 Place 소유 권한 원칙은 유지하되, 수동 초기 Owner와 자가 가입은 중앙
`platform_owner` 투영에 한해 이 결정으로 대체한다.
