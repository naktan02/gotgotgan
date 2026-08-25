import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { inspectFrontendArchitecture } from '../../scripts/lib/frontend-architecture.mjs'

const roots = []
async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'place-frontend-architecture-'))
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

test('accepts frontend inward dependencies and explicit feature public contracts', async () => {
  const root = await fixture({
    'shared/id.ts': 'export const id = 1',
    'domains/places/place.ts': "import { id } from '../../shared/id'; export { id }",
    'features/search/public/index.ts': 'export const search = true',
    'shells/workspace/Shell.tsx': "import { search } from '../../features/search/public/index'; void search",
  })
  assert.deepEqual(await inspectFrontendArchitecture(root), [])
})

test('rejects reverse imports, feature internals, and cycles', async () => {
  const root = await fixture({
    'shared/a.ts': "import '../platform/b'",
    'platform/b.ts': "import '../shared/a'",
    'features/search/model.ts': "import '../library/internal'",
    'features/library/internal.ts': 'export const library = true',
  })
  const violations = await inspectFrontendArchitecture(root)
  assert.ok(violations.some((value) => value.includes('shared cannot import platform')))
  assert.ok(violations.some((value) => value.includes("cannot import each other's internals")))
  assert.ok(violations.some((value) => value.includes('frontend import cycle')))
})
