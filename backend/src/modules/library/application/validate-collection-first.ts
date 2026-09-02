import {
  InvalidCollectionFirstInputError,
  type CollectionOrderMove,
  type CollectionLifecycleCommand,
  type CollectionPublicationChange,
  type ImportedCollectionMaterialization,
  type OpaqueVersion,
  type PersonalLibraryWorkspaceQuery,
  type PersonalRatingChange,
  type PlaceFilingMutation,
  type Placement,
  type PublishedCollectionCopy,
  type WriteContext,
} from '../domain/collection-first.js'

const identifierMaximum = 200
const versionMaximum = 512

function invalid(field: string, message: string): never {
  throw new InvalidCollectionFirstInputError(field, message)
}

function requireText(value: string, field: string, maximum: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    return invalid(field, `${field} must contain between 1 and ${maximum} characters`)
  }
  return normalized
}

function requireIdentifier(value: string, field: string): string {
  return requireText(value, field, identifierMaximum)
}

function requirePosition(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    invalid(field, `${field} must be an integer between 0 and 1000000`)
  }
  return value
}

export function asOpaqueVersion(value: string, field = 'version'): OpaqueVersion {
  return requireText(value, field, versionMaximum) as OpaqueVersion
}

export function normalizeWriteContext(context: WriteContext): WriteContext {
  const occurredAt = new Date(context.occurredAt)
  if (Number.isNaN(occurredAt.valueOf())) invalid('context.occurredAt', 'occurredAt must be an ISO timestamp')
  return {
    operationId: requireIdentifier(context.operationId, 'context.operationId'),
    memberId: requireIdentifier(context.memberId, 'context.memberId'),
    occurredAt: occurredAt.toISOString(),
  }
}

export function normalizePlacement(
  placement: Placement,
  movedPlaceId?: string,
  field = 'placement',
): Placement {
  if (placement.kind === 'first' || placement.kind === 'last') return placement
  const placeId = requireIdentifier(placement.placeId, `${field}.placeId`)
  if (movedPlaceId !== undefined && placeId === movedPlaceId) {
    invalid(`${field}.placeId`, 'placement anchor must differ from the moved Place')
  }
  return { kind: placement.kind, placeId }
}

function requirePageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    invalid('limit', 'limit must be an integer between 1 and 50')
  }
  return limit
}

export function normalizePersonalLibraryWorkspaceQuery(
  query: PersonalLibraryWorkspaceQuery,
): PersonalLibraryWorkspaceQuery {
  const tagIds = [...query.tagIds].sort()
  if (tagIds.length > 20 || new Set(tagIds).size !== tagIds.length) {
    invalid('tagIds', 'tagIds must contain at most 20 unique entries')
  }
  const areaKeys = [...query.areaKeys].sort()
  const taxonomyKeys = [...query.taxonomyKeys].sort()
  if (areaKeys.length > 10 || new Set(areaKeys).size !== areaKeys.length) {
    invalid('areaKeys', 'areaKeys must contain at most 10 unique entries')
  }
  if (taxonomyKeys.length > 10 || new Set(taxonomyKeys).size !== taxonomyKeys.length) {
    invalid('taxonomyKeys', 'taxonomyKeys must contain at most 10 unique entries')
  }
  return {
    memberId: requireIdentifier(query.memberId, 'memberId'),
    favoriteScope: query.favoriteScope.kind === 'all'
      ? query.favoriteScope
      : {
          kind: 'collection',
          collectionId: requireIdentifier(
            query.favoriteScope.collectionId,
            'favoriteScope.collectionId',
          ),
        },
    ratingFilter: query.ratingFilter,
    tagIds,
    tagMatch: query.tagMatch,
    areaKeys,
    taxonomyKeys,
    ...(query.collectionCursor === undefined
      ? {}
      : { collectionCursor: requireText(query.collectionCursor, 'collectionCursor', 2_000) }),
    ...(query.placeCursor === undefined
      ? {}
      : { placeCursor: requireText(query.placeCursor, 'placeCursor', 2_000) }),
    limit: requirePageLimit(query.limit),
  }
}

