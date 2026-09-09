import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE library.collections ADD COLUMN color_token text;

    UPDATE library.collections
    SET color_token = (ARRAY[
      'fern', 'ocean', 'amber', 'coral', 'violet', 'cyan', 'magenta', 'slate'
    ])[1 + get_byte(decode(substr(md5(id::text), 1, 2), 'hex'), 0) % 8];

    ALTER TABLE library.collections
      ALTER COLUMN color_token SET NOT NULL,
      ADD CONSTRAINT collections_color_token CHECK (
        color_token IN ('fern', 'ocean', 'amber', 'coral', 'violet', 'cyan', 'magenta', 'slate')
      );

    CREATE FUNCTION library.assign_collection_color_token()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF NEW.color_token IS NULL THEN
        NEW.color_token := (ARRAY[
          'fern', 'ocean', 'amber', 'coral', 'violet', 'cyan', 'magenta', 'slate'
        ])[1 + get_byte(decode(substr(md5(NEW.id::text), 1, 2), 'hex'), 0) % 8];
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER collections_assign_color_token
      BEFORE INSERT ON library.collections
      FOR EACH ROW EXECUTE FUNCTION library.assign_collection_color_token();

    GRANT UPDATE (color_token) ON TABLE library.collections TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE UPDATE (color_token) ON TABLE library.collections FROM place_app;
    DROP TRIGGER collections_assign_color_token ON library.collections;
    DROP FUNCTION library.assign_collection_color_token();
    ALTER TABLE library.collections
      DROP CONSTRAINT collections_color_token,
      DROP COLUMN color_token;
  `)
}
