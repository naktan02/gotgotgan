import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const commitPattern = /^[0-9a-f]{40}$/
const webImagePattern = /^ghcr\.io\/naktan02\/place-web@sha256:[0-9a-f]{64}$/
const backendImagePattern = /^ghcr\.io\/naktan02\/place-backend@sha256:[0-9a-f]{64}$/
const sourceLabel = 'https://github.com/naktan02/place'

async function docker(arguments_, { allowFailure = false } = {}) {
  try {
    return await execFileAsync('docker', arguments_, { windowsHide: true })
  } catch (error) {
    if (allowFailure) return { stdout: error?.stdout ?? '' }
    throw error
  }
}

function validate(options) {
  if (
    !webImagePattern.test(options.webImage) ||
    !backendImagePattern.test(options.backendImage) ||
    !commitPattern.test(options.commit) ||
    typeof options.output !== 'string' ||
    options.output.length === 0
  ) {
    throw new Error('invalid published application image input')
  }
}

async function inspectImage(image, commit, runDocker) {
  const labelsResult = await runDocker([
    'image',
    'inspect',
    '--format',
    '{{json .Config.Labels}}',
    image,
  ])
  const labels = JSON.parse(labelsResult.stdout)
  const userResult = await runDocker([
    'image',
    'inspect',
    '--format',
    '{{json .Config.User}}',
    image,
  ])
  if (
    labels?.['org.opencontainers.image.source'] !== sourceLabel ||
    labels?.['org.opencontainers.image.revision'] !== commit ||
    JSON.parse(userResult.stdout) !== 'node'
  ) {
    throw new Error('published image identity is invalid')
  }
}

async function waitForReadiness(container, port, path_, runDocker) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runDocker([
        'exec',
        container,
        'node',
        '-e',
        `fetch('http://127.0.0.1:${port}${path_}').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`,
      ])
      return
    } catch {
      await delay(250)
    }
  }
  throw new Error(`${container} did not become ready`)
}

export async function smokePublishedApplicationImages(options, runDocker = docker) {
  validate(options)
  const suffix = `${process.pid}-${Date.now()}`
  const webContainer = `place-web-release-smoke-${suffix}`
  const backendContainer = `place-backend-release-smoke-${suffix}`
  await Promise.all([
    runDocker(['image', 'rm', '--force', options.webImage], { allowFailure: true }),
    runDocker(['image', 'rm', '--force', options.backendImage], { allowFailure: true }),
  ])
  await runDocker(['pull', options.webImage])
  await runDocker(['pull', options.backendImage])
  await Promise.all([
    inspectImage(options.webImage, options.commit, runDocker),
    inspectImage(options.backendImage, options.commit, runDocker),
  ])

  try {
    await runDocker([
      'run',
      '--detach',
      '--name',
      webContainer,
      '--pull',
      'never',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      '/tmp',
      '--env',
      'HOSTNAME=0.0.0.0',
      '--env',
      'PORT=3000',
      '--env',
      'PLACE_OIDC_RUNTIME_ENABLED=false',
      '--env',
      'PLACE_MEMBERSHIP_RUNTIME_ENABLED=false',
      options.webImage,
    ])
    await runDocker([
      'run',
      '--detach',
      '--name',
      backendContainer,
      '--pull',
      'never',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      '/tmp',
      '--env',
      'PLACE_HTTP_HOST=0.0.0.0',
      '--env',
      'PLACE_HTTP_PORT=8080',
      '--env',
      'PLACE_HTTP_RUNTIME_MODE=source-only',
      options.backendImage,
    ])
    await Promise.all([
      waitForReadiness(webContainer, 3000, '/readyz', runDocker),
      waitForReadiness(backendContainer, 8080, '/readyz', runDocker),
    ])
    await runDocker([
      'run',
      '--rm',
      '--pull',
      'never',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      options.backendImage,
      'node',
      'backend/dist/entrypoints/worker/main.js',
      '--check',
    ])
  } finally {
    await Promise.all([
      runDocker(['rm', '--force', webContainer], { allowFailure: true }),
      runDocker(['rm', '--force', backendContainer], { allowFailure: true }),
    ])
  }

  const evidence = {
    schemaVersion: 'place-published-image-smoke.v1',
    releaseRevision: `place@${options.commit}`,
    images: {
      web: { reference: options.webImage, readinessPath: '/readyz' },
      backend: { reference: options.backendImage, readinessPath: '/readyz' },
    },
    workerCheck: 'passed',
  }
  await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return evidence
}

function cliOptions(arguments_) {
  const result = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    if (!arguments_[index]?.startsWith('--') || arguments_[index + 1] === undefined) {
      throw new Error('invalid published application image input')
    }
    result.set(arguments_[index], arguments_[index + 1])
  }
  return result
}

async function main() {
  const values = cliOptions(process.argv.slice(2))
  await smokePublishedApplicationImages({
    webImage: values.get('--web-image'),
    backendImage: values.get('--backend-image'),
    commit: values.get('--commit'),
    output: values.get('--output'),
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => {
    process.stderr.write('Published application image smoke failed\n')
    process.exitCode = 1
  })
}
