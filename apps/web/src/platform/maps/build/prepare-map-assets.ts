import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// Next bundles the renderer, so MapLibre cannot locate sibling module workers via import.meta.url.
// Publish the exact installed worker and its relative dependency together; never use a CDN worker.
export function prepareMapAssets(applicationRoot: string) {
  const require = createRequire(path.join(applicationRoot, 'package.json'))
  const packagePath = require.resolve('maplibre-gl/package.json')
  const { version } = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }
  if (version !== '6.7.0') throw new Error('Review the MapLibre worker asset binding when upgrading MapLibre.')
  const packageRoot = path.dirname(packagePath)
  const destination = path.join(applicationRoot, 'public/map-assets/maplibre-6.7.0')
  mkdirSync(destination, { recursive: true })
  for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    copyFileSync(path.join(packageRoot, 'dist', name), path.join(destination, name))
  }
  copyFileSync(path.join(packageRoot, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'))
}
