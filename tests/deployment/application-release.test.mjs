import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const releaseCli = path.join(repositoryRoot, 'scripts', 'prepare-application-release.mjs')
const smokeScript = path.join(
  repositoryRoot,
  'scripts',
  'smoke-published-application-images.mjs',
)
const digest = (character) => `sha256:${character.repeat(64)}`

async function releaseFixture(platformCharacter = 'b') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'place-release-test-'))
  const platformDigest = digest(platformCharacter)
  const index = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: platformDigest,
        platform: { os: 'linux', architecture: 'amd64' },
      },
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: digest('c'),
        platform: { os: 'unknown', architecture: 'unknown' },
        annotations: {
          'vnd.docker.reference.type': 'attestation-manifest',
          'vnd.docker.reference.digest': platformDigest,
        },
      },
    ],
  }
  const indexBytes = `${JSON.stringify(index)}\n`
  const indexPath = path.join(directory, 'index.json')
  const provenancePath = path.join(directory, 'provenance.json')
  const sbomPath = path.join(directory, 'sbom.json')
  await Promise.all([
    writeFile(indexPath, indexBytes),
    writeFile(
      provenancePath,
      JSON.stringify({
        SLSA: {
          buildDefinition: {
            buildType: 'https://mobyproject.org/buildkit@v1',
            externalParameters: {},
            internalParameters: {
              builderPlatform: 'linux/amd64',
              buildConfig: {},
            },
            resolvedDependencies: [],
          },
          runDetails: { builder: {}, metadata: {} },
        },
      }),
    ),
    writeFile(
      sbomPath,
      JSON.stringify({
        SPDX: {
          spdxVersion: 'SPDX-2.3',
          SPDXID: 'SPDXRef-DOCUMENT',
          documentNamespace: 'https://example.invalid/place-sbom',
          packages: [{ SPDXID: 'SPDXRef-Package-place', name: 'place' }],
          documentDescribes: ['SPDXRef-Package-place'],
        },
      }),
    ),
  ])
  return {
    directory,
    indexPath,
    provenancePath,
    sbomPath,
    indexDigest: `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`,
    platformDigest,
  }
}

async function inspectFixture(artifactId, image) {
  const fixture = await releaseFixture(artifactId === 'place-web' ? 'b' : 'd')
  const output = path.join(fixture.directory, artifactId)
  await execFileAsync(
    process.execPath,
    [
      releaseCli,
      'inspect-evidence',
      '--artifact-id',
      artifactId,
      '--image',
      image,
      '--index-manifest',
      fixture.indexPath,
      '--expected-index-digest',
      fixture.indexDigest,
      '--provenance',
      fixture.provenancePath,
      '--sbom',
      fixture.sbomPath,
      '--output-directory',
      output,
    ],
    { cwd: repositoryRoot },
  )
  return { ...fixture, output }
}

test('release source fixes two images, four process roles, and source-only deployment', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [releaseCli, 'verify-source', '--repository-root', repositoryRoot],
    { cwd: repositoryRoot },
  )

  assert.equal(stderr, '')
  const source = JSON.parse(stdout)
  assert.equal(source.schema_version, 'release-source.v1')
  assert.equal(source.release_id, 'place')
  assert.deepEqual(
    source.artifacts.map(({ artifact_id }) => artifact_id),
    ['place-web', 'place-backend'],
  )
  assert.deepEqual(
    source.runtime.workloads.map(({ role_id }) => role_id),
    ['web', 'backend', 'worker', 'migration'],
  )
  assert.deepEqual(source.deployment, { state: 'source-only' })
})

test('release evidence binds one linux/amd64 subject to both SBOM and provenance', async () => {
  const fixture = await inspectFixture('place-web', 'ghcr.io/naktan02/place-web')
  const [metadata, sbomSubject, provenanceSubject] = await Promise.all([
    readFile(path.join(fixture.output, 'metadata.json'), 'utf8').then(JSON.parse),
    readFile(path.join(fixture.output, 'sbom', 'subject.json'), 'utf8').then(JSON.parse),
    readFile(path.join(fixture.output, 'provenance', 'subject.json'), 'utf8').then(
      JSON.parse,
    ),
  ])

  assert.deepEqual(metadata, {
    artifact_id: 'place-web',
    image: 'ghcr.io/naktan02/place-web',
    index_digest: fixture.indexDigest,
    platform_digest: fixture.platformDigest,
  })
  assert.deepEqual(sbomSubject, metadata)
  assert.deepEqual(provenanceSubject, metadata)

  await assert.rejects(
    execFileAsync(process.execPath, [
      releaseCli,
      'inspect-evidence',
      '--artifact-id',
      'place-web',
      '--image',
      'ghcr.io/naktan02/place-web',
      '--index-manifest',
      fixture.indexPath,
      '--expected-index-digest',
      digest('f'),
      '--provenance',
      fixture.provenancePath,
      '--sbom',
      fixture.sbomPath,
      '--output-directory',
      path.join(fixture.directory, 'invalid'),
    ]),
    (error) => error?.stderr === 'Application release input is invalid\n',
  )
})

