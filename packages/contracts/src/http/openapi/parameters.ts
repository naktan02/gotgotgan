import { ref } from './model.js'

export const pathParameters = {
  membershipId: {
    name: 'membershipId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  placeId: {
    name: 'placeId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  publicationId: {
    name: 'publicationId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  documentId: {
    name: 'documentId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  batchId: {
    name: 'batchId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  connectionId: {
    name: 'connectionId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  snapshotId: {
    name: 'snapshotId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  planId: {
    name: 'planId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  transferId: {
    name: 'transferId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  operationId: {
    name: 'operationId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  manifestId: {
    name: 'manifestId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  collectionId: {
    name: 'collectionId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  handle: {
    name: 'handle', in: 'path', required: true,
    schema: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$', minLength: 3, maxLength: 30 },
  },
  noticeId: {
    name: 'noticeId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  appealId: {
    name: 'appealId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
}

export const legacyConnectorPublicOriginHeader = {
  name: 'x-place-public-origin',
  in: 'header',
  required: true,
  schema: ref('schemas', 'ConnectorPublicOrigin'),
}

export const connectorCapabilityOriginHeader = {
  name: 'Origin',
  in: 'header',
  required: true,
  description: 'Exact browser origin bound to the connector capability. This is not the placeOrigin request-body field.',
  schema: ref('schemas', 'ConnectorPublicOrigin'),
}

export const boundedCursorParameter = {
  name: 'cursor', in: 'query', required: false,
  schema: { type: 'string', minLength: 1, maxLength: 2_048 },
}

export const boundedLimitParameter = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
}

export const transferOperationKindParameter = {
  name: 'kind', in: 'query', required: false,
  schema: {
    type: 'string',
    enum: ['import-capture', 'import-materialization', 'outbound-transfer', 'account-erasure'],
  },
}

export const transferOperationStateParameter = {
  name: 'state', in: 'query', required: false,
  schema: {
    type: 'string',
    enum: [
      'queued', 'running', 'retry-scheduled', 'action-required', 'partial-failure',
      'outcome-unknown', 'completed', 'cancelled', 'failed',
    ],
  },
}

export const transferConnectionQueryParameter = {
  name: 'connectionId', in: 'query', required: false,
  schema: { type: 'string', format: 'uuid' },
}

export const publishedCollectionLimitParameter = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
}

export const publicCollectionSearchParameter = {
  name: 'q', in: 'query', required: false,
  schema: { type: 'string', minLength: 1, maxLength: 120 },
}

export const publicCollectionTopicKeysParameter = {
  name: 'topicKeys', in: 'query', required: false, style: 'form', explode: true,
  schema: {
    type: 'array', maxItems: 10, uniqueItems: true,
    items: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' },
  },
}

export const publicCollectionSortParameter = {
  name: 'sort', in: 'query', required: false,
  schema: { type: 'string', enum: ['recent', 'largest', 'name'], default: 'recent' },
}

export const libraryPlaceStateParameter = {
  name: 'state', in: 'query', required: false,
  schema: { type: 'string', enum: ['saved', 'wanted', 'rated'], default: 'saved' },
}

export const libraryTagIdsParameter = {
  name: 'tagIds', in: 'query', required: false, style: 'form', explode: true,
  schema: {
    type: 'array', maxItems: 20, uniqueItems: true,
    items: { type: 'string', format: 'uuid' },
  },
}

export const libraryTagMatchParameter = {
  name: 'tagMatch', in: 'query', required: false,
  schema: { type: 'string', enum: ['all', 'any'], default: 'all' },
}

export const libraryAreaKeysParameter = {
  name: 'areaKeys', in: 'query', required: false, style: 'form', explode: true,
  schema: {
    type: 'array', maxItems: 10, uniqueItems: true,
    items: { type: 'string', pattern: '^area_[A-Za-z0-9_-]{22}$' },
  },
}

export const libraryTaxonomyKeysParameter = {
  name: 'taxonomyKeys', in: 'query', required: false, style: 'form', explode: true,
  schema: {
    type: 'array', maxItems: 10, uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 128 },
  },
}

export const libraryMapScopeParameter = {
  name: 'scope', in: 'query', required: true,
  schema: { type: 'string', enum: ['state', 'collection'] },
}

export const libraryMapCollectionIdParameter = {
  name: 'collectionId', in: 'query', required: false,
  schema: { type: 'string', format: 'uuid' },
}

export const personalLibraryRatingParameter = {
  name: 'rating', in: 'query', required: false,
  schema: { type: 'string', enum: ['any', 'rated', 'unrated'], default: 'any' },
}

export const collectionCursorParameter = {
  name: 'collectionCursor', in: 'query', required: false,
  schema: { type: 'string', minLength: 1, maxLength: 2_048 },
}

export const placeCursorParameter = {
  name: 'placeCursor', in: 'query', required: false,
  schema: { type: 'string', minLength: 1, maxLength: 2_048 },
}

export const libraryMapViewportParameters = [
  { name: 'west', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
  { name: 'south', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
  { name: 'east', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
  { name: 'north', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
  { name: 'zoom', in: 'query', required: true, schema: { type: 'integer', minimum: 0, maximum: 22 } },
] as const

export const writingKindParameter = {
  name: 'kind', in: 'query', required: false,
  schema: { type: 'string', enum: ['all', 'note', 'entry'], default: 'all' },
}

export const writingPlaceIdParameter = {
  name: 'placeId', in: 'query', required: false,
  schema: { type: 'string', format: 'uuid' },
}

export const importBatchStateParameter = {
  name: 'state', in: 'query', required: false,
  schema: {
    type: 'string',
    enum: [
      'all', 'queued', 'running', 'partial', 'enriching', 'needs-user-action',
      'needs-review', 'completed', 'failed', 'cancelled',
    ],
    default: 'all',
  },
}

export const importItemLimitParameter = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 200, default: 200 },
}
