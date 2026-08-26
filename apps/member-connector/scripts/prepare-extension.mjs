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
if (npmCli === undefined) throw new Error('npm_execpath is required to prepare the extension')

await new Promise((resolvePrepare, rejectPrepare) => {
  const child = spawn(process.execPath, [npmCli, 'exec', '--', 'wxt', 'prepare'], {
    cwd: root,
    env: {
      ...process.env,
      WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN: publicOrigin,
      WXT_PLACE_CONNECTOR_FIREFOX_ID: firefoxExtensionId,
    },
    stdio: 'inherit',
  })
  child.once('error', rejectPrepare)
  child.once('exit', (code) => {
    if (code === 0) resolvePrepare()
    else rejectPrepare(new Error(`Extension preparation failed with exit code ${code}`))
  })
})
