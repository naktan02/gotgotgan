import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

const repository = 'naktan02/place'
const releaseId = 'place'
const declarationPath = 'deploy/release-source.v1.json'
const workflowPath = '.github/workflows/release-application.yml'
const commitPattern = /^[0-9a-f]{40}$/
const digestPattern = /^sha256:[0-9a-f]{64}$/
const checksumPattern = /^(?:sha256:)?([0-9a-f]{64})$/
const indexMediaTypes = new Set([
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
])
const manifestMediaTypes = new Set([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
])

const artifacts = [
  {
    artifactId: 'place-web',
    image: 'ghcr.io/naktan02/place-web',
    repository: 'naktan02/place-web',
    workloadRoles: ['web'],
  },
  {
    artifactId: 'place-backend',
    image: 'ghcr.io/naktan02/place-backend',
    repository: 'naktan02/place-backend',
    workloadRoles: ['backend', 'worker', 'migration'],
  },
]

const expectedReleaseSource = {
  schema_version: 'release-source.v1',
  release_id: releaseId,
  owner: { repository, module_path: 'deploy' },
  delivery_kind: 'runtime',
  artifacts: [
    {
      artifact_id: 'place-web',
      kind: 'container-image',
      build: {
        context_path: '.',
        dockerfile_path: 'Dockerfile',
        target: 'web-runtime',
        platforms: ['linux/amd64'],
      },
      workload_roles: ['web'],
    },
    {
      artifact_id: 'place-backend',
      kind: 'container-image',
      build: {
        context_path: '.',
        dockerfile_path: 'Dockerfile',
        target: 'backend-runtime',
        platforms: ['linux/amd64'],
      },
      workload_roles: ['backend', 'worker', 'migration'],
    },
  ],
  deployment: { state: 'source-only' },
  runtime: {
    workloads: [
      {
        role_id: 'web',
        artifact_id: 'place-web',
        classification: 'public',
        health: { protocol: 'http', port: 3000, path: '/healthz' },
        readiness: { protocol: 'http', port: 3000, path: '/readyz' },
      },
      {
        role_id: 'backend',
        artifact_id: 'place-backend',
        classification: 'internal',
        health: { protocol: 'http', port: 8080, path: '/healthz' },
        readiness: { protocol: 'http', port: 8080, path: '/readyz' },
      },
      { role_id: 'worker', artifact_id: 'place-backend', classification: 'worker' },
      { role_id: 'migration', artifact_id: 'place-backend', classification: 'batch' },
    ],
    migration: {
      owner: 'project',
      workload_role: 'migration',
      execution: 'pre-runtime-once',
      identity: 'source-commit-prefix-20',
      failure_policy: 'hold-runtime',
      rollback_policy: 'application-only',
      cleanup_policy: 'retain-success',
    },
  },
  required_configuration_names: [
    'PLACE_AUTH_MODE',
    'PLACE_BACKEND_ORIGIN',
    'PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS',
    'PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS',
    'PLACE_DATABASE_MAX_CONNECTIONS',
    'PLACE_HTTP_HOST',
    'PLACE_HTTP_PORT',
    'PLACE_IMPORT_BACKEND_TIMEOUT_MILLISECONDS',
    'PLACE_CONNECTOR_BACKEND_TIMEOUT_MILLISECONDS',
    'PLACE_CONNECTOR_CAPTURE_RETENTION_SECONDS',
    'PLACE_CONNECTOR_GRANT_TTL_SECONDS',
    'PLACE_CONNECTOR_MAXIMUM_BATCHES',
    'PLACE_CONNECTOR_MAXIMUM_BATCH_BYTES',
    'PLACE_CONNECTOR_MAXIMUM_BYTES',
    'PLACE_CONNECTOR_MAXIMUM_ITEMS',
    'PLACE_CONNECTOR_PUBLIC_ORIGIN',
    'PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS',
    'PLACE_MEMBERSHIP_POLICY_FILE',
    'PLACE_OIDC_AUDIENCE',
    'PLACE_OIDC_CALLBACK_URL',
    'PLACE_OIDC_CLIENT_ID',
    'PLACE_OIDC_CLEANUP_BATCH_SIZE',
    'PLACE_OIDC_CLEANUP_INTERVAL_SECONDS',
    'PLACE_OIDC_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS',
    'PLACE_OIDC_DATABASE_IDLE_TIMEOUT_MILLISECONDS',
    'PLACE_OIDC_DATABASE_MAX_CONNECTIONS',
    'PLACE_OIDC_ISSUER',
    'PLACE_OIDC_JWKS_URI',
    'PLACE_OIDC_POST_LOGIN_PATH',
    'PLACE_OIDC_REQUIRED_SCOPES',
    'PLACE_OIDC_SCOPES',
    'PLACE_OIDC_SESSION_TTL_SECONDS',
    'PLACE_OIDC_TRANSACTION_TTL_SECONDS',
    'PLACE_CAPTURE_MAXIMUM_BYTES',
    'PLACE_CAPTURE_SWEEP_BATCH_SIZE',
    'PLACE_CAPTURE_VOLUME',
    'PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS',
    'PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS',
    'PLACE_WORKER_DATABASE_MAX_CONNECTIONS',
    'PLACE_WEB_HOST',
    'PLACE_WEB_PORT',
  ],
  required_secret_roles: [
    'database-url',
    'capture-keyring',
    'oidc-client-secret',
    'oidc-encryption-keyring',
  ],
  compatibility_refs: [
    { contract_id: 'place-http', version: 'v1' },
    { contract_id: 'place-membership-policy', version: 'v1' },
  ],
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function exactKeys(value, keys, label) {
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new Error(`${label} has unexpected members`)
  }
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sorted(item)]),
    )
  }
  return value
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(sorted(value), null, 2)}\n`, 'utf8')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function checksum(value, label) {
  const match = checksumPattern.exec(value)
  if (!match) throw new Error(`${label} must be a SHA-256 checksum`)
  return match[1]
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is outside its allowed range`)
  }
  return value
}

function timestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('built_at must be an RFC3339 UTC timestamp in whole seconds')
  }
  return value
}

async function ownedFile(root, relativePath) {
  const resolvedRoot = await realpath(root)
  const candidate = path.join(resolvedRoot, relativePath)
  const resolved = await realpath(candidate)
  const relative = path.relative(resolvedRoot, resolved)
  const metadata = await lstat(candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative) || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${relativePath} is not a repository-owned regular file`)
  }
  return resolved
}

export async function validateReleaseSource(repositoryRoot) {
  const root = await realpath(repositoryRoot)
  const source = object(
    await readJson(await ownedFile(root, declarationPath), 'release source'),
    'release source',
  )
  if (!isDeepStrictEqual(source, expectedReleaseSource)) {
    throw new Error('release source differs from the Place application contract')
  }
  await ownedFile(root, 'Dockerfile')
  await Promise.all([
    ownedFile(root, 'backend/src/entrypoints/http/main.ts'),
    ownedFile(root, 'backend/src/entrypoints/worker/main.ts'),
    ownedFile(root, 'backend/src/entrypoints/cli/prepare-database.ts'),
  ])
  return source
}

function artifactDefinition(artifactId, image) {
  const definition = artifacts.find((item) => item.artifactId === artifactId)
  if (!definition || definition.image !== image) {
    throw new Error('artifact identity differs from the Place release contract')
  }
  return definition
}

function buildkitDocument(envelope, key, label) {
  const value = object(envelope, `${label} envelope`)
  if (isDeepStrictEqual(Object.keys(value), [key])) return object(value[key], label)
  if (isDeepStrictEqual(Object.keys(value), ['linux/amd64'])) {
    const platform = object(value['linux/amd64'], `${label} platform`)
    if (isDeepStrictEqual(Object.keys(platform), [key])) return object(platform[key], label)
  }
  throw new Error(`${label} does not contain exactly one linux/amd64 document`)
}

function validateProvenance(value) {
  const provenance = buildkitDocument(value, 'SLSA', 'SLSA provenance')
  const definition = object(provenance.buildDefinition, 'SLSA build definition')
  const internal = object(definition.internalParameters, 'SLSA internal parameters')
  if (
    typeof definition.buildType !== 'string' ||
    definition.buildType.length === 0 ||
    internal.builderPlatform !== 'linux/amd64' ||
    !Array.isArray(definition.resolvedDependencies)
  ) {
    throw new Error('SLSA provenance has an invalid build definition')
  }
  object(definition.externalParameters, 'SLSA external parameters')
  object(internal.buildConfig, 'SLSA build config')
  const runDetails = object(provenance.runDetails, 'SLSA run details')
  object(runDetails.builder, 'SLSA builder')
  object(runDetails.metadata, 'SLSA metadata')
  return provenance
}

function validateSbom(value) {
  const sbom = buildkitDocument(value, 'SPDX', 'SPDX SBOM')
  if (
    typeof sbom.spdxVersion !== 'string' ||
    !sbom.spdxVersion.startsWith('SPDX-') ||
    sbom.SPDXID !== 'SPDXRef-DOCUMENT' ||
    typeof sbom.documentNamespace !== 'string' ||
    !Array.isArray(sbom.packages) ||
    sbom.packages.length === 0
  ) {
    throw new Error('SBOM is not a described SPDX document')
  }
  const packageIds = new Set()
  for (const entry of sbom.packages) {
    const package_ = object(entry, 'SPDX package')
    if (typeof package_.SPDXID !== 'string' || !package_.SPDXID.startsWith('SPDXRef-')) {
      throw new Error('SBOM package has an invalid SPDXID')
    }
    packageIds.add(package_.SPDXID)
  }
  if (
    !Array.isArray(sbom.documentDescribes) ||
    sbom.documentDescribes.length === 0 ||
    !sbom.documentDescribes.every((identifier) => packageIds.has(identifier))
  ) {
    throw new Error('SBOM does not describe an image package')
  }
  return sbom
}

export async function inspectEvidence({
  artifactId,
  image,
  indexManifest,
  expectedIndexDigest,
  provenancePath,
  sbomPath,
  outputDirectory,
}) {
  artifactDefinition(artifactId, image)
  if (!digestPattern.test(expectedIndexDigest)) throw new Error('index digest is invalid')
  const indexBytes = await readFile(indexManifest)
  if (`sha256:${sha256(indexBytes)}` !== expectedIndexDigest) {
    throw new Error('published index bytes differ from the expected digest')
  }
  const index = object(JSON.parse(indexBytes.toString('utf8')), 'OCI index')
  if (index.schemaVersion !== 2 || !indexMediaTypes.has(index.mediaType) || !Array.isArray(index.manifests)) {
    throw new Error('registry response is not a supported OCI image index')
  }
  const platformDigests = []
  const attestationSubjects = []
  for (const item of index.manifests) {
    const descriptor = object(item, 'OCI descriptor')
    const platform = object(descriptor.platform, 'OCI platform')
    if (!manifestMediaTypes.has(descriptor.mediaType) || !digestPattern.test(descriptor.digest)) {
      throw new Error('OCI descriptor is invalid')
    }
    if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
      const subject = descriptor.annotations['vnd.docker.reference.digest']
      if (!digestPattern.test(subject)) throw new Error('attestation subject is invalid')
      attestationSubjects.push(subject)
    } else if (platform.os === 'linux' && platform.architecture === 'amd64') {
      platformDigests.push(descriptor.digest)
    }
  }
  if (platformDigests.length !== 1 || !isDeepStrictEqual(attestationSubjects, platformDigests)) {
    throw new Error('OCI index must bind one attestation to one linux/amd64 image')
  }
  const provenance = validateProvenance(await readJson(provenancePath, 'provenance envelope'))
  const sbom = validateSbom(await readJson(sbomPath, 'SBOM envelope'))
  const metadata = {
    artifact_id: artifactId,
    image,
    index_digest: expectedIndexDigest,
    platform_digest: platformDigests[0],
  }
  await mkdir(outputDirectory)
  const provenanceDirectory = path.join(outputDirectory, 'provenance')
  const sbomDirectory = path.join(outputDirectory, 'sbom')
  await Promise.all([mkdir(provenanceDirectory), mkdir(sbomDirectory)])
  await Promise.all([
    writeJson(path.join(outputDirectory, 'metadata.json'), metadata),
    writeJson(path.join(provenanceDirectory, 'buildkit-provenance.json'), provenance),
    writeJson(path.join(provenanceDirectory, 'subject.json'), metadata),
    copyFile(indexManifest, path.join(provenanceDirectory, 'oci-index.json')),
    writeJson(path.join(sbomDirectory, 'buildkit-sbom.spdx.json'), sbom),
    writeJson(path.join(sbomDirectory, 'subject.json'), metadata),
    copyFile(indexManifest, path.join(sbomDirectory, 'oci-index.json')),
  ])
  return metadata
}

async function verifiedEvidenceDirectory(inputArtifact, expectedArtifact) {
  exactKeys(inputArtifact, ['artifact_id', 'evidence_directory', 'sbom', 'provenance'], 'record artifact')
  if (inputArtifact.artifact_id !== expectedArtifact.artifactId) {
    throw new Error('record artifact order or identity is invalid')
  }
  const directory = inputArtifact.evidence_directory
  if (typeof directory !== 'string' || directory.length === 0) throw new Error('evidence directory is invalid')
  const metadata = object(await readJson(path.join(directory, 'metadata.json'), 'evidence metadata'), 'evidence metadata')
  const expectedMetadata = {
    artifact_id: expectedArtifact.artifactId,
    image: expectedArtifact.image,
    index_digest: metadata.index_digest,
    platform_digest: metadata.platform_digest,
  }
  if (
    !digestPattern.test(metadata.index_digest) ||
    !digestPattern.test(metadata.platform_digest) ||
    !isDeepStrictEqual(metadata, expectedMetadata)
  ) {
    throw new Error('evidence metadata is invalid')
  }
  const [sbomSubject, provenanceSubject] = await Promise.all([
    readJson(path.join(directory, 'sbom', 'subject.json'), 'SBOM subject'),
    readJson(path.join(directory, 'provenance', 'subject.json'), 'provenance subject'),
    ownedEvidenceFile(path.join(directory, 'sbom', 'buildkit-sbom.spdx.json')),
    ownedEvidenceFile(path.join(directory, 'provenance', 'buildkit-provenance.json')),
  ])
  if (!isDeepStrictEqual(sbomSubject, metadata) || !isDeepStrictEqual(provenanceSubject, metadata)) {
    throw new Error('evidence subject differs from its metadata')
  }
  return metadata
}

async function ownedEvidenceFile(file) {
  const metadata = await lstat(file)
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size === 0) {
    throw new Error('evidence file is invalid')
  }
}

function evidenceLocation(input, runId, platformDigest) {
  const value = object(input, 'evidence upload')
  exactKeys(value, ['artifact_id', 'sha256'], 'evidence upload')
  return {
    location: {
      type: 'github-actions-artifact',
      repository,
      run_id: runId,
      artifact_id: positiveInteger(value.artifact_id, 'artifact id'),
      sha256: checksum(value.sha256, 'artifact digest'),
    },
    subject_digest: platformDigest,
  }
}

export async function createReleaseRecord({ repositoryRoot, inputPath, outputPath }) {
  const source = await validateReleaseSource(repositoryRoot)
  const input = object(await readJson(inputPath, 'release record input'), 'release record input')
  exactKeys(
    input,
    ['schema_version', 'repository', 'commit_sha', 'run_id', 'run_attempt', 'built_at', 'artifacts'],
    'release record input',
  )
  if (
    input.schema_version !== 'place-release-record-input.v1' ||
    input.repository !== repository ||
    !commitPattern.test(input.commit_sha) ||
    !Array.isArray(input.artifacts) ||
    input.artifacts.length !== artifacts.length
  ) {
    throw new Error('release record input identity is invalid')
  }
  const runId = positiveInteger(input.run_id, 'run id')
  const runAttempt = positiveInteger(input.run_attempt, 'run attempt', 100)
  const builtAt = timestamp(input.built_at)
  const evidence = await Promise.all(
    input.artifacts.map((item, index) => verifiedEvidenceDirectory(object(item, 'record artifact'), artifacts[index])),
  )
  const declaration = await readFile(await ownedFile(repositoryRoot, declarationPath))
  const record = {
    schema_version: 'release-record.v1',
    release_id: releaseId,
    release_revision: `${releaseId}@${input.commit_sha}`,
    source: {
      repository,
      commit_sha: input.commit_sha,
      declaration_path: declarationPath,
      declaration_sha256: sha256(declaration),
    },
    workflow: {
      caller_repository: repository,
      caller_path: workflowPath,
      builder_repository: repository,
      builder_path: workflowPath,
      builder_commit_sha: input.commit_sha,
      run_id: runId,
      run_attempt: runAttempt,
    },
    built_at: builtAt,
    artifacts: artifacts.map((definition, index) => ({
      artifact_id: definition.artifactId,
      kind: 'container-image',
      workload_roles: definition.workloadRoles,
      location: {
        type: 'oci',
        registry: 'ghcr.io',
        repository: definition.repository,
        digest: evidence[index].platform_digest,
      },
      sbom: evidenceLocation(input.artifacts[index].sbom, runId, evidence[index].platform_digest),
      provenance: evidenceLocation(
        input.artifacts[index].provenance,
        runId,
        evidence[index].platform_digest,
      ),
    })),
    compatibility_refs: source.compatibility_refs,
  }
  await writeJson(outputPath, record)
  return record
}

function options(arguments_) {
  const result = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]
    const value = arguments_[index + 1]
    if (!name?.startsWith('--') || value === undefined || result.has(name)) {
      throw new Error('command options are invalid')
    }
    result.set(name, value)
  }
  return result
}

function required(values, name) {
  const value = values.get(name)
  if (!value) throw new Error(`missing ${name}`)
  return value
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const values = options(rest)
  let result
  if (command === 'verify-source') {
    result = await validateReleaseSource(required(values, '--repository-root'))
  } else if (command === 'inspect-evidence') {
    result = await inspectEvidence({
      artifactId: required(values, '--artifact-id'),
      image: required(values, '--image'),
      indexManifest: required(values, '--index-manifest'),
      expectedIndexDigest: required(values, '--expected-index-digest'),
      provenancePath: required(values, '--provenance'),
      sbomPath: required(values, '--sbom'),
      outputDirectory: required(values, '--output-directory'),
    })
  } else if (command === 'create-record') {
    result = await createReleaseRecord({
      repositoryRoot: required(values, '--repository-root'),
      inputPath: required(values, '--input'),
      outputPath: required(values, '--output'),
    })
  } else {
    throw new Error('unsupported release command')
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => {
    process.stderr.write('Application release input is invalid\n')
    process.exitCode = 1
  })
}