export function normalizePlaceFilingMutation(
  mutation: PlaceFilingMutation,
): PlaceFilingMutation {
  if (mutation.changes.length < 1 || mutation.changes.length > 50) {
    invalid('changes', 'changes must contain between 1 and 50 entries')
  }
  const placeId = requireIdentifier(mutation.placeId, 'placeId')
  const collectionIds = new Set<string>()
  const changes = mutation.changes.map((change, index) => {
    const field = `changes[${index}]`
    const collectionId = requireIdentifier(change.collectionId, `${field}.collectionId`)
    if (collectionIds.has(collectionId)) {
      invalid(`${field}.collectionId`, 'each Collection may appear only once')
    }
    collectionIds.add(collectionId)
    if (change.desired === 'excluded' && change.placement !== undefined) {
      invalid(`${field}.placement`, 'excluded changes cannot have a placement')
    }
    return {
      collectionId,
      expectedVersion: asOpaqueVersion(change.expectedVersion, `${field}.expectedVersion`),
      desired: change.desired,
      ...(change.placement === undefined
        ? {}
        : { placement: normalizePlacement(change.placement, placeId, `${field}.placement`) }),
    }
  })
  return {
    context: normalizeWriteContext(mutation.context),
    placeId,
    changes,
  }
}

export function normalizeCollectionOrderMove(input: CollectionOrderMove): CollectionOrderMove {
  const placeId = requireIdentifier(input.placeId, 'placeId')
  return {
    context: normalizeWriteContext(input.context),
    collectionId: requireIdentifier(input.collectionId, 'collectionId'),
    placeId,
    expectedVersion: asOpaqueVersion(input.expectedVersion, 'expectedVersion'),
    placement: normalizePlacement(input.placement, placeId),
  }
}

