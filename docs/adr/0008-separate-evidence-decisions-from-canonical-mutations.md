# 0008: Separate evidence decisions from canonical mutations

Status: accepted

Date: 2026-08-26

Ingestion records immutable Source Observations, Place Candidates, and Resolution Decisions, while
Places applies separately idempotent canonical commands and owns redirects and lineage. This
two-step handoff was selected over a cross-module transaction so provider replay/review can evolve
without importing Places internals or allowing evidence to overwrite canonical identity; a future
composition root translates only an accepted decision and retries by its stable decision ID.
