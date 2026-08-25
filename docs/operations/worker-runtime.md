# Worker runtime

The worker is compiled from `@place/backend` but starts independently from HTTP. Stage 1 supports
only `--check` and refuses normal startup because no durable job handlers exist. Later deployment may
keep it running, schedule it, or start it on demand without changing domain modules.