export function normalizeCollectionLifecycleCommand(
  input: CollectionLifecycleCommand,
): CollectionLifecycleCommand {
  const context = normalizeWriteContext(input.context)
  const collectionId = requireIdentifier(input.collectionId, 'collectionId')
  if (input.kind === 'create') {
    return {
      kind: 'create', context, collectionId,
      name: requireText(input.name, 'name', 120),
      description: input.description === null
        ? null
        : requireText(input.description, 'description', 2_000),
    }
  }
  const expectedVersion = asOpaqueVersion(input.expectedVersion, 'expectedVersion')
  if (input.kind === 'delete') {
    return { kind: 'delete', context, collectionId, expectedVersion }
  }
  if (
    input.name === undefined && input.description === undefined &&
    input.visibility === undefined
  ) invalid('command', 'update must change at least one Collection field')
  return {
    kind: 'update', context, collectionId, expectedVersion,
    ...(input.name === undefined ? {} : { name: requireText(input.name, 'name', 120) }),
    ...(input.description === undefined ? {} : {
      description: input.description === null
        ? null
        : requireText(input.description, 'description', 2_000),
    }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
  }
}

export function normalizeImportedCollectionMaterialization(
  input: ImportedCollectionMaterialization,
): ImportedCollectionMaterialization {
  if (input.items.length > 10_000) invalid('items', 'items must contain at most 10000 entries')
  const itemIds = new Set<string>()
  const itemPositions = new Set<number>()
  const items = input.items.map((item, index) => {
    const field = `items[${index}]`
    const sourceItemId = requireIdentifier(item.sourceItemId, `${field}.sourceItemId`)
    if (itemIds.has(sourceItemId)) invalid(`${field}.sourceItemId`, 'sourceItemId must be unique')
    itemIds.add(sourceItemId)
    const sourcePosition = requirePosition(item.sourcePosition, `${field}.sourcePosition`)
    if (itemPositions.has(sourcePosition)) {
      invalid(`${field}.sourcePosition`, 'sourcePosition must be unique within a source list')
    }
    itemPositions.add(sourcePosition)
    return {
      sourceItemId,
      providerPlaceId: requireIdentifier(item.providerPlaceId, `${field}.providerPlaceId`),
      placeId: requireIdentifier(item.placeId, `${field}.placeId`),
      sourcePosition,
    }
  })
  const target = input.target.kind === 'new'
    ? {
        kind: 'new' as const,
        collectionId: requireIdentifier(input.target.collectionId, 'target.collectionId'),
        name: requireText(input.target.name, 'target.name', 120),
      }
    : {
        kind: 'existing' as const,
        collectionId: requireIdentifier(input.target.collectionId, 'target.collectionId'),
        expectedVersion: asOpaqueVersion(input.target.expectedVersion, 'target.expectedVersion'),
      }
  return {
    context: normalizeWriteContext(input.context),
    source: {
      providerKey: requireIdentifier(input.source.providerKey, 'source.providerKey'),
      connectionId: requireIdentifier(input.source.connectionId, 'source.connectionId'),
      sourceListId: requireIdentifier(input.source.sourceListId, 'source.sourceListId'),
      sourcePosition: requirePosition(input.source.sourcePosition, 'source.sourcePosition'),
      observedName: requireText(input.source.observedName, 'source.observedName', 200),
    },
    target,
    ...(input.expectedBindingVersion === undefined
      ? {}
      : {
          expectedBindingVersion: asOpaqueVersion(
            input.expectedBindingVersion,
            'expectedBindingVersion',
          ),
        }),
    items,
  }
}

export function normalizeCollectionPublicationChange(
  input: CollectionPublicationChange,
): CollectionPublicationChange {
  return {
    context: normalizeWriteContext(input.context),
    collectionId: requireIdentifier(input.collectionId, 'collectionId'),
    expectedVersion: asOpaqueVersion(input.expectedVersion, 'expectedVersion'),
    visibility: input.visibility,
  }
}

export function normalizePublishedCollectionCopy(
  input: PublishedCollectionCopy,
): PublishedCollectionCopy {
  const selection = input.selection.kind === 'all'
    ? input.selection
    : (() => {
        if (input.selection.placeIds.length < 1 || input.selection.placeIds.length > 500) {
          invalid('selection.placeIds', 'placeIds must contain between 1 and 500 entries')
        }
        const placeIds = input.selection.placeIds.map((placeId, index) => (
          requireIdentifier(placeId, `selection.placeIds[${index}]`)
        ))
        if (new Set(placeIds).size !== placeIds.length) {
          invalid('selection.placeIds', 'placeIds must be unique')
        }
        return { kind: 'places' as const, placeIds }
      })()
  return {
    context: normalizeWriteContext(input.context),
    publicationId: requireIdentifier(input.publicationId, 'publicationId'),
    expectedPublicationVersion: asOpaqueVersion(
      input.expectedPublicationVersion,
      'expectedPublicationVersion',
    ),
    targetCollectionId: requireIdentifier(input.targetCollectionId, 'targetCollectionId'),
    targetName: requireText(input.targetName, 'targetName', 120),
    selection,
  }
}

export function normalizePersonalRatingChange(input: PersonalRatingChange): PersonalRatingChange {
  if (input.rating !== null && (
    !Number.isFinite(input.rating) ||
    input.rating < 0.1 ||
    input.rating > 5 ||
    Math.round(input.rating * 10) !== input.rating * 10
  )) invalid('rating', 'rating must be null or one decimal between 0.1 and 5.0')
  return {
    context: normalizeWriteContext(input.context),
    placeId: requireIdentifier(input.placeId, 'placeId'),
    expectedVersion: input.expectedVersion === null
      ? null
      : asOpaqueVersion(input.expectedVersion, 'expectedVersion'),
    rating: input.rating,
  }
}
