import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { inspectMemberConnectorArchitecture } from '../../scripts/lib/member-connector-architecture.mjs'

const roots = []

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'place-member-connector-architecture-'))
  roots.push(root)
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('accepts inward connector dependencies and entrypoint composition', async () => {
  const root = await fixture({
    'application/ports/capture.ts': "import type { ConnectorGrant } from '@place/contracts/connector'; export type Capture = ConnectorGrant",
    'application/ports/transfer.ts': "import type { ConnectorImportGrantV2 } from '@place/contracts/transfers'; export type Transfer = ConnectorImportGrantV2",
    'application/collect.ts': "import type { Capture } from './ports/capture.js'; export type { Capture }",
    'adapters/place/http.ts': "import type { Capture } from '../../application/ports/capture.js'; export const capture = {} as Capture",
    'entrypoints/extension/background.ts': "import { capture } from '../../adapters/place/http.js'; void capture",
    'observation/application/ports/browser.ts': 'export type Browser = { close(): void }',
    'observation/application/observe.ts': "import type { Browser } from './ports/browser.js'; export type { Browser }",
    'observation/adapters/playwright/browser.ts': "import type { Browser } from '../../application/ports/browser.js'; export const browser = {} as Browser",
    'entrypoints/cli/main.ts': "import { browser } from '../../observation/adapters/playwright/browser.js'; void browser",
  })
  assert.deepEqual(await inspectMemberConnectorArchitecture(root), [])
})

test('rejects reverse imports, workspace coupling, and cycles', async () => {
  const root = await fixture({
    'observation/application/observe.ts': "import '../adapters/browser.js'",
    'observation/adapters/browser.ts': "import '../application/observe.js'",
    'application/collect.ts': "import '../adapters/place.js'",
    'adapters/place.ts': "import '../application/collect.js'",
    'entrypoints/cli/main.ts': "import '@place/backend'",
  })
  const violations = await inspectMemberConnectorArchitecture(root)
  assert.ok(violations.some((value) => value.includes('application cannot import adapters')))
  assert.ok(violations.some((value) => value.includes('workspace package')))
  assert.ok(violations.some((value) => value.includes('connector import cycle')))
})

test('rejects source imports that escape the connector root', async () => {
  const root = await fixture({
    'entrypoints/cli/main.ts': "import '../../../../backend/src/main.js'",
  })
  const violations = await inspectMemberConnectorArchitecture(root)
  assert.ok(violations.some((value) => value.includes('escapes the connector source root')))
})

test('keeps provider acquisition out of the common desktop host', async () => {
  const root = await fixture({
    'application/ports/desktop-acquisition-provider.ts': 'export type Provider = { collect(): void }',
    'adapters/providers/naver/desktop/acquisition-provider.ts': 'export const provider = { collect() {} }',
    'adapters/browser/electron/host.ts': "import type { Provider } from '../../../application/ports/desktop-acquisition-provider.js'; export const open = (provider: Provider) => provider.collect()",
    'entrypoints/desktop/main.ts': "import { provider } from '../../adapters/providers/naver/desktop/acquisition-provider.js'; import { open } from '../../adapters/browser/electron/host.js'; open(provider)",
  })
  assert.deepEqual(await inspectMemberConnectorArchitecture(root), [])
  await writeFile(path.join(root, 'adapters/browser/electron/host.ts'),
    "import { provider } from '../../providers/naver/desktop/acquisition-provider.js'; export const open = () => provider.collect()")
  assert.ok((await inspectMemberConnectorArchitecture(root))
    .some((value) => value.includes('desktop host must receive provider adapters')))
})

test('requires outbound export callers to cross its public index seam', async () => {
  const root = await fixture({
    'application/outbound-export/index.ts': "export { run } from './runtime.js'",
    'application/outbound-export/runtime.ts': 'export const run = () => undefined',
    'application/compose.ts': "import { run } from './outbound-export/runtime.js'; run()",
  })
  const violations = await inspectMemberConnectorArchitecture(root)
  assert.ok(violations.some((value) => value.includes('public index interface')))
})

test('enforces connector layout review gates without counting test support', async () => {
  const files = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [
    `application/flat/module-${index}.ts`,
    'export const value = true',
  ]))
  files['application/large.ts'] = Array.from({ length: 501 }, () => '// line').join('\n')
  files['application/tests/large.test.ts'] = Array.from({ length: 700 }, () => '// test').join('\n')
  const root = await fixture(files)
  const violations = await inspectMemberConnectorArchitecture(root)
  assert.ok(violations.some((value) => value.includes('500-line layout review gate')))
  assert.ok(violations.some((value) => value.includes('12-file layout review gate')))
  assert.ok(!violations.some((value) => value.startsWith('application/tests/large.test.ts')))
})
