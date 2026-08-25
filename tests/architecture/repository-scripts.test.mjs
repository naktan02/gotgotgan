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
