import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { inspectBackendArchitecture } from '../../scripts/lib/backend-architecture.mjs'

const roots = []

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'place-architecture-'))
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

async function readTypeScriptTree(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return await readTypeScriptTree(target)
    if (entry.isFile() && entry.name.endsWith('.ts')) return [await readFile(target, 'utf8')]
    return []
  }))
  return nested.flat()
}

test('accepts inward dependencies and entrypoint composition through public indexes', async () => {
  const root = await fixture({
    'modules/access/domain/model.ts': 'export type Membership = { id: string }',
    'modules/access/application/use-case.ts': "import type { Membership } from '../domain/model.js'",
    'modules/access/index.ts': "export type { Membership } from './domain/model.js'",
    'entrypoints/http/main.ts': "import type { Membership } from '../../modules/access/index.js'",
  })
  assert.deepEqual(await inspectBackendArchitecture(root), [])
})

test('rejects direct cross-module imports and entrypoint access to internals', async () => {
  const root = await fixture({
    'modules/access/index.ts': 'export const access = true',
    'modules/library/application/use-case.ts':
      "import { access } from '../../access/index.js'; void access",
    'entrypoints/http/main.ts':
      "import '../..//modules/library/application/use-case.js'",
  })
  const violations = await inspectBackendArchitecture(root)
  assert.ok(violations.some((value) => value.includes('cannot directly import module access')))
  assert.ok(violations.some((value) => value.includes('public index.ts')))
})

test('rejects outward and cyclic imports', async () => {
  const root = await fixture({
    'modules/access/domain/model.ts': "import '../adapters/store.js'",
    'modules/access/adapters/store.ts': "import '../domain/model.js'",
  })
  const violations = await inspectBackendArchitecture(root)
  assert.ok(violations.some((value) => value.includes('domain code cannot import')))
  assert.ok(violations.some((value) => value.includes('relative import cycle')))
})

test('keeps TraceForge detail interpretation in the NAVER Providers adapter', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const [ingestionSources, naverTraceForgeSource, googleOfficialSource] = await Promise.all([
    readTypeScriptTree(path.join(repositoryRoot, 'backend/src/modules/ingestion')),
    readFile(path.join(
      repositoryRoot,
      'backend/src/modules/providers/adapters/naver/traceforge-place-detail-source.ts',
    ), 'utf8'),
    readFile(path.join(
      repositoryRoot,
      'backend/src/modules/providers/adapters/google/official-place-details.ts',
    ), 'utf8'),
  ])

  assert.doesNotMatch(ingestionSources.join('\n'), /TraceForge|ForgeRecipeClient/)
  assert.match(naverTraceForgeSource, /export class NaverTraceForgePlaceDetailSource/)
  assert.doesNotMatch(naverTraceForgeSource, /modules\/ingestion|ingestion\/(?:index|application)/i)
  assert.doesNotMatch(googleOfficialSource, /traceforge|provider-place-detail-runtime/i)
})
