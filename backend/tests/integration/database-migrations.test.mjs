import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { Client, Pool } from 'pg'

import databaseRuntime from '../../../deploy/database-runtime.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
const npmExecutable = process.env.npm_execpath
const databaseTestHost = process.env.PLACE_DATABASE_TEST_HOST

async function run(executable, args, options = {}) {
  return execFileAsync(executable, args, {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  })
}

async function waitUntilReady(containerName) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run('docker', [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        databaseRuntime.roles.administrator,
        '-d',
        databaseRuntime.database,
      ])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

async function expectInsufficientPrivilege(client, sql) {
  await assert.rejects(client.query(sql), (error) => error?.code === '42501')
}

async function waitForAuthenticatedConnection(connectionString) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new Client({ connectionString })
    try {
      await client.connect()
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

test('database preparation confines runtime authority and persists Place access and browser auth', { timeout: 90_000 }, async () => {
  assert.match(
    databaseTestHost ?? '',
    /^[a-zA-Z0-9.-]+$/,
    'PLACE_DATABASE_TEST_HOST must contain a safe injected hostname',
  )
  const suffix = `${process.pid}-${Date.now()}`
  const containerName = `place-database-test-${suffix}`
  const secretDirectory = await mkdtemp(path.join(os.tmpdir(), 'place-database-test-'))
  const administratorPassword = randomBytes(24).toString('base64url')
  const migrationPassword = randomBytes(24).toString('base64url')
  const runtimePassword = randomBytes(24).toString('base64url')

  let runtimeClient
  let administratorClient
  let runtimePool
  let oidcRuntimeA
  let oidcRuntimeB
  let httpRuntime

  try {
    const administratorPasswordFile = path.join(secretDirectory, 'administrator-password')
    await writeFile(administratorPasswordFile, administratorPassword, { mode: 0o600 })
    await run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--publish',
      `${databaseTestHost}::5432`,
      '--env',
      `POSTGRES_DB=${databaseRuntime.database}`,
      '--env',
      `POSTGRES_USER=${databaseRuntime.roles.administrator}`,
      '--mount',
      `type=bind,source=${administratorPasswordFile},target=/run/secrets/place_test_admin_password,readonly`,
      '--env',
      'POSTGRES_PASSWORD_FILE=/run/secrets/place_test_admin_password',
      databaseRuntime.image,
    ])
    await waitUntilReady(containerName)

    const { stdout: portOutput } = await run('docker', [
      'port',
      containerName,
      '5432/tcp',
    ])
    const port = portOutput.trim().split(':').at(-1)
    assert.match(port ?? '', /^\d+$/)

    const administratorUrl = `postgresql://${databaseRuntime.roles.administrator}:${encodeURIComponent(administratorPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const migrationUrl = `postgresql://${databaseRuntime.roles.migration}:${encodeURIComponent(migrationPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const runtimeUrl = `postgresql://${databaseRuntime.roles.runtime}:${encodeURIComponent(runtimePassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const administratorUrlFile = path.join(secretDirectory, 'administrator-url')
    const migrationUrlFile = path.join(secretDirectory, 'migration-url')
    const migrationPasswordFile = path.join(secretDirectory, 'migration-password')
    const runtimePasswordFile = path.join(secretDirectory, 'runtime-password')

    await waitForAuthenticatedConnection(administratorUrl)

    await Promise.all([
      writeFile(administratorUrlFile, administratorUrl, { mode: 0o600 }),
      writeFile(migrationUrlFile, migrationUrl, { mode: 0o600 }),
      writeFile(migrationPasswordFile, migrationPassword, { mode: 0o600 }),
      writeFile(runtimePasswordFile, runtimePassword, { mode: 0o600 }),
    ])

    const preparationEnvironment = {
      ...process.env,
      PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: administratorUrlFile,
      PLACE_MIGRATION_DATABASE_URL_FILE: migrationUrlFile,
      PLACE_MIGRATION_DATABASE_PASSWORD_FILE: migrationPasswordFile,
      PLACE_DATABASE_PASSWORD_FILE: runtimePasswordFile,
    }

    assert.ok(npmExecutable, 'npm_execpath is required to test the public workspace command')
    const npmCommand = [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend']
    await run(process.execPath, npmCommand, {
      env: preparationEnvironment,
    })
    await run(process.execPath, npmCommand, {
      env: preparationEnvironment,
    })

    administratorClient = new Client({ connectionString: administratorUrl })
    runtimeClient = new Client({ connectionString: runtimeUrl })
    await administratorClient.connect()
    await runtimeClient.connect()

    const access = await import('../../dist/modules/access/index.js')
    runtimePool = new Pool({ connectionString: runtimeUrl, max: 2 })
    const accessStore = new access.PostgresAccessStore(runtimePool)
    const ownerPrincipal = { issuer: `urn:place:test:${suffix}`, subject: 'owner-subject' }
    const owner = await access.bootstrapInitialOwner({
      principal: ownerPrincipal,
      userGrade: 'founding-member',
      productTier: 'standard',
      authority: { verify: async () => ({ operatorReference: 'database-integration-test' }) },
      store: accessStore,
      nextMembershipId: () => '01991e60-9c4e-7a13-945a-0d224d0059c2',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })
    assert.equal(owner.authorityRole, 'owner')
    const resolvedOwner = await access.resolveAccessSubject(ownerPrincipal, accessStore)
    assert.deepEqual(resolvedOwner, { kind: 'member', membership: owner })
    await assert.rejects(
      access.bootstrapInitialOwner({
        principal: { issuer: `urn:place:test:${suffix}`, subject: 'second-owner-subject' },
        userGrade: 'founding-member',
        productTier: 'standard',
        authority: { verify: async () => ({ operatorReference: 'database-integration-test' }) },
        store: accessStore,
        nextMembershipId: () => '01991e61-06e3-7cb2-9548-29c4bdaf97af',
        now: () => new Date('2026-08-25T12:01:00.000Z'),
      }),
      access.MembershipAlreadyInitializedError,
    )

    const onboardingPrincipal = {
      issuer: `urn:place:test:${suffix}`,
      subject: 'onboarding-subject',
    }
    const requiredConsents = [
      { document: 'terms-of-service', version: '2026-08-25' },
      { document: 'privacy-policy', version: '2026-08-25' },
    ]
    const onboardingIds = [
      '01991e62-1db6-7514-a10e-8c7a7428a9b1',
      '01991e62-69d8-7cad-9e9e-7ecebd40e5ba',
    ]
    const onboardingOutcomes = await Promise.all(
      onboardingIds.map((membershipId) =>
        access.completeMembershipOnboarding({
          principal: onboardingPrincipal,
          acceptedConsents: requiredConsents,
          policy: {
            requiredConsents,
            initialUserGrade: 'newcomer',
            initialProductTier: 'free',
          },
          store: accessStore,
          nextMembershipId: () => membershipId,
          now: () => new Date('2026-08-25T12:01:30.000Z'),
        }),
      ),
    )
    assert.deepEqual(
      onboardingOutcomes.map((outcome) => outcome.status).sort(),
      ['created', 'existing'],
    )
    assert.equal(onboardingOutcomes[0].membership.authorityRole, 'member')
    assert.equal(onboardingOutcomes[0].membership.userGrade, 'newcomer')
    assert.equal(onboardingOutcomes[0].membership.productTier, 'free')
    assert.equal(onboardingOutcomes[0].membership.id, onboardingOutcomes[1].membership.id)

    const consentEvidence = await administratorClient.query(
      `
        SELECT document, version
        FROM access.membership_consents
        WHERE membership_id = $1
        ORDER BY document
      `,
      [onboardingOutcomes[0].membership.id],
    )
    assert.deepEqual(consentEvidence.rows, [
      { document: 'privacy-policy', version: '2026-08-25' },
      { document: 'terms-of-service', version: '2026-08-25' },
    ])
    const onboardingAudits = await administratorClient.query(
      `
        SELECT outcome
        FROM access.audit_events
        WHERE event_kind = 'membership-onboarding'
        ORDER BY id
      `,
    )
    assert.deepEqual(onboardingAudits.rows.map((row) => row.outcome).sort(), [
      'created',
      'existing',
    ])

    await administratorClient.query(`
      CREATE FUNCTION access.reject_created_onboarding_audit() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.event_kind = 'membership-onboarding' AND NEW.outcome = 'created' THEN
          RAISE EXCEPTION 'forced onboarding audit failure';
        END IF;
        RETURN NEW;
      END
      $$;

      CREATE TRIGGER reject_created_onboarding_audit
      BEFORE INSERT ON access.audit_events
      FOR EACH ROW EXECUTE FUNCTION access.reject_created_onboarding_audit();
    `)
    await assert.rejects(
      access.completeMembershipOnboarding({
        principal: {
          issuer: `urn:place:test:${suffix}`,
          subject: 'rolled-back-onboarding-subject',
        },
        acceptedConsents: requiredConsents,
        policy: {
          requiredConsents,
          initialUserGrade: 'newcomer',
          initialProductTier: 'free',
        },
        store: accessStore,
        nextMembershipId: () => '01991e63-9224-769e-b164-e6c0fcc33743',
        now: () => new Date('2026-08-25T12:01:45.000Z'),
      }),
    )
    const rolledBackOnboarding = await administratorClient.query(
      `SELECT 1 FROM access.memberships WHERE id = '01991e63-9224-769e-b164-e6c0fcc33743'`,
    )
    assert.equal(rolledBackOnboarding.rowCount, 0)
    await administratorClient.query(`
      DROP TRIGGER reject_created_onboarding_audit ON access.audit_events;
      DROP FUNCTION access.reject_created_onboarding_audit();
    `)

    const administratorPrincipal = {
      issuer: `urn:place:test:${suffix}`,
      subject: 'administrator-subject',
    }
    const reviewerPrincipal = {
      issuer: `urn:place:test:${suffix}`,
      subject: 'reviewer-subject',
    }
    await runtimeClient.query(
      `
        INSERT INTO access.memberships (
          id, issuer, subject, status, authority_role, user_grade, product_tier, created_at, updated_at
        )
        VALUES
          ($1, $2, $3, 'active', 'administrator', 'staff', 'standard', $4, $4),
          ($5, $2, $6, 'active', 'reviewer', 'trusted-contributor', 'standard', $4, $4)
      `,
      [
        '01991e64-0ea9-78ff-ae9e-83560c474357',
        administratorPrincipal.issuer,
        administratorPrincipal.subject,
        '2026-08-25T12:02:00.000Z',
        '01991e64-835b-7535-8319-4e367561f730',
        reviewerPrincipal.subject,
      ],
    )
    const administrator = await access.resolveAccessSubject(administratorPrincipal, accessStore)
    const changedRole = await access.changeMembershipAuthorityRole({
      actor: administrator,
      targetMembershipId: '01991e64-835b-7535-8319-4e367561f730',
      nextRole: 'member',
      store: accessStore,
      auditSink: accessStore,
      now: () => new Date('2026-08-25T12:03:00.000Z'),
    })
    assert.deepEqual(changedRole, {
      status: 'changed',
      targetMembershipId: '01991e64-835b-7535-8319-4e367561f730',
      previousRole: 'reviewer',
      nextRole: 'member',
    })
    const changedReviewer = await access.resolveAccessSubject(reviewerPrincipal, accessStore)
    assert.equal(changedReviewer.membership.authorityRole, 'member')

    const protectedOwner = await access.changeMembershipAuthorityRole({
      actor: resolvedOwner,
      targetMembershipId: owner.id,
      nextRole: 'administrator',
      store: accessStore,
      auditSink: accessStore,
      now: () => new Date('2026-08-25T12:04:00.000Z'),
    })
    assert.deepEqual(protectedOwner, {
      status: 'last-owner-protected',
      targetMembershipId: owner.id,
    })
    const ownerAfterProtectedChange = await access.resolveAccessSubject(ownerPrincipal, accessStore)
    assert.equal(ownerAfterProtectedChange.membership.authorityRole, 'owner')

    await administratorClient.query(`
      CREATE FUNCTION access.reject_changed_role_audit() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.event_kind = 'authority-role-change' AND NEW.outcome = 'changed' THEN
          RAISE EXCEPTION 'forced integration audit failure';
        END IF;
        RETURN NEW;
      END
      $$;

      CREATE TRIGGER reject_changed_role_audit
      BEFORE INSERT ON access.audit_events
      FOR EACH ROW EXECUTE FUNCTION access.reject_changed_role_audit();
    `)
    await assert.rejects(
      access.changeMembershipAuthorityRole({
        actor: administrator,
        targetMembershipId: '01991e64-835b-7535-8319-4e367561f730',
        nextRole: 'reviewer',
        store: accessStore,
        auditSink: accessStore,
        now: () => new Date('2026-08-25T12:05:00.000Z'),
      }),
    )
    const reviewerAfterAuditFailure = await access.resolveAccessSubject(
      reviewerPrincipal,
      accessStore,
    )
    assert.equal(reviewerAfterAuditFailure.membership.authorityRole, 'member')
    await administratorClient.query(`
      DROP TRIGGER reject_changed_role_audit ON access.audit_events;
      DROP FUNCTION access.reject_changed_role_audit();
    `)

    await runtimeClient.query(
      `UPDATE access.memberships SET authority_role = 'reviewer' WHERE id = $1`,
      ['01991e64-835b-7535-8319-4e367561f730'],
    )
    const conflict = await accessStore.attemptAndAuditRoleChange({
      actorMembershipId: '01991e64-0ea9-78ff-ae9e-83560c474357',
      targetMembershipId: '01991e64-835b-7535-8319-4e367561f730',
      expectedCurrentRole: 'member',
      nextRole: 'administrator',
      occurredAt: '2026-08-25T12:06:00.000Z',
    })
    assert.equal(conflict, 'conflict')
    const reviewerAfterConflict = await access.resolveAccessSubject(reviewerPrincipal, accessStore)
    assert.equal(reviewerAfterConflict.membership.authorityRole, 'reviewer')
    const hiddenUnknownMembership = await access.changeMembershipAuthorityRole({
      actor: reviewerAfterConflict,
      targetMembershipId: 'not-a-membership-id',
      nextRole: 'member',
      store: accessStore,
      auditSink: accessStore,
      now: () => new Date('2026-08-25T12:07:00.000Z'),
    })
    assert.deepEqual(hiddenUnknownMembership, { status: 'forbidden' })

    const { createProductionHttpRuntime } = await import(
      '../../dist/entrypoints/http/production-runtime.js'
    )
    const productionPrincipal = {
      issuer: `urn:place:test:${suffix}`,
      subject: 'production-http-subject',
    }
    const productionConsents = [
      { document: 'terms-of-service', version: '2026-08-26' },
      { document: 'privacy-policy', version: '2026-08-26' },
    ]
    httpRuntime = await createProductionHttpRuntime(
      {
        listener: { host: 'runtime-owned.invalid', port: 4312 },
        database: {
          connectionString: runtimeUrl,
          maxConnections: 2,
          idleTimeoutMilliseconds: 30_000,
          connectionTimeoutMilliseconds: 5_000,
        },
        authentication: {
          mode: 'oidc',
          oidc: {
            issuer: 'https://identity.example',
            audience: 'place-backend',
            jwksUri: 'https://identity.example/oauth/v2/keys',
            algorithms: ['RS256'],
            requiredScopes: ['place.read'],
          },
        },
        membershipPolicy: {
          requiredConsents: productionConsents,
          initialUserGrade: 'newcomer',
          initialProductTier: 'free',
        },
      },
      {
        createPrincipalVerifier: () => ({
          verify: async (token) => {
            if (token !== 'production-http-token') throw new Error('invalid token')
            return productionPrincipal
          },
        }),
        nextMembershipId: () => '01991e65-19ca-738a-8652-6e4bb4a63a79',
        now: () => new Date('2026-08-26T01:00:00.000Z'),
      },
    )

    const readyResponse = await httpRuntime.application.inject({
      method: 'GET',
      url: '/readyz',
    })
    assert.equal(readyResponse.statusCode, 200)
    assert.deepEqual(readyResponse.json(), { service: 'place', state: 'ok' })

    const consentsResponse = await httpRuntime.application.inject({
      method: 'GET',
      url: '/v1/membership-consents/current',
    })
    assert.equal(consentsResponse.statusCode, 200)
    assert.deepEqual(consentsResponse.json(), { consents: productionConsents })

    const onboardingResponse = await httpRuntime.application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer production-http-token' },
      payload: { acceptedConsents: productionConsents },
    })
    assert.equal(onboardingResponse.statusCode, 201)
    assert.deepEqual(onboardingResponse.json(), {
      status: 'created',
      membershipId: '01991e65-19ca-738a-8652-6e4bb4a63a79',
      authorityRole: 'member',
      userGrade: 'newcomer',
      productTier: 'free',
    })
    assert.equal(onboardingResponse.body.includes('production-http-token'), false)

    const membershipResponse = await httpRuntime.application.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer production-http-token' },
    })
    assert.equal(membershipResponse.statusCode, 200)
    assert.equal(
      membershipResponse.json().membershipId,
      '01991e65-19ca-738a-8652-6e4bb4a63a79',
    )

    const { createOidcProcessRuntime } = await import(
      '../../../apps/web/src/platform/auth/oidc-process-runtime.ts'
    )
    const encryption = {
      activeKey: {
        id: 'database-integration-key-v1',
        value: randomBytes(32),
      },
    }
    const oidcConfig = {
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      postLoginPath: '/',
      scopes: ['openid'],
      transactionTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    }
    let oidcNow = new Date('2026-08-25T12:10:00.000Z')
    const entropy = [
      'transaction-opaque-id',
      'oauth-state-secret',
      'nonce-secret',
      'pkce-verifier-secret',
      'expired-transaction-a',
      'expired-state-a',
      'expired-nonce-a',
      'expired-pkce-a',
      'expired-transaction-b',
      'expired-state-b',
      'expired-nonce-b',
      'expired-pkce-b',
    ]
    oidcRuntimeA = await createOidcProcessRuntime({
      database: {
        connectionString: runtimeUrl,
        maxConnections: 1,
        idleTimeoutMilliseconds: 30_000,
        connectionTimeoutMilliseconds: 5_000,
      },
      encryption,
      bffConfig: oidcConfig,
      cleanupBatchSize: 1,
      provider: {
        buildAuthorizationUrl: async () => 'https://identity.example/oauth/v2/authorize',
        exchangeAuthorizationCode: async () => { throw new Error('not used') },
      },
      randomValue: () => entropy.shift(),
      calculatePkceChallenge: async () => 'pkce-challenge',
      now: () => oidcNow,
    })
    const startResponse = await oidcRuntimeA.bff.start()
    assert.equal(startResponse.status, 302)
    const transactionCookie = /__Host-place_oidc_tx=([^;]+)/.exec(
      startResponse.headers.get('set-cookie') ?? '',
    )?.[1]
    assert.equal(transactionCookie, 'transaction-opaque-id')

    oidcRuntimeB = await createOidcProcessRuntime({
      database: {
        connectionString: runtimeUrl,
        maxConnections: 1,
        idleTimeoutMilliseconds: 30_000,
        connectionTimeoutMilliseconds: 5_000,
      },
      encryption,
      bffConfig: oidcConfig,
      cleanupBatchSize: 1,
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => ({
          accessToken: 'database-access-token-secret',
          refreshToken: 'database-refresh-token-secret',
          expiresAt: '2026-08-25T12:40:00.000Z',
        }),
      },
      randomValue: () => 'session-opaque-id',
      calculatePkceChallenge: async () => { throw new Error('not used') },
      now: () => oidcNow,
    })
    const callbackRequest = new Request(
      'https://place.example/api/auth/oidc/callback?code=code&state=oauth-state-secret',
      { headers: { cookie: `__Host-place_oidc_tx=${transactionCookie}` } },
    )
    const callbackResponse = await oidcRuntimeB.bff.callback(callbackRequest)
    assert.equal(callbackResponse.status, 303)
    const sessionCookie = /__Host-place_session=([^;]+)/.exec(
      callbackResponse.headers.get('set-cookie') ?? '',
    )?.[1]
    assert.equal(sessionCookie, 'session-opaque-id')
    const encryptedSession = await administratorClient.query(
      `
        SELECT encryption_key_id, initialization_vector, authentication_tag, ciphertext
        FROM browser_auth.sessions
        WHERE id = $1
      `,
      [sessionCookie],
    )
    assert.equal(encryptedSession.rows[0].encryption_key_id, 'database-integration-key-v1')
    assert.equal(encryptedSession.rows[0].initialization_vector.byteLength, 12)
    assert.equal(encryptedSession.rows[0].authentication_tag.byteLength, 16)
    assert.equal(
      encryptedSession.rows[0].ciphertext.includes(
        Buffer.from('database-access-token-secret'),
      ),
      false,
    )
    assert.equal(
      encryptedSession.rows[0].ciphertext.includes(
        Buffer.from('database-refresh-token-secret'),
      ),
      false,
    )
    const sessionRequest = new Request('https://place.example/', {
      headers: { cookie: `__Host-place_session=${sessionCookie}` },
    })
    assert.deepEqual(await oidcRuntimeA.bff.resolveSession(sessionRequest), {
      id: 'session-opaque-id',
      tokens: {
        accessToken: 'database-access-token-secret',
        refreshToken: 'database-refresh-token-secret',
        expiresAt: '2026-08-25T12:40:00.000Z',
      },
      expiresAt: '2026-08-25T12:40:00.000Z',
    })
    assert.equal((await oidcRuntimeA.bff.callback(callbackRequest)).status, 400)
    assert.equal((await oidcRuntimeA.bff.start()).status, 302)
    assert.equal((await oidcRuntimeA.bff.start()).status, 302)
    oidcNow = new Date('2026-08-25T12:50:00.000Z')
    assert.deepEqual(await oidcRuntimeA.cleanupExpired(), {
      transactionsDeleted: 1,
      sessionsDeleted: 1,
    })
    assert.deepEqual(await oidcRuntimeA.cleanupExpired(), {
      transactionsDeleted: 1,
      sessionsDeleted: 0,
    })
    assert.equal(await oidcRuntimeA.bff.resolveSession(sessionRequest), undefined)
    assert.equal((await oidcRuntimeB.bff.logout(sessionRequest)).status, 303)

    const rolesResult = await administratorClient.query(
      `
        SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname = ANY($1::text[])
        ORDER BY rolname
      `,
      [[databaseRuntime.roles.migration, databaseRuntime.roles.runtime]],
    )
    assert.deepEqual(
      rolesResult.rows,
      [databaseRuntime.roles.migration, databaseRuntime.roles.runtime]
        .sort()
        .map((rolname) => ({
          rolname,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        })),
    )
    const roleMemberships = await administratorClient.query(
      `
        SELECT 1
        FROM pg_auth_members memberships
        JOIN pg_roles members ON members.oid = memberships.member
        WHERE members.rolname = ANY($1::text[])
      `,
      [[databaseRuntime.roles.migration, databaseRuntime.roles.runtime]],
    )
    assert.equal(roleMemberships.rowCount, 0)

    const contractResult = await administratorClient.query(`
      SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version,
        (
          SELECT pg_get_userbyid(history.relowner)
          FROM pg_class history
          JOIN pg_namespace history_namespace ON history_namespace.oid = history.relnamespace
          WHERE history_namespace.nspname = 'place_migrations'
            AND history.relname = 'applied_migrations'
        ) AS migration_history_owner,
        pg_get_userbyid(c.relowner) AS table_owner,
        i.indexname,
        i.indexdef
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_indexes i
        ON i.schemaname = n.nspname
       AND i.tablename = c.relname
      WHERE n.nspname = 'places'
        AND c.relname = 'canonical_places'
        AND i.indexname = 'canonical_places_location_gist'
    `)
    assert.equal(contractResult.rowCount, 1)
    assert.match(contractResult.rows[0].postgis_version, /^3\.5\./)
    assert.equal(contractResult.rows[0].migration_history_owner, databaseRuntime.roles.migration)
    assert.equal(contractResult.rows[0].table_owner, databaseRuntime.roles.migration)
    assert.match(contractResult.rows[0].indexdef, /USING gist \(location\)/)

    await runtimeClient.query(`
      INSERT INTO places.canonical_places (id, location)
      VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
        ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326)::geography
      )
    `)
    const readablePlace = await runtimeClient.query(`
      SELECT id
      FROM places.canonical_places
      WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'
    `)
    assert.equal(readablePlace.rows[0].id, '018f47c2-4a14-7c03-b8d5-6d91791e4d7f')

    await runtimeClient.query('SET enable_seqscan = off')
    const planResult = await runtimeClient.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id
      FROM places.canonical_places
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326)::geography,
        1000
      )
    `)
    assert.match(JSON.stringify(planResult.rows[0]), /canonical_places_location_gist/)

    await expectInsufficientPrivilege(
      runtimeClient,
      'CREATE TABLE places.runtime_must_not_create_schema_objects (id bigint)',
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      `ALTER TABLE places.canonical_places OWNER TO ${databaseRuntime.roles.runtime}`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "INSERT INTO place_migrations.applied_migrations (name, run_on) VALUES ('forged', now())",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "DELETE FROM places.canonical_places WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "DELETE FROM access.memberships WHERE id = '01991e60-9c4e-7a13-945a-0d224d0059c2'",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "UPDATE access.audit_events SET outcome = 'forged'",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "UPDATE access.membership_consents SET version = 'forged'",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      'DELETE FROM access.membership_consents',
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "UPDATE browser_auth.sessions SET expires_at = now() WHERE id = 'session-opaque-id'",
    )
  } finally {
    await httpRuntime?.close().catch(() => undefined)
    await oidcRuntimeB?.close().catch(() => undefined)
    await oidcRuntimeA?.close().catch(() => undefined)
    await runtimePool?.end().catch(() => undefined)
    await runtimeClient?.end().catch(() => undefined)
    await administratorClient?.end().catch(() => undefined)
    await run('docker', ['rm', '--force', containerName]).catch(() => undefined)
    await rm(secretDirectory, { recursive: true, force: true })
  }
})
