import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
