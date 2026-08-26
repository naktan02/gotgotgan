import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(await readFile(
  new URL('../tests/fixtures/extension-build.json', import.meta.url),
  'utf8',
))
const publicOrigin = new URL(fixture.publicOrigin).origin
const firefoxExtensionId = fixture.firefoxExtensionId
const npmCli = process.env.npm_execpath
if (npmCli === undefined) throw new Error('npm_execpath is required to verify extension builds')

async function build(browser) {
  await new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, [npmCli, 'exec', '--', 'wxt', 'build', '-b', browser, '--mv3'], {
      cwd: root,
      env: {
        ...process.env,
        WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN: publicOrigin,
        WXT_PLACE_CONNECTOR_FIREFOX_ID: firefoxExtensionId,
      },
      stdio: 'inherit',
    })
    child.once('error', rejectBuild)
    child.once('exit', (code) => {
      if (code === 0) resolveBuild()
      else rejectBuild(new Error(`${browser} extension build failed with exit code ${code}`))
    })
  })
}

await build('chrome')
await build('firefox')

async function manifest(browser) {
  return JSON.parse(await readFile(
    resolve(root, '.output', `${browser}-mv3`, 'manifest.json'),
    'utf8',
  ))
}

const chromium = await manifest('chrome')
const firefox = await manifest('firefox')
const expectedMatch = `${publicOrigin}/*`
const expectedProviderPermission = 'https://pages.map.naver.com/*'
const failures = []
for (const [browser, value] of [['chromium', chromium], ['firefox', firefox]]) {
  if (value.manifest_version !== 3) failures.push(`${browser} must use Manifest V3`)
  if (value.permissions?.join(',') !== 'storage') {
    failures.push(`${browser} must request only the storage base permission`)
  }
  if (value.content_scripts?.[0]?.matches?.join(',') !== expectedMatch) {
    failures.push(`${browser} must bridge only the configured Place public origin`)
  }
  if (value.host_permissions?.join(',') !== expectedMatch) {
    failures.push(`${browser} must upload only to the configured Place public origin`)
  }
  if (value.optional_host_permissions?.join(',') !== expectedProviderPermission) {
    failures.push(`${browser} must request only the NAVER saved-place origin on demand`)
  }
  if (value.oauth2 !== undefined || value.key !== undefined) {
    failures.push(`${browser} cannot embed a browser-store identity or OAuth credential`)
  }
}
if (failures.length > 0) throw new Error(failures.join('\n'))

if (
  firefox.browser_specific_settings?.gecko?.id !== firefoxExtensionId ||
  firefox.browser_specific_settings?.gecko?.data_collection_permissions?.required?.join(',') !==
    'websiteContent'
) {
  throw new Error('Firefox must declare its injected extension ID and website-content collection')
}

process.stdout.write(
  'Chrome/Edge/Whale-compatible Chromium MV3 and Firefox MV3 extension artifacts are valid.\n',
)
