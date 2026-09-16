# 계약과 transport 문서

기계 판독 계약은 `../../packages/contracts`에 있고, 이 디렉터리는 의미와 변경 규칙을 설명한다.

- `public-http-v1.md`: browser/public HTTP 소유권과 활성화 상태.
- `connector-v1.md`: 폐기된 v1 확장 capture 실행 경로의 참고 계약.
- [`회원 로컬 커넥터`](../../apps/member-connector/README.md)와
  [`Provider transfers`](../../backend/src/modules/transfers/README.md): 현행 host-neutral v2
  snapshot 제출, 계정 연결, V3 ImportPlan 승인·저장 및 아직 연결되지 않은 Desktop transport.
- `internal-worker-v1.md`: HTTP와 Worker process 사이의 durable job 동작.
- `events-v1.md`: event 배포 규칙.
- `tool-adapter-v1.md`: 향후 AI Tool 노출 경계.
- `errors-and-versioning.md`: 호환성과 오류 envelope.

`/healthz`와 `/readyz`는 활성 lifecycle route다. Browser OIDC와 membership BFF handler, Backend의
current-consent, onboarding, current-membership, authority-role, search, suggestion, selection,
canonical-materialization transport는 source-only다. 필요한 dependency가 명시적으로 공급되기 전에는
fail-closed하거나 등록되지 않는다. Connector의 고정 capture 경로도 계약과 client Adapter만 있고 BFF
route는 아직 등록되지 않았다. 다른 제품 HTTP, Worker job, event, Tool도 각 문서가 다르게 선언하지
않는 한 연결되지 않은 상태다.
