import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE library.collection_discovery_topics (
      collection_id uuid NOT NULL
        REFERENCES library.collections (id) ON DELETE CASCADE,
      topic_key text NOT NULL CHECK (
        topic_key = lower(topic_key)
        AND topic_key ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'
      ),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
      PRIMARY KEY (collection_id, topic_key),
      UNIQUE (collection_id, ordinal)
    );

    CREATE INDEX collection_discovery_topics_topic
      ON library.collection_discovery_topics (topic_key, collection_id);
    CREATE INDEX collections_public_discovery_recent
      ON library.collections (updated_at DESC, id ASC)
      WHERE visibility = 'public' AND publication_id IS NOT NULL;
    CREATE INDEX collections_public_discovery_largest
      ON library.collections (id)
      WHERE visibility = 'public' AND publication_id IS NOT NULL;
    CREATE INDEX public_profiles_discovery_owner
      ON profiles.public_profiles (membership_id)
      WHERE visibility = 'public';

    GRANT SELECT, INSERT, DELETE
      ON TABLE library.collection_discovery_topics TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE SELECT, INSERT, DELETE
      ON TABLE library.collection_discovery_topics FROM place_app;
    DROP INDEX profiles.public_profiles_discovery_owner;
    DROP INDEX library.collections_public_discovery_largest;
    DROP INDEX library.collections_public_discovery_recent;
    DROP INDEX library.collection_discovery_topics_topic;
    DROP TABLE library.collection_discovery_topics;
  `)
}
