import {
  problemSchema,
} from '@place/contracts/http'
import {
  publicProfileCommandResultSchema,
  publicProfileProjectionSchema,
  publicProfileRecordSchema,
  type PublicProfileQuery,
  type SetPublicProfileRequest,
} from '@place/contracts/profiles'

export class PublicProfileHttpProblem extends Error {
  override readonly name = 'PublicProfileHttpProblem'

  constructor(readonly status: number, readonly code?: string) {
    super(`Public Profile request failed with ${status}`)
  }
}

async function read(response: Response): Promise<unknown> {
  const value = await response.json().catch(() => undefined)
  if (!response.ok) {
    const parsed = problemSchema.safeParse(value)
    throw new PublicProfileHttpProblem(response.status, parsed.success ? parsed.data.code : undefined)
  }
  return value
}

export const publicProfileHttp = {
  async current(signal?: AbortSignal) {
    const response = await fetch('/api/profile', { cache: 'no-store', signal })
    if (response.status === 404) return undefined
    const parsed = publicProfileRecordSchema.safeParse(await read(response))
    if (!parsed.success) throw new PublicProfileHttpProblem(503)
    return parsed.data
  },
  async set(request: SetPublicProfileRequest, signal?: AbortSignal) {
    const parsed = publicProfileCommandResultSchema.safeParse(await read(await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })))
    if (!parsed.success) throw new PublicProfileHttpProblem(503)
    return parsed.data
  },
  async published(handle: string, query: PublicProfileQuery, signal?: AbortSignal) {
    const parameters = new URLSearchParams({ limit: String(query.limit) })
    if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
    const parsed = publicProfileProjectionSchema.safeParse(await read(await fetch(
      `/api/public/profiles/${encodeURIComponent(handle)}?${parameters}`,
      { cache: 'no-store', signal },
    )))
    if (!parsed.success) throw new PublicProfileHttpProblem(503)
    return parsed.data
  },
}
