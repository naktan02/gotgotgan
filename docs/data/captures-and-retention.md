# Captures and retention

Raw provider captures live in a private deployment volume behind a capture-store interface. The
database stores classification, checksum, parser version, retention deadline, and opaque object
reference—not arbitrary host paths. Logs and browser payloads exclude capture content.

Retention and deletion must preserve audit requirements while removing expired personal data and
credentials. S3-compatible storage is introduced only after a second adapter or operational need.
