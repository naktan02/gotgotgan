import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

// Opt-in public-tile probe. It never logs in, requests location permission, or substitutes map data.
const [baseUrl, outputDirectory] = process.argv.slice(2)
if (!baseUrl || !outputDirectory) throw new Error('Usage: node live-map-smoke.mjs <base-url> <output-directory>')
const origin = new URL(baseUrl).origin
await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1440, 1280, 390, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const responses = []
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => responses.push({ url: response.url(), status: response.status() }))
    await page.goto(baseUrl)
    assert.equal(await page.locator('body').getAttribute('data-place-map-style-url'), 'https://tiles.openfreemap.org/styles/liberty')
    await page.getByText('지도를 불러오는 중입니다.', { exact: true }).waitFor({ state: 'hidden', timeout: 45_000 })
    assert.equal(await page.getByRole('button', { name: '지도 다시 연결' }).count(), 0)
    await page.screenshot({ path: path.join(outputDirectory, `live-home-${width}.png`) })
    assert(responses.some((response) => response.url === `${origin}/map-assets/maplibre-6.7.0/maplibre-gl-worker.mjs` && response.status === 200))
    assert(responses.some((response) => response.url.includes('maplibre-gl-shared.mjs') && response.status === 200))
    assert(responses.some((response) => response.url.includes('tiles.openfreemap.org/') && /\/(?:\d+)\/(?:\d+)\/(?:\d+)(?:\.|$)/.test(response.url) && response.status === 200))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await page.getByRole('button', { name: '탐색 패널 접기' }).click()
    if (width === 1440) {
      await page.locator('.maplibregl-ctrl-zoom-out').click({ clickCount: 11, delay: 350 })
      await page.waitForTimeout(2000)
      await page.screenshot({ path: path.join(outputDirectory, 'live-globe.png') })
    }
    console.log(JSON.stringify({ width, publicTiles: true, worker: true, overflow: false, browserErrors: errors.length }))
    await page.close()
  }
} finally { await browser.close() }
