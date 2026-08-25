import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Client, escapeIdentifier, escapeLiteral } from 'pg'
import { z } from 'zod'

const databaseRuntimeSchema = z
  .object({
    schemaVersion: z.literal('place-database-runtime.v1'),
    database: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    roles: z
      .object({
        administrator: z.string().regex(/^[a-z_][a-z0-9_]*$/),
        migration: z.string().regex(/^[a-z_][a-z0-9_]*$/),
        runtime: z.string().regex(/^[a-z_][a-z0-9_]*$/),
      })
      .refine((roles) => new Set(Object.values(roles)).size === 3, {
        message: 'Database roles must be distinct.',
      }),
    extensions: z.tuple([z.literal('postgis')]),
    configuration: z.object({
      administratorDatabaseUrlFileEnvironment: z.string(),
      migrationPasswordFileEnvironment: z.string(),
      runtimePasswordFileEnvironment: z.string(),
      migrationDatabaseUrlFileEnvironment: z.string(),
    }),
  })
  .passthrough()

type DatabaseRuntime = z.infer<typeof databaseRuntimeSchema>

class DatabasePreparationError extends Error {}

export type DatabasePreparationResult =
  | { ok: true; appliedMigrations: number }
  | { ok: false; message: string }

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new DatabasePreparationError(`${name} must reference a protected secret file.`)
  }
  return value
}

async function readSecretFile(environmentName: string): Promise<string> {
  const secretPath = readRequiredEnvironment(environmentName)
  let rawSecret: string
  try {
    rawSecret = await readFile(secretPath, 'utf8')
  } catch {
    throw new DatabasePreparationError(`${environmentName} cannot be read.`)
  }
  const secret = rawSecret.endsWith('\n')
    ? rawSecret.slice(0, -1).replace(/\r$/, '')
    : rawSecret

  if (secret.length === 0 || secret.includes('\n') || secret.includes('\r')) {
    throw new DatabasePreparationError(`${environmentName} must contain exactly one non-empty line.`)
  }
  return secret
}

function validateDatabaseUrl(value: string, environmentName: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    throw new DatabasePreparationError(`${environmentName} does not contain a valid database URL.`)
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    parsedUrl.username.length === 0 ||
    parsedUrl.password.length === 0 ||
    parsedUrl.hostname.length === 0 ||
    parsedUrl.pathname.length <= 1
  ) {
    throw new DatabasePreparationError(`${environmentName} must contain a complete PostgreSQL URL.`)
  }
  return value
}

async function readDatabaseRuntime(): Promise<DatabaseRuntime> {
  const runtimePath = fileURLToPath(
    new URL('../../../../deploy/database-runtime.json', import.meta.url),
  )
  return databaseRuntimeSchema.parse(JSON.parse(await readFile(runtimePath, 'utf8')))
}

async function assertConnectedAuthority(
  client: Client,
  expectedDatabase: string,
  expectedRole: string,
): Promise<void> {
  const result = await client.query<{ database: string; role: string }>(
    'SELECT current_database() AS database, current_user AS role',
  )
  const connection = result.rows[0]
  if (connection?.database !== expectedDatabase || connection.role !== expectedRole) {
    throw new DatabasePreparationError('Database credential authority does not match the runtime contract.')
  }
}

async function provisionLoginRole(
  administrator: Client,
  role: string,
  password: string,
  marker: string,
): Promise<void> {
  const existingRole = await administrator.query<{ marker: string | null }>(
    `
      SELECT shobj_description(oid, 'pg_authid') AS marker
      FROM pg_roles
      WHERE rolname = $1
    `,
    [role],
  )
  const roleIdentifier = escapeIdentifier(role)

  if (existingRole.rowCount === 0) {
    await administrator.query(`CREATE ROLE ${roleIdentifier}`)
    await administrator.query(
      `COMMENT ON ROLE ${roleIdentifier} IS ${escapeLiteral(marker)}`,
    )
  } else if (existingRole.rows[0]?.marker !== marker) {
    throw new DatabasePreparationError(`Refusing to adopt unmarked database role ${role}.`)
  }

  await administrator.query(`
    ALTER ROLE ${roleIdentifier}
      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
      PASSWORD ${escapeLiteral(password)}
  `)
}

