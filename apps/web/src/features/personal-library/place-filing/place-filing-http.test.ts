import { describe, expect, it, vi } from 'vitest'

import { createPlaceFilingHttp } from './place-filing-http'

const placeId = '01992d20-3000-7000-8000-000000000001'
const collectionId = '01992d20-3000-7000-8000-000000000011'
const commandId = '01992d20-3000-7000-8000-000000000021'

describe('place filing browser client', () => {
  it('preserves a typed version conflict returned with a non-success HTTP status', async () => {
    const fetcher = vi.fn(async () => Response.json({
      schemaVersion: 'place-filing-command-result.v2',
      outcome: 'rejected',
      commandId,
      rejection: { code: 'version-conflict' },
    }, { status: 409 }))
    const client = createPlaceFilingHttp(fetcher as typeof fetch)

    await expect(client.command({
      schemaVersion: 'place-filing-command.v2',
      commandId,
      placeId,
      changes: [{
        collectionId,
        expectedCollectionRevision: 'opaque-revision',
        desired: 'included',
      }],
    })).resolves.toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'version-conflict' },
    })
  })
})
