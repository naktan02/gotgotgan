import { describe, expect, it, vi } from 'vitest'

import {
  getPublicCollection,
  getPublicWriting,
  PublicationNotFoundError,
} from './publication-backend-client'

const environment = { PLACE_BACKEND_ORIGIN: 'http://place-backend.example' }

describe('publication backend client', () => {
  it('uses fixed public paths and validates the collection projection', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'place-published-collection.v1',
      publicationId: '01992d20-0000-7000-8000-000000000001',
      visibility: 'unlisted',
      name: 'Shared',
      description: null,
      places: [{ placeId: '01992d20-0000-7000-8000-000000000003', position: 0 }],
      updatedAt: '2026-08-26T10:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getPublicCollection('01992d20-0000-7000-8000-000000000001', environment)).resolves.toMatchObject({ name: 'Shared' })
    expect(request.mock.calls[0]?.[0].toString()).toBe('http://place-backend.example/v1/public/collections/01992d20-0000-7000-8000-000000000001')
    request.mockRestore()
  })

  it('rejects private fields even when the backend responds successfully', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      kind: 'note', publicationId: 'p', visibility: 'public', body: 'safe', placeIds: ['x'],
      updatedAt: '2026-08-26T10:00:00.000Z', memberId: 'private',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getPublicWriting('p', environment)).rejects.toThrow('invalid writing')
    request.mockRestore()
  })

  it('maps absence without reflecting backend payload details', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('private row exists', { status: 404 }))
    await expect(getPublicCollection('private', environment)).rejects.toBeInstanceOf(PublicationNotFoundError)
    request.mockRestore()
  })
})
