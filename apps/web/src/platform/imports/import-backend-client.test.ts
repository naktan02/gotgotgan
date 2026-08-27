import { describe, expect, it } from 'vitest'

import { createImportBackendClient } from './import-backend-client'

describe('import backend client', () => {
  it('uses only fixed import paths and keeps bearer evidence server-side', async () => {
    const calls: Array<Readonly<{ url: string; init: RequestInit }>> = []
    const client = createImportBackendClient({
      origin: 'https://place-backend.example',
      timeoutMilliseconds: 5_000,
      request: async (input, init) => {
        calls.push({ url: input.toString(), init })
        return Response.json({})
      },
    })

    await client.connections('server-access-token')
    await client.start('server-access-token', { schemaVersion: 'place-import-request.v1' })
    await client.detail(
      'server-access-token',
      '01992d20-0000-7000-8000-000000000001',
      { cursor: 'opaque cursor/+', limit: 25 },
    )
    await client.cancel('server-access-token', '01992d20-0000-7000-8000-000000000001', {})
    await client.resume('server-access-token', '01992d20-0000-7000-8000-000000000001', {})
    await client.review('server-access-token', { schemaVersion: 'place-import-review.v1' })

    expect(calls.map((call) => call.url)).toEqual([
      'https://place-backend.example/v1/provider-connections',
      'https://place-backend.example/v1/imports',
      'https://place-backend.example/v1/imports/01992d20-0000-7000-8000-000000000001?limit=25&cursor=opaque+cursor%2F%2B',
      'https://place-backend.example/v1/imports/01992d20-0000-7000-8000-000000000001/cancel',
      'https://place-backend.example/v1/imports/01992d20-0000-7000-8000-000000000001/resume',
      'https://place-backend.example/v1/import-reviews',
    ])
    expect(calls.every((call) => new Headers(call.init.headers).get('authorization') === 'Bearer server-access-token')).toBe(true)
    expect(JSON.stringify(calls)).not.toContain('profile')
    expect(JSON.stringify(calls)).not.toContain('cookie')
  })

  it('rejects credentials, paths, and unbounded timeouts in configuration', () => {
    for (const config of [
      { origin: 'https://user:secret@place.example', timeoutMilliseconds: 5_000 },
      { origin: 'https://place.example/private', timeoutMilliseconds: 5_000 },
      { origin: 'file:///tmp/place', timeoutMilliseconds: 5_000 },
      { origin: 'https://place.example', timeoutMilliseconds: 60_001 },
    ]) {
      expect(() => createImportBackendClient(config)).toThrow('Import backend configuration is invalid')
    }
  })
})
