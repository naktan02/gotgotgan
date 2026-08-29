# Place Domain Context

This glossary fixes the language used by product documents, contracts, code, and tests. It describes
domain meaning rather than storage or framework structure.

| Term | Meaning | Not the same as |
| --- | --- | --- |
| External Principal | A human identity proven by an accepted issuer and identified by the exact `(issuer, subject)` pair. | Email address, browser-supplied role, Place membership. |
| Membership | The Place-owned relationship created for one External Principal after required service consent. It carries status, authority role, user grade, product tier, consent evidence, and optional resource grants. | Identity account, login session, subscription alone. |
| Authority Role | The protected Place administration axis: member, reviewer, administrator, or owner. `member` means no elevated administrative authority. | User Grade, Product Tier. |
| Platform Role | An Identity-owned cross-product administration rank. Only `platform_owner` projects into Place authority; platform staff ranks do not imply Place resource access. | Place Authority Role, ZITADEL/IAM administrator. |
| Platform Owner Projection | The Place-owned binding that makes the currently verified Platform Owner the sole local `owner` while preserving the prior local role for replacement or revocation. | Copying Identity tables, accepting a browser role, shared resource authorization. |
| User Grade | A Place-owned, data-defined member classification for participation, reputation, or benefits. It never grants review, administration, or ownership authority. | Authority Role, Product Tier. |
| Product Tier | A Place product-entitlement label for commercial feature or quota policy. It never grants review, administration, or ownership authority. | Authority Role, User Grade. |
| Membership Consent | Versioned evidence that an External Principal accepted every currently required Place service document before just-in-time Membership creation. | Identity login consent, marketing consent, browser session. |
| Resource Grant | An explicit Place-owned permission for one bounded resource or resource kind. | A global role or a browser claim. |
| Anonymous Visitor | A request without verified identity evidence. It may read only an explicitly public projection. | Authenticated guest, member. |
| Public Projection | The fields a Place policy deliberately exposes without membership. | The underlying record or private fields. |
| Access Decision | An allow or deny result produced by Place policy with a stable reason and audit-safe evidence. | UI visibility or Gateway routing. |
| Canonical Place | Provider-independent identity for a real-world place managed by Place. | Provider listing or source observation. |
| Source Observation | Time-bound evidence acquired from a provider and retained with provenance. | A command to overwrite a Canonical Place. |
| Provider Place Identity | A stable provider key and provider-owned external place identifier that may link to one Canonical Place at a time. | Canonical Place identity or a provider account. |
| Place Candidate | A normalized interpretation derived from one Source Observation and awaiting a resolution outcome. | Canonical Place or verified Place knowledge. |
| Place Evidence Representation | The Resolution-owned, replaceable comparison projection for the latest Source Observation of one Provider Place Identity. It preserves raw multilingual values beside deterministic comparison fields. | Source Observation history, provider alias, Place Candidate, or Canonical Place truth. |
| Match Assessment | An immutable, versioned pairwise comparison of two Source Observations, including features, reasons, confidence, and a review hint. | Resolution Decision, provider link, or authority to mutate a Canonical Place. |
| Place Cluster Proposal | A versioned, non-canonical grouping of Provider Place Identities that Resolution proposes may represent one real-world place. | Canonical Place, transitive merge, or accepted Resolution Decision. |
| Cluster Verification | An append-only structured verdict and cited public evidence for one Place Cluster Proposal version, produced by a deterministic policy, external verifier, or reviewer. | Canonical mutation authority or proof that every cluster member is identical. |
| Resolution Decision | Immutable evidence of how a Place Candidate or canonical conflict was classified under a named policy or reviewer. | The canonical mutation itself. |
| Imported Place Fulfillment Intent | 회원이 연결 목록에서 선택한 Provider 장소를 자신의 Library에 저장하려는 멱등 의도. | Provider 로그인 세션이나 Canonical Place 자체. |
| Place Fulfillment Job | 동일한 Provider Place Identity의 여러 Fulfillment Intent를 합쳐 가져온 Source Snapshot을 Canonical Place와 회원 Library에 멱등 반영하는 작업. | Provider 상세 조회 작업이나 회원별 ImportBatch. |
| Provider Place Detail State | Provider Place Identity별 상세 관찰 상태. `pending`, `available`, `unavailable` 중 하나이며 `available`은 정규화된 상세 Source Observation을 반드시 가리킨다. 개인 저장 성공 여부와 독립적이다. | ImportItem 상태나 Canonical Place 존재 여부. |
| Provider Place Detail Job | 회원·ImportBatch·브라우저 profile 없이 Provider Place Identity 하나의 상세 증거를 수집·정규화하는 lease/retry 작업. | Place Fulfillment Job이나 Canonical 동일 장소 판정. |
| Place Redirect | A durable reference from a merged Canonical Place to the surviving Canonical Place. | Deletion or alias text. |
| Place Lineage | Immutable merge or split history that explains how Canonical Place identity and provider links changed. | Current Place state. |
| Personal Library | A member's Place-owned organization of saved/wanted state, collections, tags, and personal ratings. | Canonical Place data. |
| Collection | A member-owned, ordered grouping of Canonical Place references. An imported provider folder may initialize one, but it remains Place-owned and independently renameable. | Taxonomy Node or a provider folder itself. |
| Source List | A provider-owned folder or saved-list identity observed during import, including its source name and order. | A Place Collection or provider-neutral category. |
| Collection Import Provenance | The member-scoped mapping from one Provider connection and Source List to the Place Collection created for it. | Shared ownership or permission to overwrite the Collection name. |
| Collection Place Import Provenance | 한 Collection membership이 어떤 Provider 연결·Source List·Source Item·Provider Place Identity에서 왔는지 나타내는 회원 범위 출처. | Canonical Place identity 또는 Provider 폴더 자체. |
| Place Preferences | The member-owned saved, wanted, and current personal-rating values for one Canonical Place. The values are independent and `visited` is not stored here. | Visit history or provider rating. |
| Personal Rating | A member's current 0.1-to-5.0 evaluation of a Canonical Place, with private change history. | Provider rating or public aggregate. |
| Visit | A repeatable occurrence connecting a member to a Canonical Place. | Saved/wanted state. |
| Note | Short Place-owned writing that may reference a place and has explicit visibility. | Entry. |
| Entry | Long-form Place-owned writing that may reference multiple places and has explicit visibility. | Note or diary-service content. |
| Unlisted Projection | An allowlisted anonymous projection reachable only through its opaque publication identifier and excluded from discovery. | Private data or an authenticated resource grant. |
| Public Profile | A member-controlled public identity that discloses a Public Handle, display name, and only that member's public Collections while published. | External Principal, Membership, every shared or unlisted item, or a social account. |
| Public Handle | A unique, stable, member-chosen identifier used in a Public Profile URL. It is claimed once, normalized independently of the changeable display name, and never reassigned after retirement. | Real name, email address, External Principal subject, or display name. |
| Retired Public Handle | A Public Handle reservation detached from its former Membership after Profile or Membership deletion. It remains unavailable and resolves like an unknown Handle. | A hidden Public Profile, a recoverable login name, or an identity proof. |
| Public Profile Report | An authenticated member's categorized, time-limited safety signal about a currently published Public Profile. It contains no narrative and never changes publication by itself. | Moderation Decision, public comment, support conversation, or proof of a violation. |
| Public Profile Moderation | The Place-operated allowed/withheld publication axis applied independently of the profile owner's hidden/public choice. | Membership suspension, owner visibility, report count, or deletion. |
| Profile Moderation Decision | An immutable operator record that changes or confirms Public Profile Moderation under a categorized reason and closes the currently pending reports for that Handle. | Public Profile Report, owner appeal, or Access Decision. |
| Collection Copy | A new member-owned collection populated from a disclosed projection with source provenance. | Shared mutable ownership or copying private metadata. |
| Place Reference | An opaque, versioned cross-product reference resolved through a Place contract. | Foreign-key or direct database access. |
| Taxonomy Node | A versioned provider-neutral category or attribute used to classify Canonical Places. | Provider category text or a fixed restaurant/cafe/travel top-level enum. |
| Local Search Projection | The bounded, discoverable Place facts and viewer-specific signals prepared for local search. It may lag its owners and never becomes canonical truth. | Canonical Place, Source Observation, or direct cross-module table access. |
| Search Source Outcome | One search source's complete, partial, or unavailable contribution to a provider-neutral result envelope. | A failure state for the entire search request. |
| Search Cursor | An opaque continuation identity for the exact ordered search state. | Page number or a database offset exposed to callers. |