test('release record contains both platform digests and independent evidence artifacts', async () => {
  const [web, backend] = await Promise.all([
    inspectFixture('place-web', 'ghcr.io/naktan02/place-web'),
    inspectFixture('place-backend', 'ghcr.io/naktan02/place-backend'),
  ])
  const input = path.join(web.directory, 'record-input.json')
  const output = path.join(web.directory, 'release-record.v1.json')
  const checksum = (character) => character.repeat(64)
  await writeFile(
    input,
    JSON.stringify({
      schema_version: 'place-release-record-input.v1',
      repository: 'naktan02/gotgotgan',
      commit_sha: 'a'.repeat(40),
      run_id: 123,
      run_attempt: 2,
      built_at: '2026-08-26T00:00:00Z',
      artifacts: [
        {
          artifact_id: 'place-web',
          evidence_directory: web.output,
          sbom: { artifact_id: 11, sha256: checksum('1') },
          provenance: { artifact_id: 12, sha256: checksum('2') },
        },
        {
          artifact_id: 'place-backend',
          evidence_directory: backend.output,
          sbom: { artifact_id: 13, sha256: checksum('3') },
          provenance: { artifact_id: 14, sha256: checksum('4') },
        },
      ],
    }),
  )

  await execFileAsync(process.execPath, [
    releaseCli,
    'create-record',
    '--repository-root',
    repositoryRoot,
    '--input',
    input,
    '--output',
    output,
  ])
  const record = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(record.release_revision, `place@${'a'.repeat(40)}`)
  assert.deepEqual(
    record.artifacts.map((artifact) => ({
      id: artifact.artifact_id,
      digest: artifact.location.digest,
      sbom: artifact.sbom.location.artifact_id,
      provenance: artifact.provenance.location.artifact_id,
    })),
    [
      { id: 'place-web', digest: web.platformDigest, sbom: 11, provenance: 12 },
      {
        id: 'place-backend',
        digest: backend.platformDigest,
        sbom: 13,
        provenance: 14,
      },
    ],
  )
  assert.notEqual(record.artifacts[0].sbom.location.artifact_id, record.artifacts[1].sbom.location.artifact_id)
})

test('published-image smoke accepts only both Place platform digests', async () => {
  const module = await import(pathToFileURL(smokeScript))
  const calls = []
  const runDocker = async (arguments_) => {
    calls.push(arguments_)
    if (arguments_[0] === 'image' && arguments_[1] === 'inspect') {
      const format = arguments_[3]
      if (format.includes('Labels')) {
        return {
          stdout: `${JSON.stringify({
            'org.opencontainers.image.source': 'https://github.com/naktan02/gotgotgan',
            'org.opencontainers.image.revision': 'a'.repeat(40),
          })}\n`,
        }
      }
      return { stdout: '"node"\n' }
    }
    return { stdout: '' }
  }
  const output = path.join(await mkdtemp(path.join(os.tmpdir(), 'place-smoke-')), 'smoke.json')
  const webImage = `ghcr.io/naktan02/place-web@${digest('b')}`
  const backendImage = `ghcr.io/naktan02/place-backend@${digest('c')}`

  await module.smokePublishedApplicationImages(
    { webImage, backendImage, commit: 'a'.repeat(40), output },
    runDocker,
  )
  assert.equal(calls.filter(([command]) => command === 'pull').length, 2)
  assert.equal(
    calls.some((arguments_) => arguments_.includes('ghcr.io/naktan02/place-web:latest')),
    false,
  )
  assert.equal(JSON.parse(await readFile(output, 'utf8')).releaseRevision, `place@${'a'.repeat(40)}`)

  await assert.rejects(
    module.smokePublishedApplicationImages(
      {
        webImage: 'ghcr.io/naktan02/place-web:latest',
        backendImage,
        commit: 'a'.repeat(40),
        output,
      },
      runDocker,
    ),
    /invalid published application image input/,
  )
})

test('manual release workflow gates on same-commit CI and has no deployment authority', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'release-application.yml'),
    'utf8',
  )
  const triggerBlock = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:'))
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(triggerBlock, /^  push:/m)
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/)
  assert.match(workflow, /head_sha=\$GITHUB_SHA/)
  assert.match(workflow, /provenance: mode=max,version=v1/g)
  assert.match(workflow, /sbom: true/g)
  assert.match(workflow, /smoke-published-application-images\.mjs/)
  assert.doesNotMatch(workflow, /kubeconfig|kubectl|argocd|promotion-request/i)
})
