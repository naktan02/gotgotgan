# Browser process readiness

This folder owns the process-level readiness projection for the Web runtime. It checks only
integrations explicitly activated by deployment configuration, aggregates the narrow auth and
membership readiness interfaces, and returns a sanitized result. It does not own either lifecycle,
business authorization, or health/liveness.
