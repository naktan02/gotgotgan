# Providers

Each provider declares capabilities independently: official search, export/import, structured HTTP,
browser-assisted import, detail enrichment, or outbound save. A provider may support only a subset.

Use the least stateful method that satisfies the operation: official API/export, direct HTTP,
structured network observation, Crawlee queue, then Playwright browser interaction. Provider-specific
selectors, payloads, and session behavior remain inside `providers/adapters/<provider>`.
