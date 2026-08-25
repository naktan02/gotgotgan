# Contract tests

Contract checks parse every machine-readable artifact, assert version identity and delivery state,
and later compare generated clients/servers against published fixtures. Breaking compatibility needs
a new major version and migration evidence.

Deployment tests exercise the producer release CLI through its command boundary. They fix the exact
two-image/four-role `release-source.v1` declaration, validate one attested `linux/amd64` subject per
image, require independent SBOM/provenance artifact locations, and prove one release record binds
both platform digests to the same source commit. Workflow contract tests keep publication manual,
same-commit-CI-gated, attested, digest-smoked, and free of promotion or cluster authority.
