# Deployment declarations

`compose.yml` keeps all Place processes under one product-owned Compose project without activating a
platform deployment:

- `web`: standalone Next.js runtime;
- `backend`: always-on Fastify HTTP runtime; and
- `worker-check`: opt-in verification profile for the separately runnable worker artifact.

All host and port values are required environment inputs. There is no database, provider, Identity,
Gateway, map, or AI connection. Later declarations reference secrets and addresses by
deployment-owned names, publish no browser credentials, and follow workspace onboarding gates before
Gateway exposure.

`identity/oidc-client.json` is the Place-owned, unprovisioned Identity input. The provisioner must
expand `PLACE_PUBLIC_ORIGIN`, deliver the generated client ID/secret through the approved secret
sink, and run only after callback routes, shared session storage, Gateway routing, health validation,
and rollback are ready. The manifest itself contains no credential and does not activate Identity.

The image base is digest-pinned to the Node 22 image already proved by Game Studio. With Docker
running, validate targets from the repository root:

```powershell
docker build --target web-runtime --tag place-web-stage2 .
docker build --target backend-runtime --tag place-backend-stage2 .
```
