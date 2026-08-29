import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE profiles.public_handle_reservations (
      handle text PRIMARY KEY,
      membership_id uuid UNIQUE REFERENCES access.memberships (id) ON DELETE SET NULL,
      reserved_at timestamptz NOT NULL,
      retired_at timestamptz,
      UNIQUE (handle, membership_id),
      CHECK (
        (membership_id IS NOT NULL AND retired_at IS NULL)
        OR (membership_id IS NULL AND retired_at IS NOT NULL)
      ),
      CHECK (handle = lower(handle)),
      CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'),
      CHECK (length(handle) BETWEEN 3 AND 30),
      CHECK (handle NOT IN (
        'admin', 'api', 'auth', 'library', 'people', 'search', 'settings', 'share', 'support', 'www'
      ))
    );

    INSERT INTO profiles.public_handle_reservations (
      handle, membership_id, reserved_at, retired_at
    )
    SELECT handle, membership_id, created_at, NULL
    FROM profiles.public_profiles;

    ALTER TABLE profiles.public_profiles
      ADD CONSTRAINT public_profiles_handle_reservation_fkey
      FOREIGN KEY (handle, membership_id)
      REFERENCES profiles.public_handle_reservations (handle, membership_id)
      DEFERRABLE INITIALLY DEFERRED;

    CREATE FUNCTION profiles.enforce_public_handle_retirement()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, profiles
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.membership_id IS NULL OR NEW.retired_at IS NOT NULL THEN
          RAISE EXCEPTION 'Public Handle Reservation must start active'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.membership_id IS NULL AND NEW.membership_id IS NOT NULL THEN
        RAISE EXCEPTION 'Retired Public Handle cannot be reassigned'
          USING ERRCODE = '23514';
      END IF;
      IF OLD.membership_id IS NOT NULL AND NEW.membership_id IS NULL THEN
        NEW.retired_at := COALESCE(NEW.retired_at, clock_timestamp());
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER validate_public_handle_reservation_insert
      BEFORE INSERT ON profiles.public_handle_reservations
      FOR EACH ROW
      EXECUTE FUNCTION profiles.enforce_public_handle_retirement();

    CREATE TRIGGER enforce_public_handle_retirement
      BEFORE UPDATE OF membership_id ON profiles.public_handle_reservations
      FOR EACH ROW
      EXECUTE FUNCTION profiles.enforce_public_handle_retirement();

    CREATE FUNCTION profiles.retire_deleted_public_profile_handle()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, profiles
    AS $$
    BEGIN
      UPDATE profiles.public_handle_reservations
      SET membership_id = NULL,
          retired_at = COALESCE(retired_at, clock_timestamp())
      WHERE handle = OLD.handle;
      RETURN OLD;
    END;
    $$;

    CREATE TRIGGER retire_deleted_public_profile_handle
      AFTER DELETE ON profiles.public_profiles
      FOR EACH ROW
      EXECUTE FUNCTION profiles.retire_deleted_public_profile_handle();

    GRANT INSERT ON TABLE profiles.public_handle_reservations TO place_app;
    GRANT SELECT (handle) ON TABLE profiles.public_handle_reservations TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE profiles.public_profiles
      DROP CONSTRAINT public_profiles_handle_reservation_fkey;
    DROP TRIGGER retire_deleted_public_profile_handle ON profiles.public_profiles;
    DROP FUNCTION profiles.retire_deleted_public_profile_handle();
    DROP TRIGGER enforce_public_handle_retirement ON profiles.public_handle_reservations;
    DROP TRIGGER validate_public_handle_reservation_insert ON profiles.public_handle_reservations;
    DROP FUNCTION profiles.enforce_public_handle_retirement();
    DROP TABLE profiles.public_handle_reservations;
  `)
}
