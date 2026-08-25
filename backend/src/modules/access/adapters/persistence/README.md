# Access persistence adapters

This directory implements access-owned application ports without exporting SQL or database rows into
the domain. PostgreSQL receives a caller-owned pool; process composition remains responsible for pool
creation, readiness, drain, and close.

Membership, bootstrap, role-change, and audit behavior stay behind the access module interface. No
other module imports this directory directly.
