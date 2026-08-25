# Backup and restore

Infra owns physical backup mechanics; Place owns database-level restore metadata and verification.
Before live data, tests must restore only the Place database into an isolated environment, verify
PostGIS and indexes, and prove that credentials and other product data are absent.
