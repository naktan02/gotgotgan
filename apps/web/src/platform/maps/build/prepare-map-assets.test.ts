import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { prepareMapAssets } from './prepare-map-assets'

describe('bundled MapLibre worker deployment', () => {
  it('publishes exact installed worker, relative shared module, and license at the renderer URL', () => {
    const root = process.cwd()
    prepareMapAssets(root)
    const require = createRequire(path.join(root, 'package.json'))
    const installed = path.dirname(require.resolve('maplibre-gl/package.json'))
    const published = path.join(root, 'public/map-assets/maplibre-6.7.0')
    const digest = (file: string) => createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex')
    for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
      expect(digest(path.join(published, file))).toBe(digest(path.join(installed, 'dist', file)))
    }
    expect(readFileSync(path.join(published, 'maplibre-gl-worker.mjs'), 'utf8')).toContain('./maplibre-gl-shared.mjs')
    expect(digest(path.join(published, 'LICENSE.txt'))).toBe(digest(path.join(installed, 'LICENSE.txt')))
  })
})
