# Visits and ratings

Visits are immutable, repeatable occurrences with stable identity, visit time, record time, and
optional bounded member evidence. An identical retry is accepted; reusing an ID for different
content conflicts. First/last/count and visited state are query projections.

Personal rating history belongs to Library rather than Visit. Both histories remain private and are
excluded from every anonymous Collection and writing projection.
