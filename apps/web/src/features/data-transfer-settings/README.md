# Data transfer settings

`/settings`는 기존 Workspace Shell 안에서 이 feature의 public entry만 조합한다. 화면은
`DataTransferSettingsGateway`가 제공하는 capability를 그대로 표현하며, 특정 Provider가 실제로
지원된다고 추측하지 않는다.

- `data-transfer-settings-model.ts`: 화면과 전송 기능 사이의 안정된 계약
- `data-transfer-settings-client.ts`: browser BFF와 계약 schema를 view model로 변환
- `data-transfer-settings-workflow.ts`: Provider별 연결 상태, snapshot/import plan, outbound preview의
  revision·idempotency·stale request 처리
- `DataTransferSettings.tsx`: 여섯 설정 탭 조합
- `import-review/`: 가져오기 검토 UI와 Provider 상세 상태 동기화
- `data-transfer-settings-view-parts.tsx`: 가져오기·내보내기가 공유하는 feature-local 화면 부품
- `data-transfer-settings.module.css`: 기존 세대 CSS를 덮어쓰지 않는 feature-local 스타일

가져오기 plan은 `import-plan.v3`만 소비해 자동 생성 예정 Place와 이미 연결된 Place를 같은 preview에서
안전하게 구분한다. 기존 v2 BFF 경로는 호환성 경계에 남지만 설정 workflow는 v3 경로만 사용한다.
Provider 상세 작업의 `pending`/`available`/`unavailable`은 plan revision과 독립된 운영 상태다.
Web은 draft의 pending 항목이 있을 때 기존 no-store GET을 겹치지 않게 반복하고, `available`을 관찰한
경우에만 같은 revision과 안정된 command ID로 `refresh-evidence`를 한 번 실행한다. 이 명령이 검증된
evidence를 plan에 고정한 뒤에만 revision과 미리보기가 바뀐다. 화면용 100개 항목 제한이 동기화를
중단시키지 않도록 진행 수는 전체 plan item에서 계산한다. 늦은 응답은 읽기 시작 revision이 아직
화면의 최신 revision일 때만 반영하며, 남은 `pending`/`available`이 없으면 폴러와 wake listener를
함께 종료한다.
가져오기는 저장된 source snapshot을 읽을 뿐 Provider 수집을 시작하지 않는다. 내보내기의
`approved`는 사용자가 preview 범위를 승인했다는 뜻이며 외부 Provider 적용 완료가 아니다.
작업 실행/복구 내역은 Stage 10 화면이 소유한다.
