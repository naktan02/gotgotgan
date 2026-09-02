# Canonical Place

A Place is provider-neutral. Provider IDs, names, categories, coordinates, addresses, hours, media,
and status arrive as timestamped Source Observations. Ingestion retains raw provider payloads;
the Places Module accepts only typed, normalized assertions with provenance, observation time,
confidence, and a rights-profile key. One assertion batch represents one subject and one Source
Observation. Resolution links, merges, or splits identities; it never erases the evidence used for
the decision.

The public description of a Place is an immutable Canonical Place Profile revision. A publication
command selects values and exact Area/Taxonomy versions, cites every evidence assertion, identifies
the policy version and rationale, and compares an expected current revision. Only an accepted
publication advances the current pointer and emits a bounded catalog change. A replay returns the
original result; a reused operation ID with different content is rejected.

Canonical identity lifecycle is independent from operational status. `active`, `redirected`, and
`retired` describe whether the identity is independently resolvable. `operating`,
`temporarily-closed`, `permanently-closed`, and `unknown` describe the real-world venue. Neither axis
is inferred from the other.

Area nodes own versioned geographic containment and localized names. Taxonomy owns provider-neutral
category and attribute nodes plus reviewed provider mappings. Profiles reference exact versions;
provider category strings and free-form addresses do not become these classifications by themselves.

Media uses a stable opaque source identity, not an expiring provider URL. A separate append-only
rights decision controls allowed surfaces, validity, and required attribution. A selected media
reference is displayable only after the current rights decision passes; a delivery Adapter resolves
it to a temporary display URI at the edge.

Search consumes the catalog change feed into a replaceable Local Search Projection. It may lag and
can be rebuilt, so it never becomes the source of Canonical Place facts.

Other products may store an opaque versioned Place reference. They never query Place, Area,
Taxonomy, Media, or Search tables directly.

A provider identity is `(provider key, external place ID)` and links to at most one Canonical Place.
Create and link never reinterpret an already-linked identity silently. Merge makes the losing Place a
durable redirect, moves its provider links to the survivor, and preserves lineage. Split creates a
new Canonical Place and moves only the reviewed provider identity; the source Place remains valid.
Retirement preserves a terminal reference instead of deleting identity.

Every canonical mutation is keyed by an immutable resolution decision. An identical retry is safe;
reusing the key with different command content is a conflict. Competing mutations for the same Place
or provider identity are serialized and return a bounded outcome rather than overwriting each other.
