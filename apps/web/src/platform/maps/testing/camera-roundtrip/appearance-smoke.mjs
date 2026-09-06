import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

// Real public Bright tiles and the production renderer. No login or private geographic data.
const webRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
const output = fileURLToPath(new URL('../../../../../../../.runtime/ui-audit/map-appearance/', import.meta.url))
await mkdir(output, { recursive: true })
const server = await createServer({ configFile: false, root: webRoot, logLevel: 'error', esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'observe-public-map', enforce: 'pre',
    resolveId(id) { if (id === 'maplibre-gl') return '\0observed-maplibre' },
    load(id) { if (id === '\0observed-maplibre') return `export * from 'maplibre-gl/dist/maplibre-gl.mjs';
      import { Map as ActualMap } from 'maplibre-gl/dist/maplibre-gl.mjs';
      export class Map extends ActualMap { constructor(options) { super(options); window.fixtureMap = this; } }` },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url === '/') {
          response.setHeader('Content-Type', 'text/html')
          response.end('<html><body data-place-map-style-url="https://tiles.openfreemap.org/styles/bright" style="margin:0;font-family:Arial,sans-serif"><div id="root" style="width:100vw;height:100vh"></div><script type="module" src="/src/platform/maps/testing/camera-roundtrip/fixture.jsx"></script></body></html>')
        } else if (request.url === '/api/maps/openfreemap-source') {
          const { serveOpenFreeMapSource } = await vite.ssrLoadModule('/src/platform/maps/openfreemap-source/openfreemap-source-http.ts')
          const result = await serveOpenFreeMapSource(new Request(`http://127.0.0.1${request.url}`))
          response.statusCode = result.status
          for (const [key, value] of result.headers) response.setHeader(key, value)
          response.end(Buffer.from(await result.arrayBuffer()))
        } else next()
      })
    },
  }] })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(30_000)
  const errors = []
  let loadedTiles = 0
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.url().includes('tiles.openfreemap.org') && /\.pbf(?:\?|$)/.test(response.url()) && response.ok()) loadedTiles += 1 })
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.fixtureMap?.loaded())
  const markers = [
    { id: 'ramen', label: '성수 라멘 연구소', location: { latitude: 37.5445, longitude: 127.056 }, classification: { primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' }, rootTaxonomy: { key: 'food', label: '음식점' } } },
    { id: 'shoyu', label: '쇼유라멘 골목', location: { latitude: 37.5431, longitude: 127.052 }, classification: { primaryTaxonomy: { key: 'food.noodle.ramen.shoyu', label: '쇼유라멘' }, rootTaxonomy: { key: 'food', label: '음식점' } } },
    { id: 'coffee', label: '서울숲 커피', location: { latitude: 37.5455, longitude: 127.0542 }, classification: { primaryTaxonomy: { key: 'drink.coffee', label: '커피' }, rootTaxonomy: { key: 'drink', label: '카페·음료' } } },
    { id: 'unknown', label: '분류 미확인 장소', location: { latitude: 37.5413, longitude: 127.058 }, classification: null },
  ]
  await page.evaluate((markers) => window.cameraFixture.setFeatures({ markers, clusters: [] }), markers)
  for (const [name, center, zoom, width, height] of [
    ['globe-desktop', [127, 35], 1.1, 1400, 900], ['korea-desktop', [127.5, 36], 6.7, 1400, 900],
    ['seoul-desktop', [127.02, 37.55], 11, 1400, 900], ['street-desktop', [127.055, 37.544], 16, 1400, 900],
    ['street-mobile', [127.055, 37.544], 15, 390, 844], ['globe-mobile', [127, 35], 0.7, 390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(({ center, zoom }) => window.fixtureMap.jumpTo({ center, zoom }), { center, zoom })
    await page.waitForFunction(() => !window.fixtureMap.isMoving() && window.fixtureMap.areTilesLoaded())
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: `${output}${name}.png` })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  assert(loadedTiles > 0, 'real public vector tiles must load, not only an empty background')
  await page.evaluate(() => window.fixtureMap.jumpTo({ center: [127.055, 37.544], zoom: 16 }))
  await page.getByLabel('지도 장소 표시 설정').click()
  await page.getByLabel('세부 유형 아이콘', { exact: true }).check()
  await page.keyboard.press('Escape')
  const common = { latitude: 37.544, longitude: 127.055 }
  await page.evaluate(({ markers, common }) => window.cameraFixture.setFeatures({
    markers: [{ ...markers[0], id: 'selected-same', label: '선택한 동일 위치 장소', location: common }], clusters: [{ id: 'same-building', count: 25,
    location: common, bounds: { west: 127.05499, east: 127.05501, south: 37.54399, north: 37.54401 },
    coincidentPreview: { places: Array.from({ length: 20 }, (_, index) => ({ kind: 'place', placeId: `choice-${index}`, label: `같은 건물 장소 ${index + 1}`, location: common, classification: markers[index % markers.length].classification })), remainingCount: 5 } }] }), { markers, common })
  const trigger = page.getByRole('button', { name: '같은 위치의 장소 25개 선택' })
  await page.getByRole('button', { name: '선택한 동일 위치 장소 지도에서 선택' }).click()
  await trigger.focus(); await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '같은 위치의 장소 25개' })
  await dialog.waitFor({ state: 'visible' })
  const dialogBox = await dialog.boundingBox()
  assert(dialogBox.x >= 8 && dialogBox.x + dialogBox.width <= 382, 'mobile choices retain both screen margins')
  await page.screenshot({ path: `${output}coincident-mobile.png` })
  assert(await dialog.getByText('처음 20개만 표시했습니다. 나머지 5개는 현재 목록에서 확인해 주세요.').isVisible())
  await page.keyboard.press('Escape')
  assert(await trigger.evaluate((element) => element === document.activeElement))
  await trigger.click(); await dialog.getByRole('button', { name: '같은 건물 장소 3', exact: false }).click()
  assert.equal(await page.evaluate(() => window.lastSelectedPlace), 'choice-2')
  await trigger.click(); await dialog.getByRole('button', { name: '현재 목록 펼치기' }).click()
  assert.equal(await page.evaluate(() => window.placeListOpened), true)
  await page.evaluate((common) => window.cameraFixture.setFeatures((current) => ({ ...current,
    markers: current.markers.map((marker) => ({ ...marker, location: { ...common, latitude: common.latitude + 0.00015 } })) })), common)
  await trigger.focus()
  await page.evaluate(() => window.fixtureMap.jumpTo({ zoom: 17 }))
  await page.waitForFunction((common) => {
    const button = document.querySelector('button[data-place-map-feature-kind="cluster"]')
    const box = button.getBoundingClientRect()
    const origin = window.fixtureMap.getContainer().getBoundingClientRect()
    const anchor = window.fixtureMap.project([common.longitude, common.latitude])
    return Math.abs(box.x + box.width / 2 - origin.x - anchor.x) < 1 &&
      Math.abs(box.y + box.height / 2 - origin.y - anchor.y) < 1
  }, common)
  assert(await trigger.evaluate((element) => element === document.activeElement), 'camera changes restore the same keyboard feature focus')
  await page.evaluate(() => window.fixtureMap.jumpTo({ zoom: 16 }))
  await trigger.click()
  await dialog.waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await page.evaluate(() => { document.getElementById('root').style.height = '184px' })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const displayBox = await page.getByLabel('지도 장소 표시 설정').boundingBox()
  assert(displayBox.x > 120 && displayBox.x + displayBox.width < 300, 'short mobile map preserves left panel-toggle and right navigation control lanes')
  const mapBox = await page.locator('.maplibregl-map').boundingBox()
  for (const control of await page.locator('.maplibregl-ctrl-bottom-right > .maplibregl-ctrl').all()) {
    const box = await control.boundingBox()
    assert(box.y >= mapBox.y && box.y + box.height <= mapBox.y + mapBox.height,
      'every navigation and attribution control fits completely inside the 184px map')
  }
  await page.screenshot({ path: `${output}short-map-mobile.png` })
  assert.deepEqual(errors, [])
  console.log(`PASS: actual Bright public tiles=${loadedTiles}, desktop/mobile globe/Korea/Seoul/street screenshots and coincident choices at ${output}`)
} finally { try { await browser?.close() } finally { await server.close() } }
