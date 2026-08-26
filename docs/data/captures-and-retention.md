# Captures and retention

Raw provider captures live in a private deployment volume behind a capture-store interface. The
database stores classification, checksum, parser version, retention deadline, and opaque object
reference—not arbitrary host paths. Logs and browser payloads exclude capture content.

Retention and deletion must preserve audit requirements while removing expired personal data and
credentials. S3-compatible storage is introduced only after a second adapter or operational need.

현재 파일 adapter는 승인된 JSON 캡처를 AES-256-GCM으로 암호화한다. keyring은 배포가 주입하며
DB나 브라우저로 전달하지 않는다. reference는 `capture:<uuid>`이고 호스트 경로가 아니다. 읽기에는
batch와 Provider 경계가 모두 일치해야 하며 보존 기한이 지난 artifact는 replay하지 않는다. DB
정리와 artifact 물리 삭제를 함께 수행하는 sweep은 live Worker 활성 전에 추가한다.
