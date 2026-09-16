import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

// Actual React adapter and MapLibre camera, with a local source instead of public tiles.
// The wrapper exposes the SDK instance; it does not simulate camera behavior.
const webRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
const fixturePath = '/src/platform/maps/testing/camera-roundtrip/fixture.jsx'
const upstreamSource = 'https://tiles.openfreemap.org/planet'
const optionalCredit = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
const mandatoryCredits = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://example.org/new-license">Future required credit</a>'
let metadataFallback = false
let metadataCalls = 0
let origin
const sourceMetadata = () => ({ tilejson: '3.0.0', tiles: [`${origin}/fixture-empty-tile/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 0, attribution: optionalCredit + mandatoryCredits })
const style = {
  version: 8,
  glyphs: '/fixture-glyphs/{fontstack}/{range}.pbf',
  sources: {
    metadata: { type: 'vector', url: upstreamSource },
    fixture: {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a>',
    },
  },
  layers: [
    { id: 'metadata-layer', type: 'circle', source: 'metadata', 'source-layer': 'poi' },
    { id: 'background', type: 'background', paint: { 'background-color': '#eaf1f7' } },
    { id: 'fixture', type: 'circle', source: 'fixture' },
    ...[0, 5, 10, 15].map((minzoom) => ({
      id: `name-${minzoom}`, type: 'symbol', source: 'fixture', minzoom,
      layout: { 'text-field': ['case', ['has', 'name:nonlatin'],
        ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
        ['coalesce', ['get', 'name_en'], ['get', 'name']]] },
    })),
    { id: 'road-shield', type: 'symbol', source: 'fixture', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
  ],
}
const server = await createServer({
  configFile: false, root: webRoot, logLevel: 'error',
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'real-map-camera-observer', enforce: 'pre',
    resolveId(id) { if (id === 'maplibre-gl') return '\0observed-maplibre' },
    load(id) {
      if (id !== '\0observed-maplibre') return
      return `export * from 'maplibre-gl/dist/maplibre-gl.mjs';
        import { Map as ActualMap } from 'maplibre-gl/dist/maplibre-gl.mjs';
        export class Map extends ActualMap {
          constructor(options) { super(options); window.fixtureMap = this; }
        }`
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url === '/fixture-style') {
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(style))
        } else if (request.url === '/api/maps/openfreemap-source') {
          metadataCalls += 1
          const { serveOpenFreeMapSource } = await vite.ssrLoadModule('/src/platform/maps/openfreemap-source/openfreemap-source-http.ts')
          const result = await serveOpenFreeMapSource(new Request(`${origin}${request.url}`), async (url, init) => {
            assert.equal(url, upstreamSource)
            assert.equal(init.credentials, 'omit')
            assert.equal(init.redirect, 'error')
            if (metadataFallback) throw new Error('controlled fixed source failure')
            return Response.json(sourceMetadata())
          })
          response.statusCode = result.status
          for (const [name, value] of result.headers) response.setHeader(name, value)
          response.setHeader('cache-control', 'no-store')
          response.end(Buffer.from(await result.arrayBuffer()))
        } else if (request.url?.startsWith('/fixture-empty-tile/')) {
          response.setHeader('Content-Type', 'application/x-protobuf')
          response.end(Buffer.alloc(0))
        } else if (request.url === '/' || request.url === '/directions') {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<html><body data-place-map-style-url="/fixture-style" style="margin:0">
            <div id="root" style="width:100vw;height:100vh"></div>
            <script type="module" src="${fixturePath}"></script></body></html>`)
        } else next()
      })
    },
  }],
})
let browser
try {
  await server.listen()
  origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, hasTouch: true })
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let directSourceRequests = 0
  // CDP also intercepts redirected requests; Playwright page.route handles only
  // the first URL in a redirect chain and would let this public fallback escape.
  const sourceSession = await page.context().newCDPSession(page)
  await sourceSession.send('Fetch.enable', { patterns: [{ urlPattern: upstreamSource, requestStage: 'Request' }] })
  sourceSession.on('Fetch.requestPaused', async ({ requestId }) => {
    directSourceRequests += 1
    await sourceSession.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
      body: Buffer.from(JSON.stringify(sourceMetadata())).toString('base64'),
    })
  })
  for (const width of [1000, 390, 320]) {
    await page.setViewportSize({ width, height: 700 })
    await page.goto(`${origin}/directions`)
    const trigger = page.getByRole('button', { name: '길찾기', exact: true })
    const dialog = page.getByRole('dialog', { name: '길찾기 지도 선택' })
    assert.equal(await page.getByRole('link').count(), 0, 'providers are not initially exposed')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'visible' })
    const dialogBounds = await dialog.boundingBox()
    assert(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width, 'dialog fits the narrow mobile viewport')
    const close = dialog.getByRole('button', { name: '길찾기 지도 선택 닫기' })
    assert(await close.evaluate((element) => element === document.activeElement))
    for (const name of ['NAVER로 길찾기', 'Google Maps로 길찾기', '카카오맵으로 길찾기']) {
      await page.keyboard.press('Tab')
      assert(await dialog.getByRole('link', { name }).evaluate((element) => element === document.activeElement), 'native dialog keeps keyboard navigation in its choices')
    }
    await page.keyboard.press('Tab')
    assert(await close.evaluate((element) => element === document.activeElement), 'native modal focus wraps')
    await page.keyboard.press('Shift+Tab')
    assert(await dialog.getByRole('link', { name: '카카오맵으로 길찾기' }).evaluate((element) => element === document.activeElement), 'backward keyboard focus also wraps')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert(await trigger.evaluate((element) => element === document.activeElement), 'ESC restores the trigger')
    await trigger.click()
    await close.click()
    assert(await trigger.evaluate((element) => element === document.activeElement), 'close button restores the trigger')
    await trigger.click()
    await page.mouse.click(2, 2)
    await dialog.waitFor({ state: 'hidden' })
    assert(await trigger.evaluate((element) => element === document.activeElement), 'backdrop restores the trigger')
    await page.evaluate(() => window.directionFixture.setDestination({ name: '좌표 없음', location: null }))
    await page.waitForFunction(() => document.querySelector('button[aria-haspopup="dialog"]')?.disabled)
    assert.equal(await page.getByRole('link').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.fixtureMap?.loaded() === true)
  await page.getByText('지도를 불러오는 중입니다.', { exact: true }).waitFor({ state: 'hidden' })
  for (const minzoom of [0, 5, 10, 15]) {
    const field = await page.evaluate((id) => window.fixtureMap.getLayoutProperty(id, 'text-field'), `name-${minzoom}`)
    assert.deepEqual(field.slice(0, 3), ['case', ['!=', ['coalesce', ['get', 'name:ko'], ''], ''], ['get', 'name:ko']], 'actual adapter localizes name layers at every scale')
  }
  assert.deepEqual(await page.evaluate(() => window.fixtureMap.getLayoutProperty('road-shield', 'text-field')), ['to-string', ['get', 'ref']])
  await page.getByRole('link', { name: '© OpenStreetMap', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => window.fixtureMap?.getSource('metadata')?.loaded())
  assert.equal(await page.getByRole('link', { name: 'OpenFreeMap', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Future required credit', exact: true }).count(), 1)
  assert.equal(metadataCalls, 1, 'source rewrite replaces the original request instead of duplicating it')
  assert.equal(directSourceRequests, 0)

  async function settledCamera() {
    await page.waitForFunction(() => !window.fixtureMap.isMoving())
    // Flush the parent state -> adapter effect round trip, not only MapLibre's moveend.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return page.evaluate(() => ({ center: window.fixtureMap.getCenter().toArray(), zoom: window.fixtureMap.getZoom() }))
  }
  function sameCamera(actual, expected, message) {
    assert(Math.abs(actual.center[0] - expected.center[0]) < 1e-6 &&
      Math.abs(actual.center[1] - expected.center[1]) < 1e-6 &&
      Math.abs(actual.zoom - expected.zoom) < 1e-6, `${message}: ${JSON.stringify({ actual, expected })}`)
  }
  async function drag(button = 'left') {
    await page.mouse.move(500, 350)
    await page.mouse.down({ button })
    await page.mouse.move(630, 395, { steps: 12 })
    await page.mouse.up({ button })
    return settledCamera()
  }
  for (let index = 0; index < 3; index += 1) {
    const before = await settledCamera()
    const after = await drag()
    sameCamera(after, await page.evaluate(() => window.lastReportedCamera), `globe drag ${index} must not recenter from its bounding box`)
    assert.notDeepEqual(after.center, before.center, 'left-drag globe panning remains enabled')
  }
  for (const center of [[179, 35], [-179, 40], [127, 62]]) {
    await page.evaluate(({ center }) => window.fixtureMap.jumpTo({ center, zoom: 5 }), { center })
    sameCamera(await settledCamera(), { center, zoom: 5 }, 'date-line/northern camera survives viewport echo')
    if (Math.abs(center[0]) === 179) {
      const { bounds } = await page.evaluate(() => window.cameraFixture.viewport)
      assert(bounds.west > bounds.east, 'date-line viewport preserves the crossing bounds contract')
    }
  }
  const target = { bounds: { west: 126.99, east: 127.01, south: 37.49, north: 37.51 }, zoom: 15 }
  await page.evaluate((viewport) => window.cameraFixture.navigate(viewport), target)
  sameCamera(await settledCamera(), { center: [127, 37.5], zoom: 15 }, 'programmatic place navigation still works')
  await page.evaluate(() => window.fixtureMap.jumpTo({ center: [127, 62], zoom: 5 }))
  await settledCamera()
  await drag()
  const echo = await page.evaluate(() => window.cameraFixture.viewport)
  const echoCenter = [(echo.bounds.west + echo.bounds.east) / 2, (echo.bounds.south + echo.bounds.north) / 2]
  assert(Math.abs((await settledCamera()).center[1] - echoCenter[1]) > 0.001, 'equal-bounds test must have a nontrivial camera/bounds difference')
  // A later explicit caller command with the same values is not a permanently ignored echo.
  await page.evaluate((viewport) => window.cameraFixture.navigate(viewport), echo)
  sameCamera(await settledCamera(), {
    center: echoCenter, zoom: echo.zoom,
  }, 'consumed echo cannot suppress later equal-bounds navigation')
  await page.evaluate((viewport) => window.cameraFixture.navigate(viewport), target)
  const beforeRotation = await settledCamera()
  await drag('right')
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowUp')
  await settledCamera()
  assert.deepEqual(await page.evaluate(() => ({
    bearing: window.fixtureMap.getBearing(), pitch: window.fixtureMap.getPitch(),
    dragRotate: window.fixtureMap.dragRotate.isEnabled(),
    touchPitch: window.fixtureMap.touchPitch.isEnabled(),
    touchZoom: window.fixtureMap.touchZoomRotate.isEnabled(),
  })), { bearing: 0, pitch: 0, dragRotate: false, touchPitch: false, touchZoom: true })
  sameCamera(await settledCamera(), beforeRotation, 'rotation gestures do not alter the 2D camera')
  const touchSession = await page.context().newCDPSession(page)
  async function touchGesture(pointsAt) {
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pointsAt(0) })
    for (let step = 1; step <= 10; step += 1) {
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pointsAt(step / 10) })
    }
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await settledCamera()
  }
  await touchGesture((progress) => [0, 1].map((id) => ({
    id, x: 500 + Math.cos(progress * Math.PI / 3 + id * Math.PI) * 70,
    y: 350 + Math.sin(progress * Math.PI / 3 + id * Math.PI) * 70,
  })))
  await touchGesture((progress) => [0, 1].map((id) => ({ id, x: 450 + id * 100, y: 300 + progress * 100 })))
  assert.deepEqual(await page.evaluate(() => [window.fixtureMap.getBearing(), window.fixtureMap.getPitch()]), [0, 0], 'two-finger rotation/pitch are disabled')
  const beforePinch = await settledCamera()
  await touchGesture((progress) => [0, 1].map((id) => ({ id, x: 500 + (id === 0 ? -1 : 1) * (50 + progress * 70), y: 350 })))
  assert((await settledCamera()).zoom > beforePinch.zoom + 0.1, 'pinch zoom remains enabled')
  await touchSession.detach()
  const attribution = page.locator('.maplibregl-ctrl-attrib')
  if (!await attribution.getByRole('link', { name: '© OpenStreetMap', exact: true }).isVisible()) {
    await attribution.locator('summary').click()
  }
  await attribution.getByRole('link', { name: '© OpenStreetMap', exact: true }).waitFor({ state: 'visible' })
  await attribution.getByRole('link', { name: '© OpenMapTiles', exact: true }).waitFor({ state: 'visible' })
  metadataFallback = true
  await page.reload()
  await page.waitForFunction(() => window.fixtureMap?.loaded() === true && window.fixtureMap?.getSource('metadata')?.loaded())
  await page.getByRole('link', { name: 'OpenFreeMap', exact: true }).waitFor({ state: 'visible' })
  assert.equal(directSourceRequests, 1, 'a fixed redirect fallback remains loadable by the real SDK without a rewrite loop')
  assert.equal(metadataCalls, 2)
  assert((await page.evaluate(() => window.fixtureMap.getSource('metadata').attribution)).includes('Future required credit'))
  await sourceSession.detach()
  assert.deepEqual(errors, [])
  console.log('PASS: directions keyboard/modal/focus, globe/2D camera and input, labels, fixed metadata credits and redirect fallback')
} finally {
  try { await browser?.close() } finally { await server.close() }
}
