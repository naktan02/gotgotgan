import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { getPublicCollection, PublicationNotFoundError } from '@/platform/publications/publication-backend-client'

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { publicationId } = await context.params
    return NextResponse.json(await getPublicCollection(publicationId), { headers: { 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } })
  } catch (error) {
    const status = error instanceof PublicationNotFoundError ? 404 : 503
    return NextResponse.json(
      { type: 'urn:place:error:publication-unavailable', title: status === 404 ? 'Publication not found' : 'Publication unavailable', status, code: status === 404 ? 'PLACE_PUBLICATION_NOT_FOUND' : 'PLACE_PUBLICATION_UNAVAILABLE', retryable: status === 503, correlationRef: randomUUID() },
      { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
    )
  }
}
