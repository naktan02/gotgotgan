import { randomUUID } from 'node:crypto'

import {
  getPublicCollection,
  getPublicWriting,
  PublicationNotFoundError,
} from './publication-backend-client'

type Dependencies = Readonly<{
  getCollection: (publicationId: string) => Promise<unknown>
  getWriting: (publicationId: string) => Promise<unknown>
  createCorrelationRef: () => string
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function problem(
  status: 404 | 503,
  code: string,
  title: string,
  retryable: boolean,
  correlationRef: string,
): Response {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title,
    status,
    code,
    retryable,
    correlationRef,
  }, {
    status,
    headers: { ...privateHeaders, 'content-type': 'application/problem+json' },
  })
}

export function createBrowserPublicationHttp(dependencies: Dependencies) {
  async function read(operation: () => Promise<unknown>): Promise<Response> {
    try {
      return Response.json(await operation(), {
        headers: {
          ...privateHeaders,
          'cache-control': 'public, max-age=60',
        },
      })
    } catch (error) {
      const notFound = error instanceof PublicationNotFoundError
      return problem(
        notFound ? 404 : 503,
        notFound ? 'PLACE_PUBLICATION_NOT_FOUND' : 'PLACE_PUBLICATION_UNAVAILABLE',
        notFound ? 'Publication not found' : 'Publication unavailable',
        !notFound,
        dependencies.createCorrelationRef(),
      )
    }
  }

  return {
    collection(publicationId: string): Promise<Response> {
      return read(() => dependencies.getCollection(publicationId))
    },
    writing(publicationId: string): Promise<Response> {
      return read(() => dependencies.getWriting(publicationId))
    },
  }
}

export const browserPublicationHttp = createBrowserPublicationHttp({
  getCollection: getPublicCollection,
  getWriting: getPublicWriting,
  createCorrelationRef: randomUUID,
})
