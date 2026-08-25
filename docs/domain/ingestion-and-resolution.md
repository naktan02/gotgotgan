# Ingestion and resolution

An import run moves through durable discovery, capture, normalization, matching, preview, review,
apply, and completion states. Raw evidence is immutable for its retention window and references a
parser version and checksum. Reprocessing creates a new normalized result without rewriting history.

Automatic merge requires an explicit confidence policy; ambiguous matches enter review. Provider
adapters gather evidence, while ingestion owns provider-neutral workflow and resolution orchestration.

The first Stage 3 seam records three immutable artifacts:

1. `Source Observation`: provider identity, acquisition kind, checksum, parser version, timestamps,
   normalized facts, confidence, and an optional opaque capture reference;
2. `Place Candidate`: one versioned normalized interpretation with optional WGS84 location; and
3. `Resolution Decision`: needs review, explicit not-the-same, create/link/merge/split/retire Place,
   with actor/policy reference, evidence IDs, rationale, and time. Candidate decisions name their
   candidate; canonical-conflict decisions need not invent one.

Recording a decision does not mutate canonical state. The `places` module separately accepts a
canonical command with the source decision reference. This keeps observation replay and reviewer
workflow independent from canonical lifecycle while preserving end-to-end traceability.
