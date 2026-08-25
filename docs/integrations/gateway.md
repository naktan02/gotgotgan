# Gateway

Gateway owns public ingress and reviewed route publication. Place receives no Gateway route until its
artifact, deployment, Identity configuration, health, authorization denials, and rollback evidence
pass workspace onboarding. Gateway never fabricates trusted actor or role headers for Place.

`deploy/application-runtime.json` declares Web as the sole future public upstream and `/healthz` plus
`/readyz` as its probes. Backend and Worker are internal and are not candidate Gateway upstreams.
This declaration supplies onboarding evidence but does not activate a route.
