# Process entrypoints

Entrypoints compose module interfaces with adapters and own start, readiness, drain, and close. They
contain no business decisions. `http` and `worker` are separately deployable processes from the same
compiled backend package. `cli` owns explicit operator process exit/output behavior; its database
preparation entrypoint invokes the platform lifecycle module and is never an application startup hook.
