# Architecture overview

Place begins as a modular monolith in one independent repository. `apps/web` is the browser product;
`backend` is one TypeScript package with separately runnable HTTP and acquisition-worker entrypoints;
`packages/contracts` is the publication boundary. PostgreSQL/PostGIS migrations, least-privilege
adapters, and disposable integration evidence exist, but no application environment is active.

Search is a module-owned read side. Canonical Place, Taxonomy, Library, and Visits publish only the
minimum versioned projection facts through Search application interfaces; Search never reads their
tables directly. This allows the projection storage or process to split later without reversing
domain dependencies.

Folders do not imply microservices. Split a process or repository only after data ownership,
deployment, scaling, failure, or credential lifecycle proves a distinct operational owner.
