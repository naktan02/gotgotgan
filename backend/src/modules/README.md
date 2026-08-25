# Backend modules

Each direct child is a business-capability module. Initial owners are `access`, `places`, `taxonomy`, `library`,
`visits`, `writing`, `search`, `providers`, `ingestion`, `sync`, `sharing`, and `administration`.
Create a module directory only when its first behavior is implemented.

```text
<module>/
  README.md
  domain/          pure rules and models
  application/     use cases and consumer-owned ports
  adapters/        persistence or external implementations
  transport/       HTTP, jobs, events, or tools actually exposed
  tests/           tests through the module interface
```

Create only used leaves. Persistence adapters stay in their owning module; there is no global
repository folder. Add a port only when production and test adapters, or two real implementations,
make the seam concrete.

`ingestion` records immutable observations, candidates, and resolution decisions. `places` applies
canonical create/link/merge/split/retire commands and preserves redirects and lineage. A future
composition root translates an accepted ingestion decision into the places interface; neither module
imports the other's source and a candidate never becomes canonical merely by being recorded.

`library` owns member preferences, Collections, Tags, personal-rating history, and copy provenance.
`visits` owns immutable repeatable Visit occurrences and derived summaries. `writing` owns versioned
Notes, Entries, Place links, and publication projections. None imports another module or queries its
tables; HTTP entrypoint composition injects their public interfaces and shared authorization result.

`access` owns membership and authorization rules. `administration` owns authorized management
workflows and review surfaces; it does not own or duplicate access policy.
