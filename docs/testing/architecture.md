# Architecture tests

Repository scripts enforce frontend layer direction, reject global dumping grounds, prevent backend
modules from importing process entrypoints, and keep domain code independent from implementations.
Expand the executable rule when a new layer or publication path is introduced.

The architecture validation tests the guard itself with invalid dependency fixtures before checking
the repository. Backend rules reject horizontal controller/service/repository buckets, inward-layer
violations, module-to-module source imports, entrypoint imports of module internals, platform-to-domain
dependencies, and relative import cycles. Cross-module behavior is composed through consumer-owned
ports at entrypoints.
