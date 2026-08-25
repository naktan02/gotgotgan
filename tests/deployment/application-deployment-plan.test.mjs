import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const planner = path.join(repositoryRoot, 'scripts', 'plan-application-deployment.mjs')

test('deployment planner accepts only one source-bound immutable application unit', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [planner], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PLACE_DEPLOYMENT_OPERATION: 'activate',
      PLACE_RELEASE_REVISION: `place@${'a'.repeat(40)}`,
      PLACE_WEB_IMAGE: `ghcr.io/naktan02/place-web@sha256:${'b'.repeat(64)}`,
      PLACE_BACKEND_IMAGE: `ghcr.io/naktan02/place-backend@sha256:${'c'.repeat(64)}`,
    },
  })

  assert.equal(stderr, '')
  assert.deepEqual(JSON.parse(stdout), {
    schemaVersion: 'place-application-deployment-plan.v1',
    deliveryState: 'source-only',
    operation: 'activate',
    releaseRevision: `place@${'a'.repeat(40)}`,
    images: {
      web: `ghcr.io/naktan02/place-web@sha256:${'b'.repeat(64)}`,
      backend: `ghcr.io/naktan02/place-backend@sha256:${'c'.repeat(64)}`,
    },
    publicProcess: 'web',
    database: {
      preparation: 'operator-pre-runtime',
      rollback: 'application-only',
    },
  })

  await assert.rejects(
    execFileAsync(process.execPath, [planner], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PLACE_DEPLOYMENT_OPERATION: 'activate',
        PLACE_RELEASE_REVISION: `place@${'a'.repeat(40)}`,
        PLACE_WEB_IMAGE: 'registry.example/place/web:latest',
        PLACE_BACKEND_IMAGE: `registry.example/place/backend@sha256:${'c'.repeat(64)}`,
      },
    }),
    (error) =>
      error?.stderr === 'Application deployment input is invalid\n' &&
      !error.stderr.includes('latest'),
  )

  await assert.rejects(
    execFileAsync(process.execPath, [planner], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PLACE_DEPLOYMENT_OPERATION: 'activate',
        PLACE_RELEASE_REVISION: `place@${'a'.repeat(40)}`,
        PLACE_WEB_IMAGE: `../place-web@sha256:${'b'.repeat(64)}`,
        PLACE_BACKEND_IMAGE: `registry.example/place/backend@sha256:${'c'.repeat(64)}`,
      },
    }),
    (error) => error?.stderr === 'Application deployment input is invalid\n',
  )
})

test('rollback plan binds both the deployed unit and the immutable target unit', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [planner], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PLACE_DEPLOYMENT_OPERATION: 'rollback',
      PLACE_RELEASE_REVISION: `place@${'1'.repeat(40)}`,
      PLACE_WEB_IMAGE: `registry.example/place/web@sha256:${'2'.repeat(64)}`,
      PLACE_BACKEND_IMAGE: `registry.example/place/backend@sha256:${'3'.repeat(64)}`,
      PLACE_DEPLOYED_RELEASE_REVISION: `place@${'4'.repeat(40)}`,
      PLACE_DEPLOYED_WEB_IMAGE: `registry.example/place/web@sha256:${'5'.repeat(64)}`,
      PLACE_DEPLOYED_BACKEND_IMAGE: `registry.example/place/backend@sha256:${'6'.repeat(64)}`,
    },
  })

  assert.equal(stderr, '')
  const document = JSON.parse(stdout)
  assert.equal(document.operation, 'rollback')
  assert.deepEqual(document.replaces, {
    releaseRevision: `place@${'4'.repeat(40)}`,
    images: {
      web: `registry.example/place/web@sha256:${'5'.repeat(64)}`,
      backend: `registry.example/place/backend@sha256:${'6'.repeat(64)}`,
    },
  })
  assert.equal(document.database.rollback, 'application-only')
})

test('production composition consumes immutable images while local composition owns builds', async () => {
  const [baseCompose, localCompose, productionCompose, runtimeDocument] =
    await Promise.all([
      readFile(path.join(repositoryRoot, 'deploy', 'compose.yml'), 'utf8'),
      readFile(path.join(repositoryRoot, 'deploy', 'compose.local.yml'), 'utf8'),
      readFile(path.join(repositoryRoot, 'deploy', 'compose.production.yml'), 'utf8'),
      readFile(path.join(repositoryRoot, 'deploy', 'application-runtime.json'), 'utf8'),
    ])

  assert.match(
    baseCompose,
    /image: \$\{PLACE_WEB_IMAGE:\?PLACE_WEB_IMAGE is required\}/,
  )
  assert.match(
    baseCompose,
    /image: \$\{PLACE_BACKEND_IMAGE:\?PLACE_BACKEND_IMAGE is required\}/,
  )
  assert.doesNotMatch(baseCompose, /^\s+build:/m)
  assert.match(localCompose, /target: web-runtime/)
  assert.match(localCompose, /target: backend-runtime/)
  assert.doesNotMatch(productionCompose, /^\s+build:/m)
  assert.doesNotMatch(productionCompose, /^\s+ports:/m)

  const applicationRuntime = JSON.parse(runtimeDocument)
  assert.deepEqual(applicationRuntime.artifactInputs, {
    releaseRevisionEnvironment: 'PLACE_RELEASE_REVISION',
    imageEnvironments: {
      web: 'PLACE_WEB_IMAGE',
      backend: 'PLACE_BACKEND_IMAGE',
    },
    deployedUnitEnvironments: {
      releaseRevision: 'PLACE_DEPLOYED_RELEASE_REVISION',
      webImage: 'PLACE_DEPLOYED_WEB_IMAGE',
      backendImage: 'PLACE_DEPLOYED_BACKEND_IMAGE',
    },
    immutableDigestRequired: true,
  })
  assert.deepEqual(applicationRuntime.rollback, {
    unit: 'place-application',
    database: 'preserve',
    migration: 'application-only',
  })
})
