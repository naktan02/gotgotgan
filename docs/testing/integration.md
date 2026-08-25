# Integration tests

Stage 3 introduces real PostGIS tests for migrations, roles, spatial indexes, isolation, backup, and
restore. Later process tests prove job lease/fencing behavior and sanitized provider replay. Unit
fakes do not substitute for protocol or database semantics at these seams.
