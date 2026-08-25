# PostgreSQL library adapter

The adapter owns one transactional command boundary over the Library schema. It records command
receipts, current preferences, rating history, collection/tag membership, and copy provenance.
Published reads enumerate their columns and never select personal preference or ownership fields.
