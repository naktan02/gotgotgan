# Place Domain Context

This glossary fixes the language used by product documents, contracts, code, and tests. It describes
domain meaning rather than storage or framework structure.

| Term | Meaning | Not the same as |
| --- | --- | --- |
| External Principal | A human identity proven by an accepted issuer and identified by the exact `(issuer, subject)` pair. | Email address, browser-supplied role, Place membership. |
| Membership | The Place-owned relationship created for one External Principal after required service consent. It carries status, authority role, user grade, product tier, consent evidence, and optional resource grants. | Identity account, login session, subscription alone. |
| Authority Role | The protected Place administration axis: member, reviewer, administrator, or owner. `member` means no elevated administrative authority. | User Grade, Product Tier. |
| User Grade | A Place-owned, data-defined member classification for participation, reputation, or benefits. It never grants review, administration, or ownership authority. | Authority Role, Product Tier. |
| Product Tier | A Place product-entitlement label for commercial feature or quota policy. It never grants review, administration, or ownership authority. | Authority Role, User Grade. |
| Membership Consent | Versioned evidence that an External Principal accepted every currently required Place service document before just-in-time Membership creation. | Identity login consent, marketing consent, browser session. |
| Resource Grant | An explicit Place-owned permission for one bounded resource or resource kind. | A global role or a browser claim. |
| Anonymous Visitor | A request without verified identity evidence. It may read only an explicitly public projection. | Authenticated guest, member. |
| Public Projection | The fields a Place policy deliberately exposes without membership. | The underlying record or private fields. |
| Access Decision | An allow or deny result produced by Place policy with a stable reason and audit-safe evidence. | UI visibility or Gateway routing. |
| Canonical Place | Provider-independent identity for a real-world place managed by Place. | Provider listing or source observation. |
| Source Observation | Time-bound evidence acquired from a provider and retained with provenance. | A command to overwrite a Canonical Place. |
| Personal Library | A member's Place-owned organization of saved/wanted state, collections, tags, and personal ratings. | Canonical Place data. |
| Visit | A repeatable occurrence connecting a member to a Canonical Place. | Saved/wanted state. |
| Note | Short Place-owned writing that may reference a place and has explicit visibility. | Entry. |
| Entry | Long-form Place-owned writing that may reference multiple places and has explicit visibility. | Note or diary-service content. |
| Place Reference | An opaque, versioned cross-product reference resolved through a Place contract. | Foreign-key or direct database access. |
