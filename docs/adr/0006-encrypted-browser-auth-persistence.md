# 0006: Encrypted PostgreSQL persistence for browser OIDC state

Status: accepted

Date: 2026-08-25

## Context

The confidential Web BFF cannot keep authorization transactions or token sessions in process memory:
restarts would lose them and horizontally scaled Web instances would fork the login state. Persisting
raw state, nonce, PKCE verifiers, access tokens, or refresh tokens would unnecessarily expose bearer
material to database snapshots and operators.

## Decision

The Place database owns a `browser_auth` schema with separate one-time OIDC transaction and browser
session tables. The Web adapter encrypts and authenticates each complete payload with AES-256-GCM
before insertion. Additional authenticated data binds the payload version, record kind, opaque ID,
expiry, and encryption-key ID. The active key and retained decryption keys are process configuration
and never enter the database, source, browser, or logs.

Transactions are consumed with one atomic `DELETE ... RETURNING`, so two Web instances cannot use the
same callback transaction. Sessions are immutable create/read/delete records; the BFF rejects and
deletes an expired session before returning tokens to a server-side caller. The runtime role may only
select, insert, and delete these records. A Web process composition owns its bounded `pg.Pool`, checks
readiness before returning the BFF interface, and exposes one explicit asynchronous close operation.

This decision does not activate a Next.js route, Identity client, Gateway route, or application
database deployment. Those remain separately gated. A bounded expired-record cleanup operation and
secret-file configuration must exist before activation.

## Consequences

- Horizontal Web instances can share login and logout state without browser-visible tokens.
- Key rotation keeps the old key in the decryption set until every record using it has expired or
  been removed. Losing all applicable keys intentionally invalidates the affected login state.
- Database backup and restore do not include encryption keys; recovery must restore the matching
  protected key material through the deployment secret system.
- The browser-auth schema remains Web platform persistence, not Identity-owned data or a global
  repository.

## Evidence

- `backend/migrations/000003_create_browser_auth_persistence.ts`
- `apps/web/src/platform/auth/postgres-oidc-store.ts`
- `apps/web/src/platform/auth/oidc-process-runtime.ts`
- `backend/tests/integration/database-migrations.test.mjs`

## Supersession condition

Supersede this ADR only when another shared session runtime proves equivalent one-time consumption,
encryption, key rotation, multi-instance behavior, least privilege, backup/restore, and lifecycle
ownership without moving Place authorization or tokens into Identity, Gateway, or a browser.
