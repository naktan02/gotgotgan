# Integration documentation

- `identity.md`: common login and Place-local authorization.
- `gateway.md`: public ingress gate.
- `family-navigation.md`: injected family manifest.
- `providers.md`: NAVER, Google, Kakao and future provider adapters.
- `provider-search-research.md`: Stage 6 official API evidence and adapter decisions.
- `place-catalog-strategy-research.md`: base-catalog, federated-search, and on-demand materialization evidence.
- `saved-place-web-import-feasibility.md`: NAVER·Google·Kakao의 설치 없는 공유 링크, 공식 export,
  권한 위임과 원격 browser beta 가능성.
- `maps.md`: renderer ownership and search separation.
- `ai-orchestrator.md`: future Tool contract.

All external integrations remain inactive while Stage 2 is in progress. Saved-place shared-link and
remote-browser imports are designed but not production-active; each document distinguishes fixture or
server-probe evidence from live account integration. Stage 6 official search
adapters and Stage 6.5 interactive discovery composition are implemented and fixture-tested source
only; no provider credential, live account, browser profile, or public traffic is active until the
owning onboarding gates pass.