async function provisionDatabaseAuthorities(
  runtime: DatabaseRuntime,
  administratorUrl: string,
  migrationPassword: string,
  runtimePassword: string,
): Promise<void> {
  const administrator = new Client({ connectionString: administratorUrl })
  let connected = false
  let stage = 'administrator connection'

  try {
    await administrator.connect()
    connected = true
    stage = 'administrator authority verification'
    await assertConnectedAuthority(
      administrator,
      runtime.database,
      runtime.roles.administrator,
    )
    stage = 'authority transaction start'
    await administrator.query('BEGIN')
    try {
      stage = 'migration role provisioning'
      await provisionLoginRole(
        administrator,
        runtime.roles.migration,
        migrationPassword,
        'place.database-role.v1:migration',
      )
      stage = 'runtime role provisioning'
      await provisionLoginRole(
        administrator,
        runtime.roles.runtime,
        runtimePassword,
        'place.database-role.v1:runtime',
      )

      const databaseIdentifier = escapeIdentifier(runtime.database)
      const migrationRoleIdentifier = escapeIdentifier(runtime.roles.migration)
      const runtimeRoleIdentifier = escapeIdentifier(runtime.roles.runtime)

      stage = 'database privilege provisioning'
      const memberships = await administrator.query(
        `
          SELECT members.rolname
          FROM pg_auth_members membership
          JOIN pg_roles members ON members.oid = membership.member
          WHERE members.rolname = ANY($1::text[])
        `,
        [[runtime.roles.migration, runtime.roles.runtime]],
      )
      if (memberships.rowCount !== 0) {
        throw new DatabasePreparationError('Place database login roles cannot inherit other roles.')
      }
      await administrator.query(`REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM PUBLIC`)
      await administrator.query(
        `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${migrationRoleIdentifier}, ${runtimeRoleIdentifier}`,
      )
      await administrator.query(
        `GRANT CONNECT, CREATE ON DATABASE ${databaseIdentifier} TO ${migrationRoleIdentifier}`,
      )
      await administrator.query(
        `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${runtimeRoleIdentifier}`,
      )
      await administrator.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
      await administrator.query(
        `ALTER ROLE ${migrationRoleIdentifier} IN DATABASE ${databaseIdentifier} SET search_path = pg_catalog, public`,
      )
      await administrator.query(
        `ALTER ROLE ${runtimeRoleIdentifier} IN DATABASE ${databaseIdentifier} SET search_path = pg_catalog, public`,
      )
      stage = 'PostGIS extension provisioning'
      await administrator.query('CREATE EXTENSION IF NOT EXISTS postgis')

      stage = 'PostGIS extension ownership verification'
      const extensionOwner = await administrator.query<{ owner: string }>(`
        SELECT pg_get_userbyid(extowner) AS owner
        FROM pg_extension
        WHERE extname = 'postgis'
      `)
      if (extensionOwner.rows[0]?.owner !== runtime.roles.administrator) {
        throw new DatabasePreparationError('The PostGIS extension must remain administrator-owned.')
      }

      stage = 'authority transaction commit'
      await administrator.query('COMMIT')
    } catch (error) {
      await administrator.query('ROLLBACK')
      throw error
    }
  } catch (error) {
    if (error instanceof DatabasePreparationError) throw error
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    throw new DatabasePreparationError(
      `Database authority provisioning failed during ${stage}${code}.`,
    )
  } finally {
    if (connected) await administrator.end().catch(() => undefined)
  }
}

async function migrateDatabase(runtime: DatabaseRuntime, migrationUrl: string): Promise<number> {
  const migrationClient = new Client({ connectionString: migrationUrl })
  await migrationClient.connect()

  try {
    await assertConnectedAuthority(
      migrationClient,
      runtime.database,
      runtime.roles.migration,
    )
    const migrations = await runner({
      dbClient: migrationClient,
      dir: fileURLToPath(new URL('../../../migrations', import.meta.url)),
      ignorePattern: 'README.md',
      direction: 'up',
      migrationsTable: 'applied_migrations',
      migrationsSchema: 'place_migrations',
      createMigrationsSchema: true,
      checkOrder: true,
      singleTransaction: true,
      advisoryLockMode: 'fail',
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    return migrations.length
  } finally {
    await migrationClient.end()
  }
}

async function prepareDatabaseOrThrow(): Promise<number> {
  let runtime: DatabaseRuntime
  try {
    runtime = await readDatabaseRuntime()
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DatabasePreparationError('The Place database runtime contract is invalid.')
    }
    throw new DatabasePreparationError('The Place database runtime contract cannot be read.')
  }
  const administratorUrlEnvironment =
    runtime.configuration.administratorDatabaseUrlFileEnvironment
  const migrationUrlEnvironment = runtime.configuration.migrationDatabaseUrlFileEnvironment
  const administratorUrl = validateDatabaseUrl(
    await readSecretFile(administratorUrlEnvironment),
    administratorUrlEnvironment,
  )
  const migrationUrl = validateDatabaseUrl(
    await readSecretFile(migrationUrlEnvironment),
    migrationUrlEnvironment,
  )
  const [migrationPassword, runtimePassword] = await Promise.all([
    readSecretFile(runtime.configuration.migrationPasswordFileEnvironment),
    readSecretFile(runtime.configuration.runtimePasswordFileEnvironment),
  ])

  await provisionDatabaseAuthorities(
    runtime,
    administratorUrl,
    migrationPassword,
    runtimePassword,
  )

  let appliedMigrations: number
  try {
    appliedMigrations = await migrateDatabase(runtime, migrationUrl)
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    const errorType = error instanceof Error ? error.name : 'unknown error'
    throw new DatabasePreparationError(`Database migration failed with ${errorType}${code}.`)
  }
  return appliedMigrations
}

export async function prepareDatabase(): Promise<DatabasePreparationResult> {
  try {
    return { ok: true, appliedMigrations: await prepareDatabaseOrThrow() }
  } catch (error) {
    if (error instanceof DatabasePreparationError) {
      return { ok: false, message: error.message }
    }
    return {
      ok: false,
      message: 'Database preparation failed without exposing connection details.',
    }
  }
}
