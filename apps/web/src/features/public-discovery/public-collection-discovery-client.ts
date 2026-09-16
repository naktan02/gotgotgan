import { problemSchema } from '@place/contracts/http'
import {
  discoverableCollectionResponseV2Schema,
  publicCollectionDirectoryQueryV2Schema,
  publicCollectionDirectoryResponseV2Schema,
  publishedCollectionCopyCommandRequestV2Schema,
  publishedCollectionCopyCommandResultV2Schema,
  type DiscoverableCollectionResponseV2,
  type PublicCollectionDirectoryResponseV2,
} from '@place/contracts/library'
import { publicProfileReportResultSchema } from '@place/contracts/profiles'

import {
  type DiscoveryCollection,
  type DiscoveryCollectionDetail,
  type DiscoveryDirectoryPage,
  type DiscoveryFilters,
  type DiscoveryGateway,
  DiscoveryHttpProblem,
  type DiscoveryPlace,
} from './public-collection-discovery-model'

async function value(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

function failure(response: Response, body: unknown): DiscoveryHttpProblem {
  const parsed = problemSchema.safeParse(body)
  const rejected = publishedCollectionCopyCommandResultV2Schema.safeParse(body)
  return new DiscoveryHttpProblem(
    response.status,
    parsed.success ? parsed.data.code
      : rejected.success && rejected.data.outcome === 'rejected' ? rejected.data.rejection.code
        : undefined,
  )
}

function place(item: PublicCollectionDirectoryResponseV2['items'][number]['previewPlaces'][number]): DiscoveryPlace {
  return {
    placeId: item.placeId,
    position: item.position,
    place: item.place === null ? null : {
      placeId: item.place.placeId,
      name: item.place.name,
      areaLabel: item.place.areaLabel,
      location: item.place.location,
      taxonomyLabel: item.place.primaryTaxonomy?.label ?? null,
    },
  }
}

function collection(item: PublicCollectionDirectoryResponseV2['items'][number]): DiscoveryCollection {
  return { ...item, previewPlaces: item.previewPlaces.map(place) }
}

function directory(page: PublicCollectionDirectoryResponseV2): DiscoveryDirectoryPage {
  return {
    items: page.items.map(collection),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    availableFilters: page.availableFilters,
  }
}

function detail(item: DiscoverableCollectionResponseV2): DiscoveryCollectionDetail {
  return {
    publicationId: item.publicationId,
    publicationVersion: item.publicationVersion,
    name: item.name,
    description: item.description,
    placeCount: item.placeCount,
    updatedAt: item.updatedAt,
    owner: item.owner,
    topics: item.topics,
    previewPlaces: item.places.slice(0, 6).map(place),
    places: item.places.map(place),
    ...(item.nextCursor === undefined ? {} : { nextCursor: item.nextCursor }),
  }
}

function queryString(filters: DiscoveryFilters, cursor?: string): URLSearchParams {
  const parsed = publicCollectionDirectoryQueryV2Schema.parse({
    ...(filters.query === '' ? {} : { q: filters.query }),
    areaKeys: filters.areaKey === '' ? [] : [filters.areaKey],
    taxonomyKeys: filters.taxonomyKey === '' ? [] : [filters.taxonomyKey],
    topicKeys: filters.topicKey === '' ? [] : [filters.topicKey],
    sort: filters.sort,
    ...(cursor === undefined ? {} : { cursor }),
    limit: 20,
  })
  const parameters = new URLSearchParams({ sort: parsed.sort, limit: String(parsed.limit) })
  if (parsed.q !== undefined) parameters.set('q', parsed.q)
  if (parsed.cursor !== undefined) parameters.set('cursor', parsed.cursor)
  for (const areaKey of parsed.areaKeys) parameters.append('areaKeys', areaKey)
  for (const taxonomyKey of parsed.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
  for (const topicKey of parsed.topicKeys) parameters.append('topicKeys', topicKey)
  return parameters
}

export function createPublicCollectionDiscoveryGateway(fetcher: typeof fetch = fetch): DiscoveryGateway {
  return {
    async directory(input, signal) {
      const response = await fetcher(`/api/public/collection-directory?${queryString(input, input.cursor)}`, {
        cache: 'no-store', signal,
      })
      const body = await value(response)
      if (!response.ok) throw failure(response, body)
      const parsed = publicCollectionDirectoryResponseV2Schema.safeParse(body)
      if (!parsed.success) throw new DiscoveryHttpProblem(503)
      return directory(parsed.data)
    },

    async detail(publicationId, cursor, signal) {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(
        `/api/public/discoverable-collections/${encodeURIComponent(publicationId)}?${parameters}`,
        { cache: 'no-store', signal },
      )
      const body = await value(response)
      if (!response.ok) throw failure(response, body)
      const parsed = discoverableCollectionResponseV2Schema.safeParse(body)
      if (!parsed.success) throw new DiscoveryHttpProblem(503)
      return detail(parsed.data)
    },

    createCopyAttempt({ collection: source, selection }) {
      const targetCollectionId = crypto.randomUUID()
      const request = publishedCollectionCopyCommandRequestV2Schema.parse({
        schemaVersion: 'published-collection-copy-command.v2',
        commandId: crypto.randomUUID(),
        sourcePublicationId: source.publicationId,
        expectedPublicationVersion: source.publicationVersion,
        target: { collectionId: targetCollectionId, name: source.name },
        selection,
      })
      const body = JSON.stringify(request)
      return {
        targetCollectionId,
        async execute(signal) {
          const response = await fetcher('/api/library/publication-copy-commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal,
          })
          const responseBody = await value(response)
          if (!response.ok) throw failure(response, responseBody)
          const parsed = publishedCollectionCopyCommandResultV2Schema.safeParse(responseBody)
          if (!parsed.success || parsed.data.outcome !== 'accepted') {
            throw new DiscoveryHttpProblem(503)
          }
        },
      }
    },

    async report(handle, reason, signal) {
      const response = await fetcher(`/api/public/profiles/${encodeURIComponent(handle)}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId: crypto.randomUUID(), reason }),
        signal,
      })
      const body = await value(response)
      if (!response.ok) throw failure(response, body)
      if (!publicProfileReportResultSchema.safeParse(body).success) {
        throw new DiscoveryHttpProblem(503)
      }
    },
  }
}

export const publicCollectionDiscoveryGateway = createPublicCollectionDiscoveryGateway()
