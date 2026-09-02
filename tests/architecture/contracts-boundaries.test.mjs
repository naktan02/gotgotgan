import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { inspectContractsArchitecture } from '../../scripts/lib/contracts-architecture.mjs'

const roots = []

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'place-contracts-architecture-'))
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

test('accepts contract owners depending on primitive, provider, and Place summary leaves', async () => {
  const root = await fixture({
    'primitives.ts': 'export const uuid = true',
    'providers/index.ts': 'export const provider = true',
    'place-summary/index.ts': "import '../primitives.js'",
    'search/index.ts': "import '../primitives.js'; import '../providers/index.js'",
    'imports/index.ts': "import '../primitives.js'; import '../providers/index.js'",
    'connector/index.ts': "import '../primitives.js'; import '../providers/index.js'",
    'transfers/index.ts': "import '../primitives.js'; import '../providers/index.js'",
    'places/index.ts': "import '../primitives.js'; import '../place-summary/index.js'",
    'profiles/index.ts': "import '../primitives.js'",
    'library/index.ts': "import '../primitives.js'; import '../places/index.js'",
    'visits/index.ts': "import '../primitives.js'",
    'writing/index.ts': "import '../primitives.js'",
    'http/content.ts': "import '../primitives.js'; import '../place-summary/index.js'",
  })
  assert.deepEqual(await inspectContractsArchitecture(root), [])
})

test('rejects feature contract ownership inversion through search or HTTP', async () => {
  const root = await fixture({
    'http/content.ts': 'export const uuid = true',
    'search/index.ts': 'export const provider = true',
    'imports/index.ts': "import '../search/index.js'",
    'connector/index.ts': "import '../http/content.js'",
  })
  const violations = await inspectContractsArchitecture(root)
  assert.ok(violations.some((value) => value.includes('imports cannot import search')))
  assert.ok(violations.some((value) => value.includes('connector cannot import http')))
})
