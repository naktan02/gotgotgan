# Database runbook

No database action is authorized in Stage 1. Before Stage 3, verify the Infra PostGIS gate, create
separate migration/runtime roles through secret references, rehearse migrations and isolated restore,
and record rollback evidence. Never run DDL from the runtime process.
