# Personal library

Library owns Collections, Tags, saved/wanted preferences, current Personal Ratings, private rating
history, and copy provenance. Saved and wanted are independent booleans; neither implies a Visit.
`visited` is derived from the Visits module and is never duplicated as library state.

Personal Ratings use one decimal from 0.1 through 5.0 so member queries such as “4.4 or higher” do
not require provider-rating semantics. A change updates the current projection and appends a private
rating event. Provider ratings and Canonical Place facts are never mutated.

A Collection owns ordered Canonical Place references. Private is the default. Public and unlisted
Collections require an opaque publication ID. Copying a disclosed Collection creates an independent
private Collection and source-provenance record; it copies only ordered Place references, never
ratings, Tags, Visits, writing, or ownership.
