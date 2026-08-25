# User journeys

Critical journeys are: authenticate; search and inspect evidence; save and classify; record visits
and ratings; write private or public notes/entries; connect a provider; preview and review an import;
reconcile duplicates; publish a selected view; and later invoke scoped AI Tools.

Every asynchronous journey exposes queued, running, needs-user-action, partial, failed, cancelled,
and completed states where applicable. A retry uses an idempotency identity and preserves evidence.
