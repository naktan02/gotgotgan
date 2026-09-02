import { randomUUID } from 'node:crypto'

import {
  getPublicCollection,
  getPublicCollectionDirectory,
  getPublicCollectionMap,
  getDiscoverableCollection,
  getPublicPlaceDetail,
  getPublicWriting,
  PublicPlaceNotFoundError,
  PublicPlaceRetiredError,
  PublicationNotFoundError,
} from './publication-backend-client'
import {
  placeIdentifierParamsSchema,
  publicationIdentifierParamsSchema,
  publishedCollectionMapQuerySchema,
  publishedCollectionQuerySchema,
} from '@place/contracts/http'
import {
  discoverableCollectionParamsV2Schema,
  discoverableCollectionQueryV2Schema,
  publicCollectionDirectoryQueryV2Schema,
} from '@place/contracts/library'

type Dependencies = Readonly<{
  getCollection: (
    publicationId: string,
    query: Parameters<typeof getPublicCollection>[1],
  ) => Promise<unknown>
  getDirectory: (query: Parameters<typeof getPublicCollectionDirectory>[0]) => Promise<unknown>
  getDiscoverable: (
    publicationId: string,
    query: Parameters<typeof getDiscoverableCollection>[1],
  ) => Promise<unknown>
  getCollectionMap: (
    publicationId: string,
    query: Parameters<typeof getPublicCollectionMap>[1],
  ) => Promise<unknown>
  getPlace: (placeId: string) => Promise<unknown>
  getWriting: (publicationId: string) => Promise<unknown>
  createCorrelationRef: () => string
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function queryValues(request: Request): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in values) return undefined
    values[key] = value
  }
  return values
}

function directoryQueryValues(request: Request): Record<string, string | string[]> | undefined {
  const repeated = new Set(['areaKeys', 'taxonomyKeys', 'topicKeys'])
  const values: Record<string, string | string[]> = {}
  for (const [key, value] of new URL(request.url).searchParams) {
    if (repeated.has(key)) {
      const current = values[key]
      values[key] = Array.isArray(current) ? [...current, value] : [value]
    } else if (key in values) {
      return undefined
    } else values[key] = value
  }
  return values
}

function problem(
  status: 400 | 404 | 410 | 503,
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
        headers: privateHeaders,
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

  async function readPlace(operation: () => Promise<unknown>): Promise<Response> {
    try {
      return Response.json(await operation(), { headers: privateHeaders })
    } catch (error) {
      const notFound = error instanceof PublicPlaceNotFoundError
      const retired = error instanceof PublicPlaceRetiredError
      return problem(
        notFound ? 404 : retired ? 410 : 503,
        notFound ? 'PLACE_NOT_FOUND' : retired ? 'PLACE_RETIRED' : 'PLACE_DETAIL_UNAVAILABLE',
        notFound ? 'Place not found' : retired ? 'Place is retired' : 'Place detail unavailable',
        !notFound && !retired,
        dependencies.createCorrelationRef(),
      )
    }
  }

  return {
    directory(request: Request): Promise<Response> {
      const values = directoryQueryValues(request)
      const query = publicCollectionDirectoryQueryV2Schema.safeParse(values)
      if (!query.success) {
        return Promise.resolve(problem(
          400, 'PLACE_PUBLIC_COLLECTION_DIRECTORY_QUERY_INVALID',
          'Public Collection directory query is invalid', false,
          dependencies.createCorrelationRef(),
        ))
      }
      return read(() => dependencies.getDirectory(query.data))
    },
    discoverable(publicationId: string, request: Request): Promise<Response> {
      const identifier = discoverableCollectionParamsV2Schema.safeParse({ publicationId })
      const query = discoverableCollectionQueryV2Schema.safeParse(queryValues(request))
      if (!identifier.success) {
        return Promise.resolve(problem(
          404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found', false,
          dependencies.createCorrelationRef(),
        ))
      }
      if (!query.success) {
        return Promise.resolve(problem(
          400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid', false,
          dependencies.createCorrelationRef(),
        ))
      }
      return read(() => dependencies.getDiscoverable(identifier.data.publicationId, query.data))
    },
    collection(publicationId: string, request: Request): Promise<Response> {
      const identifier = publicationIdentifierParamsSchema.safeParse({ publicationId })
      const values = queryValues(request)
      const query = publishedCollectionQuerySchema.safeParse(values)
      if (!identifier.success) {
        return Promise.resolve(problem(
          404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found', false,
          dependencies.createCorrelationRef(),
        ))
      }
      if (!query.success) {
        return Promise.resolve(problem(
          400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid', false,
          dependencies.createCorrelationRef(),
        ))
      }
      return read(() => dependencies.getCollection(identifier.data.publicationId, query.data))
    },
    collectionMap(publicationId: string, request: Request): Promise<Response> {
      const identifier = publicationIdentifierParamsSchema.safeParse({ publicationId })
      const values = queryValues(request)
      const query = publishedCollectionMapQuerySchema.safeParse(values)
      if (!identifier.success) {
        return Promise.resolve(problem(
          404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found', false,
          dependencies.createCorrelationRef(),
        ))
      }
      if (!query.success) {
        return Promise.resolve(problem(
          400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid', false,
          dependencies.createCorrelationRef(),
        ))
      }
      return read(() => dependencies.getCollectionMap(identifier.data.publicationId, query.data))
    },
    place(placeId: string): Promise<Response> {
      const identifier = placeIdentifierParamsSchema.safeParse({ placeId })
      if (!identifier.success) {
        return Promise.resolve(problem(
          404, 'PLACE_NOT_FOUND', 'Place not found', false,
          dependencies.createCorrelationRef(),
        ))
      }
      return readPlace(() => dependencies.getPlace(identifier.data.placeId))
    },
    writing(publicationId: string): Promise<Response> {
      return read(() => dependencies.getWriting(publicationId))
    },
  }
}

export const browserPublicationHttp = createBrowserPublicationHttp({
  getCollection: getPublicCollection,
  getDirectory: getPublicCollectionDirectory,
  getDiscoverable: getDiscoverableCollection,
  getCollectionMap: getPublicCollectionMap,
  getPlace: getPublicPlaceDetail,
  getWriting: getPublicWriting,
  createCorrelationRef: randomUUID,
})
