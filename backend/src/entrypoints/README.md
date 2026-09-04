# Process entrypoints

Entrypoints compose module interfaces with adapters and own start, readiness, drain, and close. They
contain no business decisions. `http` and `worker` are separately deployable processes from the same
compiled backend package. `cli` owns explicit operator process exit/output behavior; its database
preparation entrypoint invokes the platform lifecycle module and is never an application startup hook.

The HTTP entrypoint requires an explicit `source-only` or `production` mode. Source-only mode exposes
only lifecycle routes. Production mode delegates protected configuration, bounded PostgreSQL/OIDC
composition, readiness, and idempotent close to `production-runtime.ts`; it does not choose policy or
credentials itself.

Worker의 Provider Detail entrypoint는 `--process-provider-place-details` bounded one-shot과
`--run-provider-place-details` continuous mode를 제공한다. 두 모드는 절대 Runner·Pack·private profile
root 경로와 Pack version, 두 artifact의 SHA-256이 모두 검증된 경우에만 시작하며, TraceForge Studio
backend나 회원 browser session을 요구하지 않는다. CAPTCHA·영수증 인증을 포함한 challenge는
우회하지 않고 fail closed한다.

Transfers import materialization은 legacy ingestion worker와 다른
`transfer-materialization-main.ts` entrypoint를 사용한다. 컴파일된 프로세스는 기본 continuous,
`--once`는 bounded one-shot이며 승인된 `transfers.operations`만 lease한다. 이 분리는 legacy
import fulfillment가 승인 전 Library mutation 경로로 다시 연결되는 것을 막는다.
