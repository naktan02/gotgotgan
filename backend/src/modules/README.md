# Backend modules

Each direct child is a business-capability module. Initial owners are `places`, `taxonomy`, `library`,
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
