# Ingestion module

Ingestion owns provider-neutral source observations, normalized Place candidates, and resolution
decisions. Its public interface records immutable facts with a caller-supplied stable identity and
returns `recorded` or `replayed`; reuse of that identity for different content is a conflict.

Candidate decisions cover review, not-the-same, create, and link. Canonical-conflict decisions cover
merge, split, and retirement without inventing a candidate. All retain evidence and actor/policy
references.

This module does not mutate a Canonical Place. A future orchestrator may translate an accepted
resolution decision into the `places` module interface at a composition root. Provider-specific
payloads, Crawlee requests, Playwright pages, selectors, cookies, and browser profiles never cross
this module interface.

```text
domain/model
  <- application recording use cases and IngestionStore port
  <- PostgreSQL persistence adapter
  <- future worker/HTTP composition
```

The PostgreSQL adapter inserts into append-only `ingestion` tables. The runtime role has no update or
delete authority over evidence, candidates, or decisions.
