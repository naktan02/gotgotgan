# Place web design contract

Read the workspace design brief at `../../../plans/place-platform-ui-design-brief.md` before changing
user-visible behavior. The direction is **Calm Utility Map**: restrained surfaces, clear hierarchy,
map/workspace balance, one icon system, and density that serves repeated use.

## Ownership

```text
app      -> shells, features, domains, platform, shared
shells   -> features, domains, platform, shared
features -> domains, platform, shared
domains  -> platform, shared
platform -> shared
shared   -> no upper layer
```

Platform siblings also require an explicit direction. Membership may consume auth session
resolution; auth cannot import membership. Architecture validation rejects every undeclared
platform-sibling import so process composition cannot silently create reverse dependencies.

Routes adapt Next.js only. Shells own top/left/mobile composition. Features own user workflows.
Domains own reusable Place representations. Platform owns auth, HTTP, maps, telemetry, and manifest
SDKs. Shared owns only proved business-neutral primitives.

## Current limits

The current shell is a structural and accessibility baseline, not the final visual design. Keep it
free of fake place cards, fake provider data, decorative gradients, and hard-coded family services.
Desktop and mobile browser tests own the initial screenshots.

Authentication belongs to `platform/auth` as a deep browser-BFF boundary. Membership browser/backend
translation belongs to `platform/membership` with separate activation. Routes only adapt Next.js
requests and responses; features and shells never receive access tokens, refresh tokens, nonce,
state, PKCE verifier, or an internal backend origin.
