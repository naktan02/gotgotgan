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

async function expectDatabaseError(client, sql, code) {
  await assert.rejects(client.query(sql), (error) => error?.code === code)
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

    const platformOwnerPrincipal = {
      issuer: `urn:place:test:${suffix}`,
      subject: 'platform-owner-subject',
    }
    const platformOwnerOnboarding = await access.completeMembershipOnboarding({
      principal: platformOwnerPrincipal,
      acceptedConsents: requiredConsents,
      policy: {
        requiredConsents,
        initialUserGrade: 'founding-member',
        initialProductTier: 'standard',
      },
      platformEntitlement: {
        roles: ['platform_owner'],
        revision: 10,
        ownerRevision: 1,
        expiresAt: '2026-08-25T12:20:00.000Z',
      },
      store: accessStore,
      nextMembershipId: () => '01991e65-835b-7535-8319-4e367561f731',
      now: () => new Date('2026-08-25T12:08:00.000Z'),
    })
    assert.equal(platformOwnerOnboarding.membership.authorityRole, 'owner')
    const replacedBootstrapOwner = await access.resolveAccessSubject(ownerPrincipal, accessStore)
    assert.equal(replacedBootstrapOwner.membership.authorityRole, 'member')

    const centrallyManaged = await access.changeMembershipAuthorityRole({
      actor: { kind: 'member', membership: platformOwnerOnboarding.membership },
      targetMembershipId: platformOwnerOnboarding.membership.id,
      nextRole: 'administrator',
      store: accessStore,
      auditSink: accessStore,
      now: () => new Date('2026-08-25T12:09:00.000Z'),
    })
    assert.deepEqual(centrallyManaged, {
      status: 'centrally-managed',
      targetMembershipId: platformOwnerOnboarding.membership.id,
    })

    await access.synchronizePlatformOwner({
      principal: onboardingPrincipal,
      evidence: {
        roles: ['platform_owner'],
        revision: 11,
        ownerRevision: 2,
        expiresAt: '2026-08-25T12:20:00.000Z',
      },
      store: accessStore,
      now: () => new Date('2026-08-25T12:10:00.000Z'),
    })
    const previousPlatformOwner = await access.resolveAccessSubject(
      platformOwnerPrincipal,
      accessStore,
    )
    const currentPlatformOwner = await access.resolveAccessSubject(
      onboardingPrincipal,
      accessStore,
    )
    assert.equal(previousPlatformOwner.membership.authorityRole, 'member')
    assert.equal(currentPlatformOwner.membership.authorityRole, 'owner')
    const ownerCount = await administratorClient.query(
      "SELECT count(*)::integer AS count FROM access.memberships WHERE authority_role = 'owner'",
    )
    assert.equal(ownerCount.rows[0].count, 1)

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
    assert.deepEqual(readyResponse.json(), {
      schemaVersion: 'place-process-status.v1', service: 'place', state: 'ok',
    })

    const consentsResponse = await httpRuntime.application.inject({
      method: 'GET',
      url: '/v1/membership-consents/current',
    })
    assert.equal(consentsResponse.statusCode, 200)
    assert.deepEqual(consentsResponse.json(), {
      schemaVersion: 'place-membership-consents.v1', consents: productionConsents,
    })

    const onboardingResponse = await httpRuntime.application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer production-http-token' },
      payload: { acceptedConsents: productionConsents },
    })
    assert.equal(onboardingResponse.statusCode, 201)
    assert.deepEqual(onboardingResponse.json(), {
      schemaVersion: 'place-membership-onboarding-result.v1',
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
        (SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm') AS pg_trgm_version,
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
    assert.match(contractResult.rows[0].pg_trgm_version, /^1\./)
    assert.equal(contractResult.rows[0].migration_history_owner, databaseRuntime.roles.migration)
    assert.equal(contractResult.rows[0].table_owner, databaseRuntime.roles.migration)
    assert.match(contractResult.rows[0].indexdef, /USING gist \(location\)/)

    const collectionFirstContract = await administratorClient.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'library' AND table_name = 'collections'
            AND column_name = 'revision' AND data_type = 'bigint'
        ) AS has_collection_revision,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'library' AND table_name = 'place_preferences'
            AND column_name = 'rating_revision' AND data_type = 'bigint'
        ) AS has_rating_revision,
        to_regclass('library.member_revisions') IS NOT NULL AS has_member_revisions,
        to_regclass('library.operation_receipts_v2') IS NOT NULL AS has_operation_receipts,
        to_regclass('library.import_source_list_bindings') IS NOT NULL AS has_source_bindings,
        to_regclass('library.publication_copy_operations') IS NOT NULL AS has_copy_operations,
        to_regclass('library.publication_copy_items') IS NOT NULL AS has_copy_items
    `)
    assert.deepEqual(collectionFirstContract.rows[0], {
      has_collection_revision: true,
      has_rating_revision: true,
      has_member_revisions: true,
      has_operation_receipts: true,
      has_source_bindings: true,
      has_copy_operations: true,
      has_copy_items: true,
    })

    const canonicalKnowledgeContract = await administratorClient.query(`
      SELECT
        to_regclass('places.canonical_place_fact_assertion_batches') IS NOT NULL
          AS has_assertion_batches,
        to_regclass('places.canonical_place_profile_revisions') IS NOT NULL
          AS has_profile_revisions,
        to_regclass('areas.area_identities') IS NOT NULL AS has_area_identities,
        to_regclass('areas.area_node_versions') IS NOT NULL AS has_area_versions,
        to_regclass('taxonomy.provider_category_mapping_versions') IS NOT NULL
          AS has_provider_category_mappings,
        to_regclass('places.canonical_place_profile_taxonomy') IS NOT NULL
          AS has_profile_taxonomy,
        to_regclass('places.canonical_place_profile_areas') IS NOT NULL
          AS has_profile_areas,
        to_regclass('media.place_media_sources') IS NOT NULL AS has_media_sources,
        to_regclass('media.media_rights_revisions') IS NOT NULL AS has_media_rights,
        to_regclass('places.canonical_place_profile_media') IS NOT NULL
          AS has_profile_media,
        to_regclass('media.current_displayable_place_media') IS NOT NULL
          AS has_displayable_media_view,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_fact_assertion_batches'
            AND column_name = 'rights_profile_key'
        ) AS has_versioned_rights_profile_key,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_fact_assertions'
            AND column_name = 'opening_hours_value'
        ) AS has_opening_hours_assertion,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_fact_assertions'
            AND column_name = 'confidence'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_fact_assertion_batches'
            AND column_name = 'confidence'
        ) AS has_assertion_specific_confidence,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_profile_revisions'
            AND column_name = 'opening_hours'
        ) AS has_opening_hours_profile,
        NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'places'
            AND table_name = 'canonical_place_profile_revisions'
            AND column_name = 'time_zone'
        ) AS has_no_legacy_time_zone_fact,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'areas' AND table_name = 'area_node_versions'
            AND column_name = 'default_language_tag'
        ) AS has_area_default_language,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'areas' AND table_name = 'area_node_versions'
            AND column_name = 'previous_version'
        ) AS has_area_revision_link,
        NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'places.canonical_place_profile_operations'::regclass
            AND contype = 'f'
            AND confrelid = 'places.canonical_places'::regclass
        ) AS operation_request_place_is_not_foreign_keyed,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'places.canonical_place_profile_operations'::regclass
            AND contype = 'f'
            AND confrelid = 'places.canonical_place_profile_revisions'::regclass
        ) AS applied_operation_references_profile,
        obj_description(
          'places.canonical_place_fact_assertion_batches'::regclass, 'pg_class'
        ) AS assertion_batch_comment,
        (
          SELECT string_agg(pg_get_constraintdef(oid), ' ' ORDER BY conname)
          FROM pg_constraint
          WHERE conrelid = 'places.canonical_place_fact_assertions'::regclass
            AND contype = 'c'
        ) AS assertion_checks,
        pg_get_viewdef('media.current_displayable_place_media'::regclass, true)
          AS displayable_media_definition
    `)
    const knowledgeContract = canonicalKnowledgeContract.rows[0]
    for (const [key, value] of Object.entries(knowledgeContract)) {
      if (key.endsWith('_comment') || key.endsWith('_checks') || key.endsWith('_definition')) continue
      assert.equal(value, true, `${key} must be present`)
    }
    assert.match(knowledgeContract.assertion_batch_comment, /one subject and one immutable Source Observation/)
    assert.match(knowledgeContract.assertion_checks, /'name'/)
    assert.match(knowledgeContract.assertion_checks, /'opening-hours'/)
    assert.match(knowledgeContract.assertion_checks, /'taxonomy'/)
    assert.match(knowledgeContract.assertion_checks, /'area'/)
    assert.match(knowledgeContract.assertion_checks, /'media'/)
    assert.doesNotMatch(knowledgeContract.assertion_checks, /'time-zone'/)
    assert.match(knowledgeContract.displayable_media_definition, /state = 'allowed'/)
    assert.match(knowledgeContract.displayable_media_definition, /current_rights_revision/)

    await expectInsufficientPrivilege(
      runtimeClient,
      `UPDATE library.import_source_list_bindings
       SET owner_membership_id = '01991e60-9c4e-7a13-945a-0d224d0059c2'`,
    )

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

    await runtimeClient.query(`
      INSERT INTO places.canonical_place_profile_operations (
        operation_id, operation_fingerprint, canonical_place_id,
        expected_previous_revision, resulting_revision, outcome, rejection_code,
        rationale, result, occurred_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0516', repeat('6', 64),
        '018f47c2-4a14-7c03-b8d5-6d91791e0fff', NULL, NULL, 'rejected',
        'place-unavailable',
        'Place availability check failed during profile publication.',
        '{"code":"place-unavailable"}'::jsonb, '2026-08-25T12:10:00.000Z'
      )
    `)
    const unavailableReceipt = await runtimeClient.query(`
      SELECT outcome, rejection_code
      FROM places.canonical_place_profile_operations
      WHERE operation_id = '018f47c2-4a14-7c03-b8d5-6d91791e0516'
    `)
    assert.deepEqual(unavailableReceipt.rows[0], {
      outcome: 'rejected',
      rejection_code: 'place-unavailable',
    })

    await runtimeClient.query(`
      INSERT INTO ingestion.source_observations (
        id, provider_key, external_place_id, acquisition_kind, payload_checksum,
        parser_version, observed_at, acquired_at, facts, confidence, fingerprint
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0510', 'google', 'provider-place-1',
        'documented-api', repeat('a', 64), 'provider-parser.v1',
        '2026-08-25T12:00:00.000Z', '2026-08-25T12:01:00.000Z',
        '{}'::jsonb, 0.950, repeat('b', 64)
      )
    `)
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO places.canonical_place_fact_assertion_batches (
         id, subject_kind, provider_key, external_place_id, source_observation_id,
         rights_profile_key, asserted_by_kind, asserted_by_reference,
         observed_at, fingerprint, recorded_at
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e0520', 'provider-identity',
         'naver', 'different-place', '018f47c2-4a14-7c03-b8d5-6d91791e0510',
         'provider.standard.v1', 'policy', 'integration-test',
         '2026-08-25T12:00:00.000Z',
         repeat('c', 64), '2026-08-25T12:02:00.000Z'
       )`,
      '23514',
    )
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO places.canonical_place_fact_assertion_batches (
         id, subject_kind, canonical_place_id, source_observation_id,
         rights_profile_key, asserted_by_kind, asserted_by_reference,
         observed_at, fingerprint, recorded_at
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e0521', 'canonical-place',
         '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
         '018f47c2-4a14-7c03-b8d5-6d91791e0510', 'provider.standard',
         'policy', 'integration-test',
         '2026-08-25T12:00:00.000Z',
         repeat('d', 64), '2026-08-25T12:02:00.000Z'
       )`,
      '23514',
    )

    await runtimeClient.query(`
      INSERT INTO places.canonical_place_fact_assertion_batches (
        id, subject_kind, canonical_place_id, source_observation_id,
        rights_profile_key, asserted_by_kind, asserted_by_reference,
        observed_at, fingerprint, recorded_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'canonical-place',
        '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
        '018f47c2-4a14-7c03-b8d5-6d91791e0510', 'provider.standard.v1',
        'policy', 'integration-test',
        '2026-08-25T12:00:00.000Z',
        repeat('e', 64), '2026-08-25T12:02:00.000Z'
      )
    `)
    await runtimeClient.query(`
      INSERT INTO places.canonical_place_fact_assertions (
        id, batch_id, fact_kind, text_value, confidence, fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0512',
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'name', '통합 테스트 장소',
        0.930, repeat('f', 64), '2026-08-25T12:02:00.000Z'
      )
    `)
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO places.canonical_place_fact_assertions (
         id, batch_id, fact_kind, opening_hours_value, confidence, fingerprint, created_at
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e0522',
         '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'opening-hours',
         '{"timeZone":"Asia/Seoul","weeklyPeriods":[]}'::jsonb,
         0.810, repeat('0', 64), '2026-08-25T12:02:00.000Z'
       )`,
      '23514',
    )
    await runtimeClient.query(`
      INSERT INTO places.canonical_place_fact_assertions (
        id, batch_id, fact_kind, opening_hours_value, confidence, fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0513',
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'opening-hours',
        '{"timeZone":"Asia/Seoul","weeklyPeriods":[{"opens":{"dayOfWeek":"monday","localTime":"09:00"},"closes":{"dayOfWeek":"monday","localTime":"18:00"}}]}'::jsonb,
        0.870, repeat('1', 64), '2026-08-25T12:02:00.000Z'
      )
    `)
    await runtimeClient.query(`
      INSERT INTO places.canonical_place_fact_assertions (
        id, batch_id, fact_kind, taxonomy_value, confidence, fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0523',
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'taxonomy',
        '{"key":"food.ramen","version":1,"role":"primary"}'::jsonb,
        0.840, repeat('2', 64), '2026-08-25T12:02:00.000Z'
      );
      INSERT INTO places.canonical_place_fact_assertions (
        id, batch_id, fact_kind, area_value, confidence, fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0524',
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'area',
        '{"key":"area:seoul","version":1,"role":"primary"}'::jsonb,
        0.880, repeat('3', 64), '2026-08-25T12:02:00.000Z'
      );
      INSERT INTO places.canonical_place_fact_assertions (
        id, batch_id, fact_kind, media_value, confidence, fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0525',
        '018f47c2-4a14-7c03-b8d5-6d91791e0511', 'media',
        '{"externalUri":"https://example.invalid/transient-photo","size":{"width":1200,"height":800},"rightsState":"attribution-required","requiredAttributions":[{"label":"Provider source","uri":"https://example.invalid/source"}]}'::jsonb,
        0.760, repeat('4', 64), '2026-08-25T12:02:00.000Z'
      )
    `)
    await runtimeClient.query(`
      INSERT INTO taxonomy.node_versions (
        node_key, version, parent_key, label, kind, active, effective_at
      ) VALUES (
        'food.ramen', 1, NULL, '라멘', 'category', true,
        '2026-08-25T12:00:00.000Z'
      );
      INSERT INTO areas.area_identities (area_key, created_at) VALUES
        ('area:kr', '2026-08-25T12:00:00.000Z'),
        ('area:seoul', '2026-08-25T12:00:00.000Z'),
        ('area:invalid-language', '2026-08-25T12:00:00.000Z'),
        ('area:inactive-country', '2026-08-25T12:00:00.000Z'),
        ('area:inactive-child', '2026-08-25T12:00:00.000Z');
      INSERT INTO areas.area_node_versions (
        area_key, version, previous_version, parent_area_key, country_code, kind,
        localized_names, default_language_tag, active, effective_at, fingerprint
      ) VALUES
        ('area:kr', 1, NULL, NULL, 'KR', 'country', '{"ko":"대한민국"}',
         'ko', true, '2026-08-25T12:00:00.000Z', repeat('a', 64)),
        ('area:seoul', 1, NULL, 'area:kr', 'KR', 'locality', '{"ko":"서울"}',
         'ko', true, '2026-08-25T12:00:00.000Z', repeat('b', 64)),
        ('area:inactive-country', 1, NULL, NULL, 'ZZ', 'country',
         '{"en":"Inactive"}', 'en', false, '2026-08-25T12:00:00.000Z', repeat('c', 64));
      INSERT INTO media.place_media_sources (
        media_id, canonical_place_id, source_observation_id, source_assertion_id,
        source_kind, provider_key, provider_media_identity, media_type, width, height,
        observed_at, source_fingerprint, created_at
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0515',
        '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
        '018f47c2-4a14-7c03-b8d5-6d91791e0510',
        '018f47c2-4a14-7c03-b8d5-6d91791e0525', 'provider-media',
        'google', 'photos/opaque-media-1', 'image', 1200, 800,
        '2026-08-25T12:00:00.000Z', repeat('7', 64), '2026-08-25T12:05:00.000Z'
      )
    `)

    await runtimeClient.query('BEGIN')
    try {
      await runtimeClient.query(`
        INSERT INTO places.canonical_place_profile_revisions (
          canonical_place_id, revision, operation_id, expected_previous_revision,
          display_name, opening_hours, operational_status,
          policy_version, rationale, published_by_kind, published_by_reference,
          published_at, fingerprint
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1,
          '018f47c2-4a14-7c03-b8d5-6d91791e0514', NULL, '통합 테스트 장소',
          '{"timeZone":"Asia/Seoul","weeklyPeriods":[{"opens":{"dayOfWeek":"monday","localTime":"09:00"},"closes":{"dayOfWeek":"monday","localTime":"18:00"}}]}'::jsonb,
          NULL, 'catalog-policy.v1', 'Selected verified provider evidence.',
          'policy', 'integration-test',
          '2026-08-25T12:03:00.000Z', repeat('2', 64)
        );
        INSERT INTO places.canonical_place_profile_evidence (
          canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
        ) VALUES
          ('018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1, 'name',
           '018f47c2-4a14-7c03-b8d5-6d91791e0512', 'selected'),
          ('018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1, 'opening-hours',
           '018f47c2-4a14-7c03-b8d5-6d91791e0513', 'selected');
        INSERT INTO places.canonical_place_profile_taxonomy (
          canonical_place_id, profile_revision, node_key, node_version,
          assignment_role, ordinal, source_assertion_id
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1,
          'food.ramen', 1, 'primary', 0,
          '018f47c2-4a14-7c03-b8d5-6d91791e0523'
        );
        INSERT INTO places.canonical_place_profile_areas (
          canonical_place_id, profile_revision, area_key, area_version,
          assignment_role, ordinal, source_assertion_id
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1,
          'area:seoul', 1, 'primary', 0,
          '018f47c2-4a14-7c03-b8d5-6d91791e0524'
        );
        INSERT INTO places.canonical_place_profile_media (
          canonical_place_id, profile_revision, media_id, source_assertion_id, ordinal
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1,
          '018f47c2-4a14-7c03-b8d5-6d91791e0515',
          '018f47c2-4a14-7c03-b8d5-6d91791e0525', 0
        );
        INSERT INTO places.canonical_place_profile_operations (
          operation_id, operation_fingerprint, canonical_place_id,
          expected_previous_revision, resulting_revision, outcome, acceptance_status,
          rationale, result, occurred_at
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e0514', repeat('3', 64),
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', NULL, 1, 'accepted', 'applied',
          'Selected verified provider evidence.',
          '{"status":"published"}'::jsonb, '2026-08-25T12:03:00.000Z'
        );
        SELECT places.activate_canonical_place_profile(
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', NULL, 1
        );
      `)
      await runtimeClient.query('COMMIT')
    } catch (error) {
      await runtimeClient.query('ROLLBACK')
      throw error
    }

    await runtimeClient.query('BEGIN')
    try {
      await runtimeClient.query(`
        INSERT INTO places.canonical_place_profile_revisions (
          canonical_place_id, revision, operation_id, expected_previous_revision,
          display_name, opening_hours, operational_status,
          policy_version, rationale, published_by_kind, published_by_reference,
          published_at, fingerprint
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 2,
          '018f47c2-4a14-7c03-b8d5-6d91791e0517', 1, '통합 테스트 장소',
          '{"timeZone":"Asia/Seoul","weeklyPeriods":[{"opens":{"dayOfWeek":"monday","localTime":"09:00"},"closes":{"dayOfWeek":"monday","localTime":"20:00"}}]}'::jsonb,
          NULL, 'catalog-policy.v1', 'Selected updated opening hours.',
          'policy', 'integration-test',
          '2026-08-25T12:04:00.000Z', repeat('4', 64)
        );
        INSERT INTO places.canonical_place_profile_evidence (
          canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
        ) VALUES
          ('018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 2, 'name',
           '018f47c2-4a14-7c03-b8d5-6d91791e0512', 'selected'),
          ('018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 2, 'opening-hours',
           '018f47c2-4a14-7c03-b8d5-6d91791e0513', 'selected');
        INSERT INTO places.canonical_place_profile_operations (
          operation_id, operation_fingerprint, canonical_place_id,
          expected_previous_revision, resulting_revision, outcome, acceptance_status,
          rationale, result, occurred_at
        ) VALUES (
          '018f47c2-4a14-7c03-b8d5-6d91791e0517', repeat('5', 64),
          '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1, 2, 'accepted', 'applied',
          'Selected updated opening hours.',
          '{"status":"published"}'::jsonb, '2026-08-25T12:04:00.000Z'
        )
      `)
      await expectDatabaseError(
        runtimeClient,
        `SELECT places.activate_canonical_place_profile(
           '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1, 2
         )`,
        '23514',
      )
    } finally {
      await runtimeClient.query('ROLLBACK')
    }

    await runtimeClient.query(`
      INSERT INTO media.media_rights_revisions (
        media_id, revision, state, basis, attribution_required, valid_from,
        decided_by_kind, decided_by_reference, decided_at, fingerprint
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0515', 1, 'pending', 'unknown', false,
        '2026-08-25T12:00:00.000Z', 'policy', 'integration-test',
        '2026-08-25T12:05:00.000Z', repeat('8', 64)
      );
      SELECT media.activate_media_rights(
        '018f47c2-4a14-7c03-b8d5-6d91791e0515', 1
      );
    `)
    const pendingMedia = await runtimeClient.query(`
      SELECT media_id FROM media.current_displayable_place_media
      WHERE media_id = '018f47c2-4a14-7c03-b8d5-6d91791e0515'
    `)
    assert.equal(pendingMedia.rowCount, 0)
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO media.place_media_sources (
         media_id, canonical_place_id, source_observation_id, source_assertion_id,
         source_kind, provider_key, provider_media_identity, media_type,
         observed_at, source_fingerprint, created_at
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e0526',
         '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
         '018f47c2-4a14-7c03-b8d5-6d91791e0510',
         '018f47c2-4a14-7c03-b8d5-6d91791e0525', 'provider-media',
         'naver', 'photos/provider-mismatch', 'image',
         '2026-08-25T12:00:00.000Z', repeat('6', 64),
         '2026-08-25T12:05:00.000Z'
       )`,
      '23514',
    )

    await runtimeClient.query(`
      INSERT INTO media.media_rights_revisions (
        media_id, revision, state, allowed_surfaces, basis,
        attribution_required, valid_from, decided_by_kind,
        decided_by_reference, decided_at, fingerprint
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0515', 2, 'allowed',
        ARRAY['place-detail'], 'provider-terms', true,
        '2026-08-25T12:00:00.000Z', 'policy', 'integration-test',
        '2026-08-25T12:06:00.000Z', repeat('9', 64)
      )
    `)
    await expectDatabaseError(
      runtimeClient,
      `SELECT media.activate_media_rights(
         '018f47c2-4a14-7c03-b8d5-6d91791e0515', 2
       )`,
      '23514',
    )
    await runtimeClient.query(`
      INSERT INTO media.media_rights_attributions (
        media_id, rights_revision, ordinal, label, uri
      ) VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e0515', 2, 0,
        'Provider source', 'https://example.invalid/source'
      );
      SELECT media.activate_media_rights(
        '018f47c2-4a14-7c03-b8d5-6d91791e0515', 2
      );
    `)
    const displayableMedia = await runtimeClient.query(`
      SELECT provider_key, provider_media_identity, allowed_surfaces,
             attribution_required, attributions
      FROM media.current_displayable_place_media
      WHERE media_id = '018f47c2-4a14-7c03-b8d5-6d91791e0515'
    `)
    assert.equal(displayableMedia.rowCount, 1)
    assert.equal(displayableMedia.rows[0].provider_key, 'google')
    assert.equal(displayableMedia.rows[0].provider_media_identity, 'photos/opaque-media-1')
    assert.deepEqual(displayableMedia.rows[0].allowed_surfaces, ['place-detail'])
    assert.equal(displayableMedia.rows[0].attribution_required, true)
    assert.deepEqual(displayableMedia.rows[0].attributions, [
      { label: 'Provider source', uri: 'https://example.invalid/source' },
    ])
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO media.place_media_sources (
         media_id, canonical_place_id, source_observation_id, source_assertion_id, source_kind,
         provider_key, provider_media_identity, media_type,
         observed_at, source_fingerprint, created_at
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e0518',
         '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
         '018f47c2-4a14-7c03-b8d5-6d91791e0510',
         '018f47c2-4a14-7c03-b8d5-6d91791e0525', 'provider-media',
         'google', 'https://temporary.example/photo.jpg', 'image',
         '2026-08-25T12:00:00.000Z', repeat('0', 64), '2026-08-25T12:05:00.000Z'
       )`,
      '23514',
    )
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO areas.area_node_versions (
         area_key, version, previous_version, parent_area_key, country_code, kind,
         localized_names, default_language_tag, active, effective_at, fingerprint
       ) VALUES (
         'area:invalid-language', 1, NULL, 'area:kr', 'KR', 'locality',
         '{"ko":"잘못된 기본 언어"}', 'en', true,
         '2026-08-25T12:00:00.000Z', repeat('d', 64)
       )`,
      '23514',
    )
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO places.canonical_place_profile_areas (
         canonical_place_id, profile_revision, area_key, area_version,
         assignment_role, ordinal, source_assertion_id
       ) VALUES (
         '018f47c2-4a14-7c03-b8d5-6d91791e4d7f', 1,
         'area:seoul', 1, 'primary', 1,
         '018f47c2-4a14-7c03-b8d5-6d91791e0524'
       )`,
      '23514',
    )
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO areas.area_node_versions (
         area_key, version, previous_version, parent_area_key, country_code, kind,
         localized_names, default_language_tag, active, effective_at, fingerprint
       ) VALUES (
         'area:seoul', 3, 2, 'area:kr', 'KR', 'locality', '{"ko":"서울"}',
         'ko', true, '2026-08-25T12:01:00.000Z', repeat('e', 64)
       )`,
      '23503',
    )
    await expectDatabaseError(
      runtimeClient,
      `INSERT INTO areas.area_node_versions (
         area_key, version, previous_version, parent_area_key, country_code, kind,
         localized_names, default_language_tag, active, effective_at, fingerprint
       ) VALUES (
         'area:inactive-child', 1, NULL, 'area:inactive-country', 'ZZ', 'locality',
         '{"en":"Child"}', 'en', true,
         '2026-08-25T12:00:00.000Z', repeat('f', 64)
       )`,
      '23514',
    )

    await expectInsufficientPrivilege(
      runtimeClient,
      `UPDATE places.canonical_places
       SET location = ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography
       WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      `UPDATE places.canonical_place_fact_assertion_batches
       SET asserted_by_reference = 'forged'`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      `DELETE FROM places.canonical_place_profile_operations
       WHERE operation_id = '018f47c2-4a14-7c03-b8d5-6d91791e0516'`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      `UPDATE media.place_media_sources SET current_rights_revision = 1
       WHERE media_id = '018f47c2-4a14-7c03-b8d5-6d91791e0515'`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      'UPDATE areas.area_node_versions SET active = false',
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      'UPDATE taxonomy.provider_category_mapping_versions SET active = false',
    )

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
