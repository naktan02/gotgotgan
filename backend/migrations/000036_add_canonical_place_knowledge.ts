import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE FUNCTION places.opening_hours_are_valid(value jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      period jsonb;
      moment jsonb;
      moment_key text;
    BEGIN
      IF jsonb_typeof(value) <> 'object'
        OR NOT (value ?& ARRAY['timeZone', 'weeklyPeriods'])
        OR value - 'timeZone' - 'weeklyPeriods' <> '{}'::jsonb THEN
        RETURN false;
      END IF;
      IF jsonb_typeof(value -> 'timeZone') <> 'string'
        OR length(btrim(value ->> 'timeZone')) NOT BETWEEN 1 AND 128
        OR value ->> 'timeZone' <> btrim(value ->> 'timeZone') THEN
        RETURN false;
      END IF;
      IF jsonb_typeof(value -> 'weeklyPeriods') <> 'array' THEN
        RETURN false;
      END IF;
      IF jsonb_array_length(value -> 'weeklyPeriods') NOT BETWEEN 1 AND 64 THEN
        RETURN false;
      END IF;

      FOR period IN
        SELECT element
        FROM jsonb_array_elements(value -> 'weeklyPeriods') AS periods(element)
      LOOP
        IF jsonb_typeof(period) <> 'object'
          OR NOT (period ?& ARRAY['opens', 'closes'])
          OR period - 'opens' - 'closes' <> '{}'::jsonb THEN
          RETURN false;
        END IF;

        FOREACH moment_key IN ARRAY ARRAY['opens', 'closes']
        LOOP
          moment := period -> moment_key;
          IF jsonb_typeof(moment) <> 'object'
            OR NOT (moment ?& ARRAY['dayOfWeek', 'localTime'])
            OR moment - 'dayOfWeek' - 'localTime' <> '{}'::jsonb
            OR jsonb_typeof(moment -> 'dayOfWeek') <> 'string'
            OR jsonb_typeof(moment -> 'localTime') <> 'string'
            OR moment ->> 'dayOfWeek' NOT IN (
              'monday', 'tuesday', 'wednesday', 'thursday',
              'friday', 'saturday', 'sunday'
            )
            OR moment ->> 'localTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            RETURN false;
          END IF;
        END LOOP;
      END LOOP;
      RETURN true;
    END
    $function$;

    CREATE FUNCTION places.versioned_assignment_is_valid(
      value jsonb,
      allowed_roles text[]
    ) RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      version_text text;
    BEGIN
      IF jsonb_typeof(value) <> 'object'
        OR NOT (value ?& ARRAY['key', 'version', 'role'])
        OR value - 'key' - 'version' - 'role' <> '{}'::jsonb
        OR jsonb_typeof(value -> 'key') <> 'string'
        OR jsonb_typeof(value -> 'version') <> 'number'
        OR jsonb_typeof(value -> 'role') <> 'string' THEN
        RETURN false;
      END IF;
      IF length(btrim(value ->> 'key')) NOT BETWEEN 1 AND 128
        OR value ->> 'key' <> btrim(value ->> 'key')
        OR NOT (value ->> 'role' = ANY(allowed_roles)) THEN
        RETURN false;
      END IF;
      version_text := value ->> 'version';
      RETURN version_text ~ '^[1-9][0-9]*$'
        AND length(version_text) <= 10
        AND version_text::numeric <= 2147483647;
    END
    $function$;

    CREATE FUNCTION places.media_fact_is_valid(value jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      attribution jsonb;
      attribution_count integer;
      rights_state text;
    BEGIN
      IF jsonb_typeof(value) <> 'object'
        OR NOT (value ?& ARRAY['externalUri', 'rightsState', 'requiredAttributions'])
        OR value - 'externalUri' - 'size' - 'validUntil'
          - 'rightsState' - 'requiredAttributions' <> '{}'::jsonb
        OR jsonb_typeof(value -> 'externalUri') <> 'string'
        OR jsonb_typeof(value -> 'rightsState') <> 'string'
        OR jsonb_typeof(value -> 'requiredAttributions') <> 'array' THEN
        RETURN false;
      END IF;
      IF length(value ->> 'externalUri') NOT BETWEEN 1 AND 2048
        OR value ->> 'externalUri' !~ '^https?://'
        OR value ->> 'rightsState' NOT IN (
          'display-allowed', 'attribution-required', 'restricted', 'unknown'
        ) THEN
        RETURN false;
      END IF;

      IF value ? 'size' THEN
        IF jsonb_typeof(value -> 'size') <> 'object'
          OR NOT ((value -> 'size') ?& ARRAY['width', 'height'])
          OR (value -> 'size') - 'width' - 'height' <> '{}'::jsonb
          OR jsonb_typeof(value -> 'size' -> 'width') <> 'number'
          OR jsonb_typeof(value -> 'size' -> 'height') <> 'number'
          OR value -> 'size' ->> 'width' !~ '^[1-9][0-9]*$'
          OR value -> 'size' ->> 'height' !~ '^[1-9][0-9]*$'
          OR (value -> 'size' ->> 'width')::numeric > 100000
          OR (value -> 'size' ->> 'height')::numeric > 100000 THEN
          RETURN false;
        END IF;
      END IF;
      IF value ? 'validUntil' AND (
        jsonb_typeof(value -> 'validUntil') <> 'string'
        OR value ->> 'validUntil' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      ) THEN
        RETURN false;
      END IF;

      attribution_count := jsonb_array_length(value -> 'requiredAttributions');
      rights_state := value ->> 'rightsState';
      IF attribution_count > 16
        OR (rights_state = 'attribution-required' AND attribution_count = 0) THEN
        RETURN false;
      END IF;
      FOR attribution IN
        SELECT element
        FROM jsonb_array_elements(value -> 'requiredAttributions') AS items(element)
      LOOP
        IF jsonb_typeof(attribution) <> 'object'
          OR NOT (attribution ? 'label')
          OR attribution - 'label' - 'uri' <> '{}'::jsonb
          OR jsonb_typeof(attribution -> 'label') <> 'string'
          OR length(btrim(attribution ->> 'label')) NOT BETWEEN 1 AND 200
          OR attribution ->> 'label' <> btrim(attribution ->> 'label') THEN
          RETURN false;
        END IF;
        IF attribution ? 'uri' AND (
          jsonb_typeof(attribution -> 'uri') <> 'string'
          OR length(attribution ->> 'uri') NOT BETWEEN 1 AND 2048
          OR attribution ->> 'uri' !~ '^https?://'
        ) THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN true;
    END
    $function$;

    CREATE TABLE places.canonical_place_fact_assertion_batches (
      id uuid PRIMARY KEY,
      subject_kind text NOT NULL CHECK (
        subject_kind IN ('provider-identity', 'canonical-place')
      ),
      provider_key text,
      external_place_id text,
      canonical_place_id uuid REFERENCES places.canonical_places (id),
      source_observation_id uuid NOT NULL
        REFERENCES ingestion.source_observations (id),
      rights_profile_key text NOT NULL CHECK (
        length(rights_profile_key) BETWEEN 1 AND 128
        AND rights_profile_key ~
          '^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)*[.]v[1-9][0-9]{0,8}$'
      ),
      asserted_by_kind text NOT NULL CHECK (
        asserted_by_kind IN ('policy', 'reviewer')
      ),
      asserted_by_reference text NOT NULL
        CHECK (length(asserted_by_reference) BETWEEN 1 AND 512),
      observed_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      recorded_at timestamptz NOT NULL,
      UNIQUE (id, rights_profile_key),
      CHECK (recorded_at >= observed_at),
      CHECK (
        (
          subject_kind = 'provider-identity'
          AND provider_key ~ '^[a-z][a-z0-9-]{0,62}$'
          AND length(external_place_id) BETWEEN 1 AND 512
          AND canonical_place_id IS NULL
        ) OR (
          subject_kind = 'canonical-place'
          AND provider_key IS NULL
          AND external_place_id IS NULL
          AND canonical_place_id IS NOT NULL
        )
      )
    );

    COMMENT ON TABLE places.canonical_place_fact_assertion_batches IS
      'Append-only claims sharing exactly one subject and one immutable Source Observation, observed_at, and versioned rights_profile_key per batch. Field confidence remains assertion-specific.';

    CREATE TABLE places.canonical_place_fact_assertions (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL
        REFERENCES places.canonical_place_fact_assertion_batches (id),
      fact_kind text NOT NULL CHECK (
        fact_kind IN (
          'name', 'formatted-address', 'location', 'phone',
          'website', 'operational-status', 'opening-hours',
          'taxonomy', 'area', 'media'
        )
      ),
      language_tag text,
      text_value text,
      phone_e164_value text CHECK (
        phone_e164_value ~ '^[+][1-9][0-9]{1,14}$'
      ),
      location_value geography(Point, 4326),
      operational_status_value text CHECK (
        operational_status_value IN (
          'unknown', 'operating', 'temporarily-closed', 'permanently-closed'
        )
      ),
      opening_hours_value jsonb CHECK (
        places.opening_hours_are_valid(opening_hours_value)
      ),
      taxonomy_value jsonb CHECK (
        places.versioned_assignment_is_valid(
          taxonomy_value, ARRAY['primary', 'secondary', 'attribute']
        )
      ),
      area_value jsonb CHECK (
        places.versioned_assignment_is_valid(
          area_value, ARRAY['primary', 'ancestor', 'alternate']
        )
      ),
      media_value jsonb CHECK (places.media_fact_is_valid(media_value)),
      confidence numeric NOT NULL CHECK (
        confidence BETWEEN 0 AND 1 AND scale(confidence) <= 3
      ),
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL,
      UNIQUE (id, fact_kind),
      CHECK (
        language_tag IS NULL
        OR (
          length(language_tag) BETWEEN 2 AND 35
          AND language_tag ~ '^(und|[A-Za-z]{2,3})(-[A-Za-z0-9]{2,8})*$'
        )
      ),
      CHECK (num_nonnulls(
        text_value, location_value, operational_status_value, opening_hours_value,
        taxonomy_value, area_value, media_value
      ) = 1),
      CHECK (
        (fact_kind IN ('name', 'formatted-address', 'phone', 'website')
          AND text_value IS NOT NULL)
        OR (fact_kind = 'location' AND location_value IS NOT NULL)
        OR (fact_kind = 'operational-status' AND operational_status_value IS NOT NULL)
        OR (fact_kind = 'opening-hours' AND opening_hours_value IS NOT NULL)
        OR (fact_kind = 'taxonomy' AND taxonomy_value IS NOT NULL)
        OR (fact_kind = 'area' AND area_value IS NOT NULL)
        OR (fact_kind = 'media' AND media_value IS NOT NULL)
      ),
      CHECK (fact_kind IN ('name', 'formatted-address') OR language_tag IS NULL),
      CHECK (fact_kind = 'phone' OR phone_e164_value IS NULL),
      CHECK (
        text_value IS NULL OR (
          length(text_value) BETWEEN 1 AND 2048
          AND (fact_kind <> 'name' OR length(text_value) <= 300)
          AND (fact_kind <> 'formatted-address' OR length(text_value) <= 500)
          AND (fact_kind <> 'phone' OR length(text_value) <= 128)
          AND (fact_kind <> 'website' OR (
            length(text_value) <= 2048 AND text_value ~ '^https?://'
          ))
        )
      )
    );

    COMMENT ON TABLE places.canonical_place_fact_assertions IS
      'Typed, immutable field assertions. Provider payloads and capture references remain in Ingestion and are never copied here.';

    CREATE INDEX canonical_place_fact_batches_provider_subject
      ON places.canonical_place_fact_assertion_batches (
        provider_key, external_place_id, observed_at DESC, id
      ) WHERE subject_kind = 'provider-identity';
    CREATE INDEX canonical_place_fact_batches_place_subject
      ON places.canonical_place_fact_assertion_batches (
        canonical_place_id, observed_at DESC, id
      ) WHERE subject_kind = 'canonical-place';
    CREATE INDEX canonical_place_fact_batches_source_observation
      ON places.canonical_place_fact_assertion_batches (source_observation_id);
    CREATE INDEX canonical_place_fact_assertions_batch_kind
      ON places.canonical_place_fact_assertions (batch_id, fact_kind, id);
    CREATE INDEX canonical_place_fact_assertions_location
      ON places.canonical_place_fact_assertions USING gist (location_value)
      WHERE location_value IS NOT NULL;

    CREATE FUNCTION places.validate_canonical_place_assertion_batch_subject()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      IF NEW.subject_kind = 'provider-identity' AND NOT EXISTS (
        SELECT 1
        FROM ingestion.source_observations AS observation
        WHERE observation.id = NEW.source_observation_id
          AND observation.provider_key = NEW.provider_key
          AND observation.external_place_id = NEW.external_place_id
      ) THEN
        RAISE EXCEPTION 'provider assertion subject does not match its Source Observation'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER validate_canonical_place_assertion_batch_subject
      BEFORE INSERT ON places.canonical_place_fact_assertion_batches
      FOR EACH ROW
      EXECUTE FUNCTION places.validate_canonical_place_assertion_batch_subject();

    CREATE TABLE places.canonical_place_profile_revisions (
      canonical_place_id uuid NOT NULL
        REFERENCES places.canonical_places (id),
      revision bigint NOT NULL CHECK (revision > 0),
      operation_id uuid NOT NULL UNIQUE,
      expected_previous_revision bigint,
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
      display_name_language_tag text CHECK (
        length(display_name_language_tag) BETWEEN 2 AND 35
        AND display_name_language_tag ~ '^(und|[A-Za-z]{2,3})(-[A-Za-z0-9]{2,8})*$'
      ),
      formatted_address text CHECK (length(formatted_address) BETWEEN 1 AND 500),
      formatted_address_language_tag text CHECK (
        length(formatted_address_language_tag) BETWEEN 2 AND 35
        AND formatted_address_language_tag ~ '^(und|[A-Za-z]{2,3})(-[A-Za-z0-9]{2,8})*$'
      ),
      location geography(Point, 4326),
      phone text CHECK (length(phone) BETWEEN 1 AND 128),
      phone_e164 text CHECK (phone_e164 ~ '^[+][1-9][0-9]{1,14}$'),
      website_uri text CHECK (
        length(website_uri) BETWEEN 1 AND 2048 AND website_uri ~ '^https?://'
      ),
      operational_status text CHECK (
        operational_status IN (
          'unknown', 'operating', 'temporarily-closed', 'permanently-closed'
        )
      ),
      opening_hours jsonb CHECK (
        places.opening_hours_are_valid(opening_hours)
      ),
      policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 160),
      rationale text NOT NULL CHECK (
        length(btrim(rationale)) BETWEEN 1 AND 2000
      ),
      published_by_kind text NOT NULL CHECK (
        published_by_kind IN ('policy', 'reviewer')
      ),
      published_by_reference text NOT NULL
        CHECK (length(published_by_reference) BETWEEN 1 AND 512),
      published_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (canonical_place_id, revision),
      UNIQUE (operation_id, canonical_place_id, revision),
      FOREIGN KEY (canonical_place_id, expected_previous_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ) DEFERRABLE INITIALLY DEFERRED,
      CHECK (
        (revision = 1 AND expected_previous_revision IS NULL)
        OR (revision > 1 AND expected_previous_revision = revision - 1)
      ),
      CHECK (formatted_address IS NOT NULL OR formatted_address_language_tag IS NULL),
      CHECK (phone IS NOT NULL OR phone_e164 IS NULL)
    );

    COMMENT ON TABLE places.canonical_place_profile_revisions IS
      'Immutable, evidence-selected Canonical Place public fact snapshots. Identity lifecycle status is intentionally separate from operational_status.';

    CREATE INDEX canonical_place_profile_revisions_location
      ON places.canonical_place_profile_revisions USING gist (location)
      WHERE location IS NOT NULL;
    CREATE INDEX canonical_place_profile_revisions_operational
      ON places.canonical_place_profile_revisions (
        operational_status, canonical_place_id, revision DESC
      );

    CREATE TABLE places.canonical_place_profile_evidence (
      canonical_place_id uuid NOT NULL,
      profile_revision bigint NOT NULL,
      fact_kind text NOT NULL,
      assertion_id uuid NOT NULL,
      evidence_role text NOT NULL CHECK (
        evidence_role IN ('selected', 'supporting', 'contradicting')
      ),
      PRIMARY KEY (
        canonical_place_id, profile_revision, fact_kind, assertion_id
      ),
      FOREIGN KEY (canonical_place_id, profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ),
      FOREIGN KEY (assertion_id, fact_kind)
        REFERENCES places.canonical_place_fact_assertions (id, fact_kind)
    );

    COMMENT ON TABLE places.canonical_place_profile_evidence IS
      'Immutable field-level explanation of which eligible assertions were selected, supported, or contradicted by a profile revision.';

    CREATE UNIQUE INDEX canonical_place_profile_one_selected_fact
      ON places.canonical_place_profile_evidence (
        canonical_place_id, profile_revision, fact_kind
      ) WHERE evidence_role = 'selected';
    CREATE INDEX canonical_place_profile_evidence_assertion
      ON places.canonical_place_profile_evidence (assertion_id);

    CREATE TABLE places.canonical_place_profile_operations (
      operation_id uuid PRIMARY KEY,
      operation_fingerprint text NOT NULL
        CHECK (operation_fingerprint ~ '^[a-f0-9]{64}$'),
      canonical_place_id uuid NOT NULL,
      expected_previous_revision bigint,
      resulting_revision bigint,
      outcome text NOT NULL CHECK (
        outcome IN ('accepted', 'rejected')
      ),
      acceptance_status text CHECK (
        acceptance_status IN ('applied', 'replayed')
      ),
      rejection_code text CHECK (
        rejection_code IN (
          'revision-conflict', 'evidence-unavailable', 'policy-unavailable',
          'place-unavailable', 'command-id-reused'
        )
      ),
      rationale text NOT NULL CHECK (
        length(btrim(rationale)) BETWEEN 1 AND 2000
      ),
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      occurred_at timestamptz NOT NULL,
      CHECK (
        (outcome = 'accepted'
          AND acceptance_status IS NOT NULL
          AND rejection_code IS NULL
          AND resulting_revision IS NOT NULL)
        OR (outcome = 'rejected'
          AND acceptance_status IS NULL
          AND rejection_code IS NOT NULL
          AND resulting_revision IS NULL)
      ),
      FOREIGN KEY (canonical_place_id, resulting_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        )
    );

    COMMENT ON TABLE places.canonical_place_profile_operations IS
      'Immutable idempotency receipts for profile publication attempts; replay compares operation_fingerprint without repeating a mutation.';

    CREATE INDEX canonical_place_profile_operations_place_time
      ON places.canonical_place_profile_operations (
        canonical_place_id, occurred_at DESC, operation_id
      );

    CREATE TABLE places.canonical_place_catalog_changes (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      canonical_place_id uuid NOT NULL,
      profile_revision bigint NOT NULL,
      changed_at timestamptz NOT NULL,
      UNIQUE (canonical_place_id, profile_revision),
      FOREIGN KEY (canonical_place_id, profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        )
    );

    COMMENT ON TABLE places.canonical_place_catalog_changes IS
      'Minimal append-only change feed for bounded, at-least-once consumer projection; it contains no raw evidence or private member data.';

    ALTER TABLE places.canonical_places
      ADD COLUMN current_profile_revision bigint,
      ADD CONSTRAINT canonical_places_current_profile_fk
        FOREIGN KEY (id, current_profile_revision)
        REFERENCES places.canonical_place_profile_revisions (
          canonical_place_id, revision
        ) DEFERRABLE INITIALLY DEFERRED;

    CREATE FUNCTION places.reject_published_profile_component_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM places.canonical_places AS place
        WHERE place.id = NEW.canonical_place_id
          AND place.current_profile_revision = NEW.profile_revision
      ) OR EXISTS (
        SELECT 1
        FROM places.canonical_place_catalog_changes AS published
        WHERE published.canonical_place_id = NEW.canonical_place_id
          AND published.profile_revision = NEW.profile_revision
      ) THEN
        RAISE EXCEPTION 'published Canonical Place profile revision is immutable'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER reject_published_profile_evidence_insert
      BEFORE INSERT ON places.canonical_place_profile_evidence
      FOR EACH ROW
      EXECUTE FUNCTION places.reject_published_profile_component_insert();

    CREATE FUNCTION places.activate_canonical_place_profile(
      p_canonical_place_id uuid,
      p_expected_previous_revision bigint,
      p_profile_revision bigint
    ) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      current_place places.canonical_places%ROWTYPE;
      profile places.canonical_place_profile_revisions%ROWTYPE;
    BEGIN
      SELECT * INTO current_place
      FROM places.canonical_places
      WHERE id = p_canonical_place_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Canonical Place is unavailable' USING ERRCODE = 'P0002';
      END IF;
      IF current_place.status <> 'active' THEN
        RAISE EXCEPTION 'Canonical Place is not active' USING ERRCODE = '23514';
      END IF;
      IF current_place.current_profile_revision = p_profile_revision THEN
        RETURN;
      END IF;
      IF current_place.current_profile_revision IS DISTINCT FROM p_expected_previous_revision THEN
        RAISE EXCEPTION 'Canonical Place profile version conflict' USING ERRCODE = '40001';
      END IF;

      SELECT * INTO STRICT profile
      FROM places.canonical_place_profile_revisions
      WHERE canonical_place_id = p_canonical_place_id
        AND revision = p_profile_revision
      FOR SHARE;

      IF profile.expected_previous_revision IS DISTINCT FROM p_expected_previous_revision THEN
        RAISE EXCEPTION 'Canonical Place profile predecessor mismatch' USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM places.canonical_place_profile_operations AS operation
        WHERE operation.operation_id = profile.operation_id
          AND operation.canonical_place_id = p_canonical_place_id
          AND operation.resulting_revision = p_profile_revision
          AND operation.outcome = 'accepted'
          AND operation.acceptance_status = 'applied'
          AND operation.rationale = profile.rationale
      ) THEN
        RAISE EXCEPTION 'profile publication lacks its applied operation receipt'
          USING ERRCODE = '23514';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        JOIN places.canonical_place_fact_assertion_batches AS batch
          ON batch.id = assertion.batch_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND (
            (
              batch.subject_kind = 'canonical-place'
              AND batch.canonical_place_id <> p_canonical_place_id
            )
            OR (
              batch.subject_kind = 'provider-identity'
              AND NOT EXISTS (
                SELECT 1
                FROM places.provider_place_identities AS identity
                WHERE identity.provider_key = batch.provider_key
                  AND identity.external_place_id = batch.external_place_id
                  AND identity.canonical_place_id = p_canonical_place_id
              )
            )
          )
      ) THEN
        RAISE EXCEPTION 'profile references ineligible evidence' USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'name'
          AND evidence.evidence_role = 'selected'
          AND assertion.text_value = profile.display_name
          AND assertion.language_tag IS NOT DISTINCT FROM profile.display_name_language_tag
      ) THEN
        RAISE EXCEPTION 'profile display name lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.formatted_address IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'formatted-address'
          AND evidence.evidence_role = 'selected'
          AND assertion.text_value = profile.formatted_address
          AND assertion.language_tag IS NOT DISTINCT FROM profile.formatted_address_language_tag
      ) THEN
        RAISE EXCEPTION 'profile address lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.location IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'location'
          AND evidence.evidence_role = 'selected'
          AND assertion.location_value = profile.location
      ) THEN
        RAISE EXCEPTION 'profile location lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.phone IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'phone'
          AND evidence.evidence_role = 'selected'
          AND assertion.text_value = profile.phone
          AND assertion.phone_e164_value IS NOT DISTINCT FROM profile.phone_e164
      ) THEN
        RAISE EXCEPTION 'profile phone lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.website_uri IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'website'
          AND evidence.evidence_role = 'selected'
          AND assertion.text_value = profile.website_uri
      ) THEN
        RAISE EXCEPTION 'profile website lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.opening_hours IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'opening-hours'
          AND evidence.evidence_role = 'selected'
          AND assertion.opening_hours_value = profile.opening_hours
      ) THEN
        RAISE EXCEPTION 'profile opening hours lack selected evidence' USING ERRCODE = '23514';
      END IF;

      IF profile.operational_status IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence AS evidence
        JOIN places.canonical_place_fact_assertions AS assertion
          ON assertion.id = evidence.assertion_id
        WHERE evidence.canonical_place_id = p_canonical_place_id
          AND evidence.profile_revision = p_profile_revision
          AND evidence.fact_kind = 'operational-status'
          AND evidence.evidence_role = 'selected'
          AND assertion.operational_status_value = profile.operational_status
      ) THEN
        RAISE EXCEPTION 'profile operational status lacks selected evidence' USING ERRCODE = '23514';
      END IF;

      UPDATE places.canonical_places
      SET current_profile_revision = profile.revision,
          location = profile.location,
          updated_at = GREATEST(updated_at, profile.published_at)
      WHERE id = p_canonical_place_id;

      INSERT INTO places.canonical_place_catalog_changes (
        canonical_place_id, profile_revision, changed_at
      ) VALUES (
        p_canonical_place_id, profile.revision, profile.published_at
      ) ON CONFLICT (canonical_place_id, profile_revision) DO NOTHING;
    END
    $function$;

    REVOKE ALL ON FUNCTION places.activate_canonical_place_profile(
      uuid, bigint, bigint
    ) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION places.activate_canonical_place_profile(
      uuid, bigint, bigint
    ) TO place_app;

    REVOKE UPDATE ON TABLE places.canonical_places FROM place_app;
    GRANT UPDATE (status, version, retired_at, updated_at)
      ON places.canonical_places TO place_app;

    GRANT SELECT, INSERT ON TABLE
      places.canonical_place_fact_assertion_batches,
      places.canonical_place_fact_assertions,
      places.canonical_place_profile_revisions,
      places.canonical_place_profile_evidence,
      places.canonical_place_profile_operations
    TO place_app;
    GRANT SELECT ON TABLE places.canonical_place_catalog_changes TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM places.canonical_places
        WHERE current_profile_revision IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_fact_assertion_batches
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_fact_assertions
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_profile_revisions
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_profile_evidence
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_profile_operations
      ) OR EXISTS (
        SELECT 1 FROM places.canonical_place_catalog_changes
      ) THEN
        RAISE EXCEPTION 'cannot remove Canonical Place knowledge while assertion, profile, or operation history exists';
      END IF;
    END $$;

    DROP FUNCTION places.activate_canonical_place_profile(uuid, bigint, bigint);
    DROP TRIGGER reject_published_profile_evidence_insert
      ON places.canonical_place_profile_evidence;
    DROP FUNCTION places.reject_published_profile_component_insert();
    ALTER TABLE places.canonical_places
      DROP CONSTRAINT canonical_places_current_profile_fk,
      DROP COLUMN current_profile_revision;
    DROP TABLE places.canonical_place_catalog_changes;
    DROP TABLE places.canonical_place_profile_operations;
    DROP TABLE places.canonical_place_profile_evidence;
    DROP TABLE places.canonical_place_profile_revisions;
    DROP TRIGGER validate_canonical_place_assertion_batch_subject
      ON places.canonical_place_fact_assertion_batches;
    DROP FUNCTION places.validate_canonical_place_assertion_batch_subject();
    DROP TABLE places.canonical_place_fact_assertions;
    DROP TABLE places.canonical_place_fact_assertion_batches;
    DROP FUNCTION places.media_fact_is_valid(jsonb);
    DROP FUNCTION places.versioned_assignment_is_valid(jsonb, text[]);
    DROP FUNCTION places.opening_hours_are_valid(jsonb);

    GRANT UPDATE ON TABLE places.canonical_places TO place_app;
  `)
}
