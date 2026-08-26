import { describe, expect, it, vi } from 'vitest'

import { WebExtensionPageJsonRequest } from '../webextensions/page-json-request.js'

describe('WebExtensionPageJsonRequest', () => {
  it('executes only an exact-origin request in an isolated matching page', async () => {
    const tabs = {
      query: vi.fn(async () => [{ id: 9 }]),
    }
    const scripting = {
      executeScript: vi.fn(async () => [{ result: {
        kind: 'response' as const,
        status: 202,
        contentType: 'application/json',
        bodyText: '{"accepted":true}',
      } }]),
    }
    const request = new WebExtensionPageJsonRequest(
      'http://localhost:3000', tabs, scripting,
    )

    await expect(request.request({
      url: 'http://localhost:3000/api/connector/captures',
      method: 'POST',
      headers: { authorization: 'PlaceConnector opaque-token' },
      body: '{"capture":true}',
      credentials: 'omit',
      redirect: 'manual',
      maximumResponseBytes: 65_536,
      signal: AbortSignal.timeout(1_000),
    })).resolves.toMatchObject({ status: 202 })

    expect(tabs.query).toHaveBeenCalledWith({ url: ['http://localhost:3000/*'] })
    expect(scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 9 },
      world: 'ISOLATED',
      func: expect.any(Function),
      args: [expect.objectContaining({
        url: 'http://localhost:3000/api/connector/captures',
        credentials: 'omit',
      }), 'http://localhost:3000'],
    }))
  })

  it('rejects a request outside the configured Place origin', async () => {
    const request = new WebExtensionPageJsonRequest(
      'https://place.example',
      { query: vi.fn(async () => [{ id: 9 }]) },
      { executeScript: vi.fn(async () => []) },
    )

    await expect(request.request({
      url: 'https://unexpected.example/api/connector/captures',
      method: 'POST', headers: {}, body: '{}', credentials: 'omit', redirect: 'manual',
      maximumResponseBytes: 65_536, signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow('target is invalid')
  })
})
