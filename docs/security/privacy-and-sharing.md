# Privacy and sharing

Private is the default for personal library data, visits, ratings, notes, entries, imports, and
provider connections. Public and explicitly shared projections enumerate allowed fields rather than
filtering a private record after serialization. Authorization-denial tests cover every new projection.

Stage 4 public Collection projections contain only publication ID, visibility, name, description,
ordered Place IDs, and update time. Public writing projections contain only publication ID,
visibility, form, published content, linked Place IDs, and update time. Owner membership, saved and
wanted preferences, Personal Ratings and history, Tags, Visits, copy provenance, and writing
revisions are never selected by those queries. The Web validates the same allowlist and rejects
unexpected Backend fields.
