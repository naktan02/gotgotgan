# Process entrypoints

Entrypoints compose module interfaces with adapters and own start, readiness, drain, and close. They
contain no business decisions. `http` and `worker` are separately deployable processes from the same
compiled backend package.
