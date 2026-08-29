import { describe, expect, it, vi } from 'vitest'

import {
  createPublishedCollectionCopyAttempt,
  PublishedCollectionCopyProblem,
} from './published-collection-copy'

const publicationId = '01992d20-0000-7000-8000-000000000020'

describe('published Collection copy', () => {
  it('sends only the public identifier, a private target identity, and target name', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.command).toMatchObject({
        kind: 'copy-published-collection',
        sourcePublicationId: publicationId,
        targetName: '성수 라멘',
      })
      expect(body.command.targetCollectionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(body).not.toHaveProperty('memberId')
      return Response.json({
        schemaVersion: 'library-command-result.v1', status: 'applied',
      }, { status: 201 })
    })

    const attempt = createPublishedCollectionCopyAttempt(
      publicationId,
      '성수 라멘',
      fetcher,
    )
    const targetCollectionId = await attempt.execute()

    expect(targetCollectionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fetcher).toHaveBeenCalledWith('/api/library/commands', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('preserves authentication failure for the member-facing UI', async () => {
    const attempt = createPublishedCollectionCopyAttempt(
      publicationId,
      '성수 라멘',
      async () => Response.json({}, { status: 401 }),
    )
    await expect(attempt.execute()).rejects.toEqual(
      new PublishedCollectionCopyProblem(401),
    )
  })

  it('retries an unknown result with the exact same idempotent command', async () => {
    const bodies: string[] = []
    const attempt = createPublishedCollectionCopyAttempt(
      publicationId,
      '성수 라멘',
      async (_input, init) => {
        bodies.push(String(init?.body))
        return bodies.length === 1
          ? Response.json({}, { status: 503 })
          : Response.json({
              schemaVersion: 'library-command-result.v1', status: 'replayed',
            })
      },
    )

    await expect(attempt.execute()).rejects.toEqual(new PublishedCollectionCopyProblem(503))
    await expect(attempt.execute()).resolves.toBe(attempt.targetCollectionId)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
  })
})
