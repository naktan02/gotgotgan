# Ingestion and resolution

An import run moves through durable discovery, capture, normalization, matching, preview, review,
apply, and completion states. Raw evidence is immutable for its retention window and references a
parser version and checksum. Reprocessing creates a new normalized result without rewriting history.

Automatic merge requires an explicit confidence policy; ambiguous matches enter review. Provider
adapters gather evidence, while ingestion owns provider-neutral workflow and resolution orchestration.
