# Backend platform

This directory is for proved business-neutral runtime capabilities shared by multiple modules, such
as configuration parsing, database lifecycle, telemetry, and credential-reference resolution. It is
not a home for domain services or provider-specific code.

`database/prepare-database.ts` is the deep deployment lifecycle module for the Place database. It
validates the repository-owned runtime contract, reads credentials only from referenced secret files,
provisions distinct roles/PostGIS through the administrator authority, and runs migrations through
the migration authority. It does not expose a repository abstraction and business modules do not
import it.
