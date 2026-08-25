# Canonical Place

A Place is provider-neutral. Provider IDs, names, categories, coordinates, addresses, hours, media,
and status arrive as timestamped source observations with provenance and confidence. Resolution links,
merges, or splits observations; it does not erase the evidence used for the decision.

Other products may store an opaque versioned Place reference. They never query Place tables directly.

A provider identity is `(provider key, external place ID)` and links to at most one Canonical Place.
Create and link never reinterpret an already-linked identity silently. Merge makes the losing Place a
durable redirect, moves its provider links to the survivor, and preserves lineage. Split creates a
new Canonical Place and moves only the reviewed provider identity; the source Place remains valid.
Retirement preserves a terminal reference instead of deleting identity.

Every canonical mutation is keyed by an immutable resolution decision. An identical retry is safe;
reusing the key with different command content is a conflict. Competing mutations for the same Place
or provider identity are serialized and return a bounded outcome rather than overwriting each other.
