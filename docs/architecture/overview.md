# Architecture overview

Place begins as a modular monolith in one independent repository. `apps/web` is the browser product;
`backend` is one TypeScript package with separately runnable HTTP and acquisition-worker entrypoints;
`packages/contracts` is the publication boundary. PostgreSQL/PostGIS is planned but inactive.

Folders do not imply microservices. Split a process or repository only after data ownership,
deployment, scaling, failure, or credential lifecycle proves a distinct operational owner.
