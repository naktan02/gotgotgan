# Incident and rollback

Contain incidents at the smallest owner: route, HTTP process, worker, provider capability, parser
version, or database migration. Preserve safe correlation and attempt evidence without credentials or
personal payloads. Rollback restores a compatible contract and data state; disabling an integration
must leave private library reads and exports recoverable where possible.

Place application rollback is one Web-plus-Backend unit selected by exact digest and source revision.
`npm run plan:deployment` refuses mutable images and, for rollback, requires both the currently
deployed unit and target unit. Database state is preserved and migrations are not reversed by an
application rollback. A target image must remain compatible with the current database contract.
Actual replacement, readiness observation, traffic transition, and failed-target containment remain
deployment-owner actions and require environment evidence before activation.

Application publication is a separate producer lifecycle. `release-application.yml` may be rerun
for the same source commit after a post-push failure. It queries both GHCR package tags independently:
no existing tags builds both images; one existing tag verifies its source/revision and builds the
missing image; two existing tags rebuild only the evidence and release record. It never overwrites a
commit tag. Unknown registry state, an existing image that does not identify the exact Place source
commit, missing/malformed attestation, failed digest smoke, or incomplete evidence stops the run.
Operators must retain the failed run and registry state for diagnosis; the workflow does not delete
or replace published artifacts and does not deploy them.
