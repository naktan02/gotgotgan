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

Application publication is a separate producer lifecycle. Retry the [manual host publisher](../../ci/README.md)
with the same verified collection and policy after a partial publication. Preserve its depot and receipt;
do not rebuild images to replace a failed publication. The publisher verifies existing immutable
destinations before reusing them. Unknown registry state, a mismatched digest, missing or malformed
attestation, failed digest smoke, or incomplete evidence stops acceptance. Retain the failed run and
registry state for diagnosis. Publication does not deploy images or change the database.
