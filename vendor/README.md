# Vendored runtime clients

`traceforge-runner-sdk-0.1.0.tgz` is the immutable `@traceforge/runner-sdk` package produced from the
TraceForge Runner Kit release at version `0.1.0`. Place installs this artifact through an exact local
file dependency so its build never imports a sibling TraceForge checkout or requires TraceForge
Studio.

An upgrade must replace the archive with a newly versioned package, update the exact dependency and
lockfile integrity, run the Place architecture and Backend checks, and repeat the opt-in live
Provider Detail smoke against the matching Runner and Provider Pack. Do not replace the archive in
place while keeping the same version.
