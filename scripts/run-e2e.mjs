import { spawn } from 'node:child_process'
import { readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const configuredBaseUrl = process.env.PLACE_WEB_E2E_BASE_URL
const disposableWorkspace = process.env.PLACE_E2E_DISPOSABLE_WORKSPACE === 'true'
if (!configuredBaseUrl) {
  throw new Error('PLACE_WEB_E2E_BASE_URL is required; test environments own their address.')
}

const baseUrl = new URL(configuredBaseUrl)
if (!/^[a-zA-Z0-9.-]+$/.test(baseUrl.hostname) || !/^\d+$/.test(baseUrl.port)) {
  throw new Error('PLACE_WEB_E2E_BASE_URL must include a safe hostname and explicit port.')
}
const backendPort = Number(baseUrl.port) + 1
if (backendPort > 65535) throw new Error('PLACE_WEB_E2E_BASE_URL leaves no port for the test Backend.')
const backendOrigin = `http://${baseUrl.hostname}:${backendPort}`

// 전체 빌드를 검증한 격리 CI에서만 사용이 끝난 생성물의 RAM을 돌려준다.
if (disposableWorkspace) {
  const root = await realpath(process.cwd())
  for (const directory of ['apps/web/.next', 'apps/admin-web/.next']) {
    const expected = path.resolve(root, directory)
    let target
    try {
      target = await realpath(expected)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error('CI build output leaves the disposable workspace')
    }
    if (target !== expected) throw new Error('CI build output path is redirected')
    await rm(expected, { recursive: true })
    console.log(`Discarded validated CI build output: ${directory}`)
  }
}

const nextCli = path.resolve('node_modules/next/dist/bin/next')
const playwrightCli = path.resolve('node_modules/@playwright/test/cli.js')
const familyNavigationManifest =
  process.env.PLACE_FAMILY_NAVIGATION_MANIFEST ??
  (await readFile(
    path.resolve('packages/contracts/fixtures/family-navigation.active.test.v1.json'),
    'utf8',
  ))
const testEnvironment = {
  ...process.env,
  PLACE_FAMILY_NAVIGATION_MANIFEST: familyNavigationManifest,
  PLACE_BACKEND_ORIGIN: backendOrigin,
}
const serverEnvironment = { ...testEnvironment }
if (disposableWorkspace) {
  serverEnvironment.NODE_OPTIONS = `${serverEnvironment.NODE_OPTIONS ?? ''} --max-old-space-size=3072`.trim()
}
const backend = spawn(
  process.execPath,
  [path.resolve('backend/tests/fixtures/publication-http-server.mjs')],
  {
    cwd: process.cwd(),
    env: {
      ...testEnvironment,
      PLACE_E2E_BACKEND_HOST: baseUrl.hostname,
      PLACE_E2E_BACKEND_PORT: String(backendPort),
    },
    stdio: 'inherit',
  },
)
const server = spawn(
  process.execPath,
  [nextCli, 'dev', ...(disposableWorkspace ? ['--webpack'] : []), '--hostname', baseUrl.hostname, '--port', baseUrl.port],
  { cwd: path.resolve('apps/web'), env: serverEnvironment, stdio: 'inherit' },
)

let serverExit
let runner
let stopping = false
const serverExited = new Promise((resolve) => {
  server.once('exit', (code, signal) => {
    serverExit = { code, signal }
    if (!stopping) {
      console.error('E2E Web server exited before the browser suite completed:', serverExit)
      if (runner?.exitCode === null) runner.kill('SIGTERM')
    }
    resolve(serverExit)
  })
})

async function waitUntilReady() {
  const deadline = Date.now() + 120_000
  const healthUrl = new URL('/healthz', baseUrl)
  const backendUrl = new URL('/v1/public/collections/01992d20-0000-7000-8000-000000000001', backendOrigin)
  while (Date.now() < deadline) {
    if (serverExit) throw new Error(`Next.js exited before readiness: ${JSON.stringify(serverExit)}`)
    try {
      const [response, backendResponse] = await Promise.all([
        fetch(healthUrl, { signal: AbortSignal.timeout(1_000) }),
        fetch(backendUrl, { signal: AbortSignal.timeout(1_000) }),
      ])
      if (response.ok && backendResponse.ok) return
    } catch {}
    await delay(250)
  }
  throw new Error('Next.js did not become ready before the E2E timeout.')
}

async function stopServer() {
  if (serverExit) return
  server.kill('SIGTERM')
  await Promise.race([serverExited, delay(5_000)])
  if (!serverExit) {
    server.kill('SIGKILL')
    await serverExited
  }
}

async function stopBackend() {
  if (backend.exitCode !== null) return
  backend.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => backend.once('exit', resolve)),
    delay(5_000),
  ])
  if (backend.exitCode === null) backend.kill('SIGKILL')
}

let exitCode = 1
try {
  await waitUntilReady()
  if (serverExit) throw new Error(`Next.js exited before the browser suite: ${JSON.stringify(serverExit)}`)
  runner = spawn(
    process.execPath,
    [playwrightCli, 'test', ...process.argv.slice(2)],
    { cwd: process.cwd(), env: testEnvironment, stdio: 'inherit' },
  )
  exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject)
    runner.once('exit', (code) => resolve(code ?? 1))
  })
  if (serverExit) exitCode = 1
} finally {
  stopping = true
  await stopServer()
  await stopBackend()
}

process.exitCode = exitCode
