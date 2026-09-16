import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import {
  NaverTraceForgePlaceDetailSource,
  TraceForgeRunnerClient,
} from '../src/modules/providers/index.js'

const runnerFile = process.env.PLACE_TRACEFORGE_RUNNER_FILE
const packFile = process.env.PLACE_TRACEFORGE_NAVER_PACK_FILE
const packVersion = process.env.PLACE_TRACEFORGE_NAVER_PACK_VERSION
const placeId = process.env.PLACE_TRACEFORGE_LIVE_PLACE_ID
const enabled = Boolean(runnerFile && packFile && packVersion && placeId)

it.runIf(enabled)('reads one public NAVER detail through the released Runner Kit', {
  timeout: 45_000,
}, async () => {
  if (!runnerFile || !packFile || !packVersion || !placeId) {
    throw new Error('Live Forge detail config is missing')
  }
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'place-forge-live-'))
  const client = new TraceForgeRunnerClient({
    packFiles: [packFile],
    profilePrefix: 'naver-anonymous-',
    profileRoot,
    runnerFile,
  })
  try {
    const source = new NaverTraceForgePlaceDetailSource({
      client,
      packId: 'naver',
      packVersion,
      parserVersion: 'naver-place-detail-dom.v1',
      recipeId: 'map-place-detail-dom',
    })
    const result = await source.fetch({
      providerPlaceId: placeId,
      signal: AbortSignal.timeout(40_000),
    })
    expect(result.kind).toBe('available')
    if (result.kind !== 'available') return
    expect(result.detail.name.length).toBeGreaterThan(0)
    expect(result.detail.address?.length).toBeGreaterThan(0)
    expect(result.detail.payloadChecksum).toMatch(/^[a-f0-9]{64}$/)
    expect(result.detail.acquisitionKind).toBe('browser-dom')
  } finally {
    await client.close()
    await rm(profileRoot, { force: true, recursive: true })
  }
})
