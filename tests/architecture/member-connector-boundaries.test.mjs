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
