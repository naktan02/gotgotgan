# Data transfer settings

`/settings`는 기존 Workspace Shell 안에서 이 feature의 public entry만 조합한다. 화면은
`DataTransferSettingsGateway`가 제공하는 capability를 그대로 표현하며, 특정 Provider가 실제로
지원된다고 추측하지 않는다.

- `data-transfer-settings-model.ts`: 화면과 전송 기능 사이의 안정된 계약
- `data-transfer-settings-client.ts`: browser BFF와 계약 schema를 view model로 변환
- `data-transfer-settings-workflow.ts`: Provider별 연결 상태, snapshot/import plan, outbound preview의
  revision·idempotency·stale request 처리
- `DataTransferSettings.tsx`: 여섯 설정 탭과 명시적 preview/approval UI
- `data-transfer-settings.module.css`: 기존 세대 CSS를 덮어쓰지 않는 feature-local 스타일

가져오기는 저장된 source snapshot을 읽을 뿐 Provider 수집을 시작하지 않는다. 내보내기의
`approved`는 사용자가 preview 범위를 승인했다는 뜻이며 외부 Provider 적용 완료가 아니다.
작업 실행/복구 내역은 Stage 10 화면이 소유한다.
