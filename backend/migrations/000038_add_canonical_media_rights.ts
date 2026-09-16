import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA media;
    REVOKE ALL ON SCHEMA media FROM PUBLIC;

    CREATE FUNCTION media.display_surfaces_are_valid(value text[])
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      item text;
      seen text[] := ARRAY[]::text[];
    BEGIN
      IF cardinality(value) > 8 THEN
        RETURN false;
      END IF;
      FOREACH item IN ARRAY value
      LOOP
        IF item NOT IN (
          'place-detail', 'search-card', 'library-card', 'public-share'
        ) OR item = ANY(seen) THEN
          RETURN false;
        END IF;
        seen := array_append(seen, item);
      END LOOP;
      RETURN true;
    END
    $function$;

    CREATE TABLE media.place_media_sources (
      media_id uuid PRIMARY KEY,
      canonical_place_id uuid NOT NULL
        REFERENCES places.canonical_places (id),
      source_observation_id uuid NOT NULL
        REFERENCES ingestion.source_observations (id),
      source_assertion_id uuid NOT NULL,
      source_fact_kind text NOT NULL DEFAULT 'media'
        CHECK (source_fact_kind = 'media'),
      source_kind text NOT NULL CHECK (
        source_kind IN ('provider-media', 'internal-object')
      ),
      provider_key text,
      provider_media_identity text,
      internal_object_reference text,
      media_type text NOT NULL CHECK (media_type IN ('image')),
      width integer CHECK (width BETWEEN 1 AND 100000),
      height integer CHECK (height BETWEEN 1 AND 100000),
      content_fingerprint text CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
      observed_at timestamptz NOT NULL,
      source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL,
      current_rights_revision bigint,
      UNIQUE (media_id, current_rights_revision),
      UNIQUE (media_id, canonical_place_id, source_assertion_id),
      FOREIGN KEY (source_assertion_id, source_fact_kind)
        REFERENCES places.canonical_place_fact_assertions (id, fact_kind),
      CHECK (
        (width IS NULL) = (height IS NULL)
      ),
      CHECK (created_at >= observed_at),
      CHECK (
        (
          source_kind = 'provider-media'
          AND provider_key ~ '^[a-z][a-z0-9-]{0,62}$'
          AND length(provider_media_identity) BETWEEN 1 AND 2048
          AND provider_media_identity !~ '^[A-Za-z][A-Za-z0-9+.-]*://'
          AND internal_object_reference IS NULL
        ) OR (
          source_kind = 'internal-object'
          AND provider_key IS NULL
          AND provider_media_identity IS NULL
          AND length(internal_object_reference) BETWEEN 1 AND 1024
          AND internal_object_reference !~ '^[A-Za-z][A-Za-z0-9+.-]*://'
        )
      )
    );

    COMMENT ON TABLE media.place_media_sources IS
      'Stable Place media source identities. Expiring Provider URLs, raw payloads, credentials, capture references, and browser paths are not source identity.';

    CREATE UNIQUE INDEX place_media_sources_provider_identity
      ON media.place_media_sources (provider_key, provider_media_identity)
      WHERE source_kind = 'provider-media';
    CREATE UNIQUE INDEX place_media_sources_internal_object
      ON media.place_media_sources (internal_object_reference)
      WHERE source_kind = 'internal-object';
    CREATE INDEX place_media_sources_place_time
      ON media.place_media_sources (
        canonical_place_id, observed_at DESC, media_id
      );
    CREATE INDEX place_media_sources_observation
      ON media.place_media_sources (source_observation_id);

    CREATE FUNCTION media.validate_media_source_assertion()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM places.canonical_place_fact_assertions AS assertion
        JOIN places.canonical_place_fact_assertion_batches AS batch
          ON batch.id = assertion.batch_id
        JOIN ingestion.source_observations AS observation
          ON observation.id = batch.source_observation_id
        WHERE assertion.id = NEW.source_assertion_id
          AND assertion.fact_kind = 'media'
          AND batch.source_observation_id = NEW.source_observation_id
          AND batch.observed_at = NEW.observed_at
          AND (
            NEW.source_kind <> 'provider-media'
            OR observation.provider_key = NEW.provider_key
          )
          AND (
            batch.subject_kind <> 'provider-identity'
            OR batch.provider_key = NEW.provider_key
          )
          AND (
            (batch.subject_kind = 'canonical-place'
              AND batch.canonical_place_id = NEW.canonical_place_id)
            OR (batch.subject_kind = 'provider-identity' AND EXISTS (
              SELECT 1
              FROM places.provider_place_identities AS identity
              WHERE identity.provider_key = batch.provider_key
                AND identity.external_place_id = batch.external_place_id
                AND identity.canonical_place_id = NEW.canonical_place_id
            ))
          )
      ) THEN
        RAISE EXCEPTION 'media source must preserve an eligible media assertion and Source Observation'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER validate_media_source_assertion
      BEFORE INSERT ON media.place_media_sources
      FOR EACH ROW
      EXECUTE FUNCTION media.validate_media_source_assertion();

    CREATE TABLE media.media_rights_revisions (
      media_id uuid NOT NULL
        REFERENCES media.place_media_sources (media_id),
      revision bigint NOT NULL CHECK (revision > 0),
      state text NOT NULL CHECK (
        state IN ('pending', 'allowed', 'blocked', 'expired', 'withdrawn')
      ),
      allowed_surfaces text[] NOT NULL DEFAULT '{}' CHECK (
        media.display_surfaces_are_valid(allowed_surfaces)
      ),
      basis text NOT NULL CHECK (
        basis IN (
          'unknown', 'provider-terms', 'open-license',
          'rights-holder-license', 'member-license', 'internal-license'
        )
      ),
      attribution_required boolean NOT NULL,
      license_uri text CHECK (
        length(license_uri) BETWEEN 1 AND 2048 AND license_uri ~ '^https?://'
      ),
      valid_from timestamptz NOT NULL,
      valid_until timestamptz,
      decided_by_kind text NOT NULL CHECK (
        decided_by_kind IN ('policy', 'reviewer')
      ),
      decided_by_reference text NOT NULL
        CHECK (length(decided_by_reference) BETWEEN 1 AND 512),
      decided_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (media_id, revision),
      CHECK (valid_until IS NULL OR valid_until > valid_from),
      CHECK (
        (state = 'allowed'
          AND cardinality(allowed_surfaces) > 0
          AND basis <> 'unknown'
          AND (valid_until IS NULL OR valid_until > decided_at))
        OR (state <> 'allowed' AND cardinality(allowed_surfaces) = 0)
      ),
      CHECK (
        state <> 'expired'
        OR (valid_until IS NOT NULL AND valid_until <= decided_at)
      )
    );

    COMMENT ON TABLE media.media_rights_revisions IS
      'Append-only decisions governing whether and where a media source may be displayed; selection alone never grants display rights.';

    CREATE INDEX media_rights_revisions_current
      ON media.media_rights_revisions (media_id, revision DESC);
    CREATE INDEX media_rights_revisions_state_validity
      ON media.media_rights_revisions (state, valid_until, media_id, revision)
      WHERE state = 'allowed';

    ALTER TABLE media.place_media_sources
      ADD CONSTRAINT place_media_sources_current_rights_fk
      FOREIGN KEY (media_id, current_rights_revision)
      REFERENCES media.media_rights_revisions (media_id, revision)
      DEFERRABLE INITIALLY DEFERRED;

    CREATE TABLE media.media_rights_attributions (
      media_id uuid NOT NULL,
      rights_revision bigint NOT NULL,
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 15),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
      uri text CHECK (
        length(uri) BETWEEN 1 AND 2048 AND uri ~ '^https?://'
      ),
      PRIMARY KEY (media_id, rights_revision, ordinal),
      FOREIGN KEY (media_id, rights_revision)
        REFERENCES media.media_rights_revisions (media_id, revision)
    );

    COMMENT ON TABLE media.media_rights_attributions IS
      'Ordered immutable attribution lines bound to one exact media rights revision.';

    CREATE TABLE places.canonical_place_profile_media (
      canonical_place_id uuid NOT NULL,
      profile_revision bigint NOT NULL,
      media_id uuid NOT NULL,
      source_assertion_id uuid NOT NULL,
      source_fact_kind text NOT NULL DEFAULT 'media'
        CHECK (source_fact_kind = 'media'),
      ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 31),
      PRIMARY KEY (canonical_place_id, profile_revision, media_id),
      UNIQUE (canonical_place_id, profile_revision, ordinal),
      FOREIGN KEY (canonical_place_id, profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ),
      FOREIGN KEY (source_assertion_id, source_fact_kind)
        REFERENCES places.canonical_place_fact_assertions (id, fact_kind),
      FOREIGN KEY (media_id, canonical_place_id, source_assertion_id)
        REFERENCES media.place_media_sources (
          media_id, canonical_place_id, source_assertion_id
        )
    );

    COMMENT ON TABLE places.canonical_place_profile_media IS
      'Immutable ordered media selection for one profile revision. Current allowed rights and validity still gate every display.';

    CREATE INDEX canonical_place_profile_media_source
      ON places.canonical_place_profile_media (media_id);

    CREATE TRIGGER reject_published_profile_media_insert
      BEFORE INSERT ON places.canonical_place_profile_media
      FOR EACH ROW
      EXECUTE FUNCTION places.reject_published_profile_component_insert();

    CREATE FUNCTION media.activate_media_rights(
      p_media_id uuid,
      p_rights_revision bigint
    ) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      rights media.media_rights_revisions%ROWTYPE;
      current_revision bigint;
    BEGIN
      SELECT source.current_rights_revision INTO current_revision
      FROM media.place_media_sources AS source
      WHERE source.media_id = p_media_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'media source is unavailable' USING ERRCODE = 'P0002';
      END IF;
      IF current_revision = p_rights_revision THEN
        RETURN;
      END IF;

      SELECT * INTO STRICT rights
      FROM media.media_rights_revisions
      WHERE media_id = p_media_id AND revision = p_rights_revision
      FOR SHARE;

      IF current_revision IS NOT NULL AND p_rights_revision <= current_revision THEN
        RAISE EXCEPTION 'media rights revision must advance monotonically'
          USING ERRCODE = '23514';
      END IF;
      IF rights.state = 'allowed' AND rights.attribution_required AND NOT EXISTS (
        SELECT 1
        FROM media.media_rights_attributions AS attribution
        WHERE attribution.media_id = p_media_id
          AND attribution.rights_revision = p_rights_revision
      ) THEN
        RAISE EXCEPTION 'allowed media requires attribution' USING ERRCODE = '23514';
      END IF;

      UPDATE media.place_media_sources
      SET current_rights_revision = p_rights_revision
      WHERE media_id = p_media_id;
    END
    $function$;

    REVOKE ALL ON FUNCTION media.activate_media_rights(uuid, bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION media.activate_media_rights(uuid, bigint) TO place_app;

    CREATE VIEW media.current_displayable_place_media
    WITH (security_barrier = true)
    AS
      SELECT
        selected.canonical_place_id,
        selected.profile_revision,
        selected.media_id,
        selected.source_assertion_id,
        selected.ordinal,
        source.source_kind,
        source.provider_key,
        source.provider_media_identity,
        source.internal_object_reference,
        source.media_type,
        source.width,
        source.height,
        rights.allowed_surfaces,
        rights.attribution_required,
        rights.valid_until,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'label', attribution.label,
              'uri', attribution.uri
            )) ORDER BY attribution.ordinal
          )
          FROM media.media_rights_attributions AS attribution
          WHERE attribution.media_id = rights.media_id
            AND attribution.rights_revision = rights.revision
        ), '[]'::jsonb) AS attributions
      FROM places.canonical_place_profile_media AS selected
      JOIN places.canonical_places AS place
        ON place.id = selected.canonical_place_id
       AND place.current_profile_revision = selected.profile_revision
       AND place.status = 'active'
      JOIN media.place_media_sources AS source
        ON source.media_id = selected.media_id
       AND source.canonical_place_id = selected.canonical_place_id
      JOIN media.media_rights_revisions AS rights
        ON rights.media_id = source.media_id
       AND rights.revision = source.current_rights_revision
      WHERE rights.state = 'allowed'
        AND rights.valid_from <= CURRENT_TIMESTAMP
        AND (rights.valid_until IS NULL OR rights.valid_until > CURRENT_TIMESTAMP)
        AND (
          NOT rights.attribution_required
          OR EXISTS (
            SELECT 1
            FROM media.media_rights_attributions AS required_attribution
            WHERE required_attribution.media_id = rights.media_id
              AND required_attribution.rights_revision = rights.revision
          )
        );

    COMMENT ON VIEW media.current_displayable_place_media IS
      'Internal safe projection: only current-profile media with active allowed rights, valid time, surfaces, and required attribution. Callers must still select an allowed surface.';

    GRANT USAGE ON SCHEMA media TO place_app;
    GRANT SELECT, INSERT ON TABLE
      media.place_media_sources,
      media.media_rights_revisions,
      media.media_rights_attributions,
      places.canonical_place_profile_media
    TO place_app;
    GRANT SELECT ON media.current_displayable_place_media TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM places.canonical_place_profile_media)
        OR EXISTS (SELECT 1 FROM media.place_media_sources)
        OR EXISTS (SELECT 1 FROM media.media_rights_revisions)
        OR EXISTS (SELECT 1 FROM media.media_rights_attributions) THEN
        RAISE EXCEPTION 'cannot remove Canonical media rights while source, rights, or selection history exists';
      END IF;
    END $$;

    DROP VIEW media.current_displayable_place_media;
    DROP FUNCTION media.activate_media_rights(uuid, bigint);
    DROP TRIGGER reject_published_profile_media_insert
      ON places.canonical_place_profile_media;
    DROP TABLE places.canonical_place_profile_media;
    DROP TABLE media.media_rights_attributions;
    ALTER TABLE media.place_media_sources
      DROP CONSTRAINT place_media_sources_current_rights_fk;
    DROP TABLE media.media_rights_revisions;
    DROP TRIGGER validate_media_source_assertion ON media.place_media_sources;
    DROP FUNCTION media.validate_media_source_assertion();
    DROP TABLE media.place_media_sources;
    DROP FUNCTION media.display_surfaces_are_valid(text[]);
    DROP SCHEMA media;
  `)
}
