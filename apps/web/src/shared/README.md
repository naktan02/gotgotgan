# Frontend shared

Only proved business-neutral primitives shared by multiple features live here.

`async/poll-controller.ts` owns overlap prevention, cancellation, pause/resume, and bounded transient
failure backoff for both operation history and provider-detail progress. Callers inject active and
terminal-state policy; this shared module does not know transfer contracts or product errors.
