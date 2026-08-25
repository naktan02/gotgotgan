# Library module

Library owns a member's saved/wanted preferences, current personal rating, rating history,
collections, tags, and copy provenance. It does not own visits and never stores `visited` as a flag.

The application interface accepts idempotent domain commands. Persistence is one deep adapter rather
than repositories per table. Public collection reads use an allowlisted projection that cannot
return owner IDs, tags, ratings, visits, or private records.
