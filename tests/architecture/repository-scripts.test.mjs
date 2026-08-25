import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

test('backend unit-test exclusion remains one cross-platform shell argument', async () => {
  const backendPackage = JSON.parse(
    await readFile(path.join(repositoryRoot, 'backend', 'package.json'), 'utf8'),
  )

  assert.equal(backendPackage.scripts.test, 'vitest run --exclude "tests/integration/**"')
})

test('mobile Chromium project explicitly selects Chromium after the device preset', async () => {
  const playwrightConfig = await readFile(
    path.join(repositoryRoot, 'playwright.config.ts'),
    'utf8',
  )

  assert.match(
    playwrightConfig,
    /name: 'mobile-chromium',[\s\S]*?use: \{[\s\S]*?\.\.\.devices\['iPhone 13'\],[\s\S]*?browserName: 'chromium',/,
  )
})

test('shell screenshot baselines cover Windows and Linux Chromium', async () => {
  const snapshots = await readdir(
    path.join(repositoryRoot, 'tests', 'e2e', 'shell.spec.ts-snapshots'),
  )

  assert.deepEqual(snapshots.sort(), [
    'place-stage-two-shell-desktop-chromium-linux.png',
    'place-stage-two-shell-desktop-chromium-win32.png',
    'place-stage-two-shell-mobile-chromium-linux.png',
    'place-stage-two-shell-mobile-chromium-win32.png',
  ])
})

test('search screenshot baselines cover reviewed Windows and Linux states', async () => {
  const snapshots = await readdir(
    path.join(repositoryRoot, 'tests', 'e2e', 'search.spec.ts-snapshots'),
  )
  const cases = [
    'place-search-1280x800-desktop',
    'place-search-1440x900-desktop',
    'place-search-360x800-mobile',
    'place-search-390x844-mobile',
    'place-search-empty-360x800-mobile',
    'place-search-error-1280x800-desktop',
    'place-search-loading-1280x800-desktop',
    'place-search-map-360x800-mobile',
    'place-search-partial-1280x800-desktop',
  ]
  const expected = cases.flatMap((name) => [
    `${name}-chromium-linux.png`,
    `${name}-chromium-win32.png`,
  ])

  assert.deepEqual(snapshots.sort(), expected.sort())
})
