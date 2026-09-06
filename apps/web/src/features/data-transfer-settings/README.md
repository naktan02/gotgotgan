# 계정·데이터 설정

설정은 자체 스크롤 영역과 상단에 고정되는 계정·연결된 계정·데이터 이동·공개 프로필을 사용한다.
가져오기·내보내기·작업 내역은 데이터 이동 안에서 선택하며 기존 `?tab=import/export/history`와
`/imports` 진입은 유지한다. 계정·공개 프로필 탭의 안내와
이동 링크는 전송 capability 장애에 종속되지 않는다. 실제 프로필 읽기/쓰기는 해당 화면의 기존
인증 경계를 다시 통과하고, 연결·가져오기·내보내기와 승인은 기존 capability gate를 그대로 따른다.
비활성 계정 연결은 기록과 가용성만 표시한다. 일회성 링크 가져오기를 소유 확인된 계정 연결처럼
표시하지 않으며 연결 기록만으로 자동 동기화가 켜졌다고 안내하지 않는다.
로그인/로그아웃은 공통 상단이 소유하며 이 화면에서 POST 전용 로그아웃 URL을 GET 링크로 열지 않는다.

`/settings`는 기존 Workspace Shell 안에서 이 feature의 public entry만 조합한다. 화면은
`DataTransferSettingsGateway`가 제공하는 capability를 그대로 표현하며, 특정 Provider가 실제로
지원된다고 추측하지 않는다.

- `data-transfer-settings-model.ts`: 화면과 전송 기능 사이의 안정된 계약
- `data-transfer-settings-client.ts`: browser BFF와 계약 schema를 view model로 변환
- `data-transfer-settings-workflow.ts`: Provider별 연결 상태, snapshot/import plan, outbound preview의
  revision·idempotency·stale request 처리
- `DataTransferSettings.tsx`: 설정 그룹과 데이터 이동 하위 작업 조합; 상태·deep link 검사는 같은 이름의 test
- `import-review/`: 가져오기 매핑·검토와 독립적인 상세 보강 상태 안내
- `data-transfer-settings-view-parts.tsx`: 가져오기·내보내기가 공유하는 feature-local 화면 부품
- `data-transfer-settings.module.css`: 기존 세대 CSS를 덮어쓰지 않는 feature-local 스타일

가져오기 plan은 `import-plan.v3`만 소비해 자동 생성 예정 Place와 이미 연결된 Place를 같은 preview에서
안전하게 구분한다. 기존 v2 BFF 경로는 호환성 경계에 남지만 설정 workflow는 v3 경로만 사용한다.
Provider 상세 작업의 `pending`/`available`/`unavailable`은 plan revision·승인과 독립된 운영 상태다.
유효한 최소 snapshot 근거가 있으면 상세가 없어도 승인할 수 있다. Web은 상세를 기다리는 polling이나
`refresh-evidence` 명령을 실행하지 않고 Backend가 판정한 approval eligibility만 따른다. 상세 보강은
현재 보류 중임을 명시하며, 항목 상태·집계는 화면용 100개 제한 전에 전체 plan에서 계산한다.
V3 변경은 아직 배포·출시되지 않은 source-only 계약의 흐름 정정이다. 기존 V2 계약과 서버의 이전
draft 호환 명령은 유지한다. 응답 유실 시 동일 명령으로 재시도하는 기존 승인·결정 규칙도 보존한다.
가져오기는 저장된 source snapshot을 읽을 뿐 Provider 수집을 시작하지 않는다. 내보내기의
`approved`는 사용자가 preview 범위를 승인했다는 뜻이며 외부 Provider 적용 완료가 아니다.
작업 실행/복구 내역은 Stage 10 화면이 소유한다.
