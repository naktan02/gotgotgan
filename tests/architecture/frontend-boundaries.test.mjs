import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { inspectFrontendArchitecture } from '@naktan02/frontend-architecture'
import { frontendArchitecturePolicy } from '../../scripts/frontend-architecture-policy.mjs'

const roots = []
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const moduleSourcePattern = /\.(?:ts|tsx)$/
const layoutSourcePattern = /\.(?:css|ts|tsx)$/
const testSourcePattern = /\.(?:test|spec)\.(?:css|ts|tsx)$/
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function isProductionModule(name) {
  return moduleSourcePattern.test(name) && !name.endsWith('.d.ts') && !testSourcePattern.test(name)
}

function isProductionLayoutSource(name) {
  return layoutSourcePattern.test(name) && !name.endsWith('.d.ts') && !testSourcePattern.test(name)
}

function isTestSupportDirectory(name) {
  return name === 'tests' || name === '__tests__'
}

async function collectProductionSources(root, directory = root) {
  const sources = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && !isTestSupportDirectory(entry.name)) {
      sources.push(...await collectProductionSources(root, target))
    } else if (entry.isFile() && isProductionModule(entry.name)) {
      sources.push({ absolute: target, relative: normalize(path.relative(root, target)) })
    }
  }
  return sources
}

function crossFeatureTarget(importer, specifier) {
  const alias = specifier.match(/^@\/features\/([^/]+)(?:\/(.*))?$/)
  if (alias !== null) return { owner: alias[1], tail: alias[2] ?? '' }
  if (!specifier.startsWith('.')) return null
  const target = normalize(path.normalize(path.join(path.dirname(importer), specifier)))
  const relative = target.match(/^features\/([^/]+)(?:\/(.*))?$/)
  return relative === null ? null : { owner: relative[1], tail: relative[2] ?? '' }
}

async function inspectFeaturePublicSeams(root) {
  const violations = []
  for (const source of await collectProductionSources(root)) {
    const importer = source.relative.match(/^features\/([^/]+)\//)
    if (importer === null) continue
    const contents = await readFile(source.absolute, 'utf8')
    for (const match of contents.matchAll(importPattern)) {
      const target = crossFeatureTarget(source.relative, match[1])
      if (
        target !== null && target.owner !== importer[1] &&
        target.tail !== 'public' && target.tail !== 'public/index' &&
        target.tail !== 'public.ts' && target.tail !== 'public/index.ts'
      ) {
        violations.push(
          `${source.relative}: feature ${importer[1]} must import ${target.owner} through its public index interface`,
        )
      }
    }
  }
  return violations
}

async function inspectFrontendLayout(root) {
  const violations = []

  async function inspectDirectory(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    const directSources = entries.filter(
      (entry) => entry.isFile() && isProductionLayoutSource(entry.name),
    )
    const relativeDirectory = normalize(path.relative(root, directory)) || '.'
    if (directSources.length > 12) {
      violations.push(
        `${relativeDirectory}: ${directSources.length} direct production sources exceed the 12-file layout review gate`,
      )
    }
    for (const entry of directSources) {
      const target = path.join(directory, entry.name)
      const contents = await readFile(target, 'utf8')
      if (contents.split(/\r?\n/).length > 500) {
        violations.push(
          `${normalize(path.relative(root, target))}: production source exceeds the 500-line layout review gate`,
        )
      }
    }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !isTestSupportDirectory(entry.name))
      .map((entry) => inspectDirectory(path.join(directory, entry.name))))
  }

  await inspectDirectory(root)
  return violations
}
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
    'platform/auth/session.ts': 'export const session = true',
    'platform/membership/browser.ts': "import { session } from '../auth/session'; void session",
    'platform/imports/browser.ts': "import { session } from '../auth/session'; void session",
    'platform/profiles/browser.ts': "import { session } from '../auth/session'; void session",
    'platform/process-readiness/check.ts': "import '../auth/session'; import '../imports/browser'; import '../membership/browser'",
  })
  assert.deepEqual(await inspectFrontendArchitecture(root, frontendArchitecturePolicy), [])
})

test('rejects reverse imports, feature internals, and cycles', async () => {
  const root = await fixture({
    'shared/a.ts': "import '../platform/b'",
    'platform/b.ts': "import '../shared/a'",
    'features/search/model.ts': "import '../library/internal'",
    'features/library/internal.ts': 'export const library = true',
    'platform/auth/runtime.ts': "import '../membership/client'",
    'platform/membership/client.ts': 'export const client = true',
  })
  const violations = await inspectFrontendArchitecture(root, frontendArchitecturePolicy)
  assert.ok(violations.some((value) => value.includes('shared cannot import platform')))
  assert.ok(violations.some((value) => value.includes("cannot import each other's internals")))
  assert.ok(violations.some((value) => value.includes('frontend import cycle')))
  assert.ok(
    violations.some((value) =>
      value.includes('platform owner auth cannot import membership'),
    ),
  )
})

test('requires cross-feature callers to use the target public index only', async () => {
  const root = await fixture({
    'features/search/public/index.ts': "export { library } from '../../library/public/index'",
    'features/search/workflow.ts': "import { library } from '../library/public/internal'; void library",
    'features/library/public/index.ts': "export { library } from '../internal'",
    'features/library/public/internal.ts': "export { library } from '../internal'",
    'features/library/internal.ts': 'export const library = true',
  })
  const violations = await inspectFeaturePublicSeams(root)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /public index interface/)
})

test('enforces web layout review gates without counting test support', async () => {
  const files = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [
    `features/library/flat/module-${index}.ts`,
    'export const value = true',
  ]))
  files['features/library/large.ts'] = Array.from({ length: 501 }, () => '// line').join('\n')
  files['features/library/tests/large.test.ts'] = Array.from({ length: 700 }, () => '// test').join('\n')
  const root = await fixture(files)
  const violations = await inspectFrontendLayout(root)
  assert.ok(violations.some((value) => value.includes('500-line layout review gate')))
  assert.ok(violations.some((value) => value.includes('12-file layout review gate')))
  assert.ok(!violations.some((value) => value.startsWith('features/library/tests/large.test.ts')))
})

test('web production sources use public feature seams and reviewed layouts', async () => {
  const root = path.join(repositoryRoot, 'apps/web/src')
  assert.deepEqual(await inspectFeaturePublicSeams(root), [])
  assert.deepEqual(await inspectFrontendLayout(root), [])
})
