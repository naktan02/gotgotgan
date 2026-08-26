# Captures and retention

Raw provider captures live in a private deployment volume behind a capture-store interface. The
database stores classification, checksum, parser version, retention deadline, and opaque object
reference—not arbitrary host paths. Logs and browser payloads exclude capture content.

Retention and deletion must preserve audit requirements while removing expired personal data and
credentials. S3-compatible storage is introduced only after a second adapter or operational need.

현재 파일 adapter는 승인된 JSON 캡처를 AES-256-GCM으로 암호화한다. keyring은 배포가 보호 파일로
주입하며 DB나 브라우저로 전달하지 않는다. reference는 `capture:<uuid>`이고 호스트 경로가 아니다.
읽기와 삭제에는 batch와 Provider 경계가 모두 일치해야 하며 보존 기한 전 삭제와 기한 후 replay를
거부한다.

`--sweep-expired-captures`는 `deleted_at IS NULL`인 만료 메타데이터를 최대 1,000개까지 읽고 artifact를
물리 삭제한 뒤 삭제 시각을 표시한다. 이미 없는 파일도 성공적인 멱등 정리로 표시하며, 항목별 실패는
다른 항목을 막지 않지만 명령 전체는 non-zero로 종료되어 운영자가 다시 실행할 수 있다. DB는 감사용
checksum·parser version·보존기한과 삭제 시각을 남기고 캡처 본문은 보존하지 않는다.

브라우저 Connector 수신은 파일과 DB 사이의 부분 실패를 숨기지 않는다. Backend는 sequence별
`pending` receipt와 `import_capture_artifacts` 메타데이터를 먼저 같은 DB transaction에 기록한 뒤
결정적인 `capture:<uuid>` 위치에 암호화 파일을 쓴다. 성공하면 ImportItem·Fulfillment intent·누적
item/byte·`committed` receipt를 한 transaction으로 확정한다. 파일 쓰기나 프로세스가 중단되면 같은
operation·sequence·checksum 재전송이 기존 예약을 이어 쓰며 새 artifact나 Item을 중복 생성하지 않는다.
