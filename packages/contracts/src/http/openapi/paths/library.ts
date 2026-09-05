import { anonymous, bearer, browserSession, described, operation, ref } from '../model.js'
import {
  boundedCursorParameter,
  boundedLimitParameter,
  collectionCursorParameter,
  libraryAreaKeysParameter,
  libraryMapCollectionIdParameter,
  libraryMapScopeParameter,
  libraryMapViewportParameters,
  libraryPlaceStateParameter,
  libraryTagIdsParameter,
  libraryTagMatchParameter,
  libraryTaxonomyKeysParameter,
  pathParameters,
  personalLibraryRatingParameter,
  personalLibraryCollectionQueryParameter,
  personalLibrarySelectedCollectionParameter,
  personalLibraryPlaceQueryParameter,
  placeCursorParameter,
  publicCollectionSearchParameter,
  publicCollectionSortParameter,
  publicCollectionTopicKeysParameter,
  publishedCollectionLimitParameter,
} from '../parameters.js'

export const libraryPaths = {
  '/api/library/workspace': {
    get: operation('getPersonalLibraryWorkspaceForBrowserV2', {
      '200': described(
        'Return bounded Collection-backed favorites and member-owned Collections',
        'PersonalLibraryWorkspaceV2',
      ),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: browserSession,
      parameters: [
        libraryMapCollectionIdParameter,
        personalLibraryRatingParameter,
        personalLibraryCollectionQueryParameter,
        personalLibrarySelectedCollectionParameter,
        personalLibraryPlaceQueryParameter,
        libraryTagIdsParameter,
        libraryTagMatchParameter,
        libraryAreaKeysParameter,
        libraryTaxonomyKeysParameter,
        collectionCursorParameter,
        placeCursorParameter,
        boundedLimitParameter,
      ],
    }),
  },
  '/api/library/places/{placeId}/filing': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceFilingForBrowserV2', {
      '200': described('Return bounded Collection choices for one Place', 'PlaceFilingV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, parameters: [boundedCursorParameter, boundedLimitParameter] }),
  },
  '/api/library/filing-commands': {
    post: operation('applyPlaceFilingForBrowserV2', {
      '200': described('Replay one atomic Place filing command', 'PlaceFilingCommandResultV2'),
      '201': described('Apply one atomic Place filing command', 'PlaceFilingCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Reject a non-disclosed unavailable resource', 'PlaceFilingCommandResultV2'),
      '409': described('Reject a revision or operation identity conflict', 'PlaceFilingCommandResultV2'),
      '422': described('Reject an invalid atomic filing selection', 'PlaceFilingCommandResultV2'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PlaceFilingCommandRequestV2' }),
  },
  '/api/library/collection-commands': {
    post: operation('applyCollectionLifecycleForBrowserV2', {
      '200': described('Replay one Collection lifecycle command', 'CollectionLifecycleCommandResultV2'),
      '201': described('Apply one Collection lifecycle command', 'CollectionLifecycleCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Reject a non-disclosed unavailable Collection', 'CollectionLifecycleCommandResultV2'),
      '409': described('Reject a revision or operation identity conflict', 'CollectionLifecycleCommandResultV2'),
      '422': described('Reject an invalid Collection lifecycle operation', 'CollectionLifecycleCommandResultV2'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'CollectionLifecycleCommandRequestV2' }),
  },
  '/api/library/publication-copy-commands': {
    post: operation('copyPublishedCollectionForBrowserV2', {
      '200': described('Replay a published Collection copy', 'PublishedCollectionCopyCommandResultV2'),
      '201': described('Copy public Place identities and order into a new private Collection', 'PublishedCollectionCopyCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable or ineligible publication', 'PublishedCollectionCopyCommandResultV2'),
      '409': described('Reject a changed publication or reused operation identity', 'PublishedCollectionCopyCommandResultV2'),
      '422': described('Reject a selection outside the source publication', 'PublishedCollectionCopyCommandResultV2'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PublishedCollectionCopyCommandRequestV2' }),
  },
  '/v1/library/workspace': {
    get: operation('getPersonalLibraryWorkspaceV2', {
      '200': described(
        'Return bounded Collection-backed favorites and member-owned Collections',
        'PersonalLibraryWorkspaceV2',
      ),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [
        libraryMapCollectionIdParameter,
        personalLibraryRatingParameter,
        personalLibraryCollectionQueryParameter,
        personalLibrarySelectedCollectionParameter,
        personalLibraryPlaceQueryParameter,
        libraryTagIdsParameter,
        libraryTagMatchParameter,
        libraryAreaKeysParameter,
        libraryTaxonomyKeysParameter,
        collectionCursorParameter,
        placeCursorParameter,
        boundedLimitParameter,
      ],
    }),
  },
  '/v1/library/places/{placeId}/filing': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceFilingV2', {
      '200': described('Return bounded Collection choices for one Place', 'PlaceFilingV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer, parameters: [boundedCursorParameter, boundedLimitParameter] }),
  },
  '/v1/library/filing-commands': {
    post: operation('applyPlaceFilingV2', {
      '200': described('Replay one atomic Place filing command', 'PlaceFilingCommandResultV2'),
      '201': described('Apply one atomic Place filing command', 'PlaceFilingCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Reject a non-disclosed unavailable resource', 'PlaceFilingCommandResultV2'),
      '409': described('Reject a revision or operation identity conflict', 'PlaceFilingCommandResultV2'),
      '422': described('Reject an invalid atomic filing selection', 'PlaceFilingCommandResultV2'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer, requestSchema: 'PlaceFilingCommandRequestV2' }),
  },
  '/v1/library/order-commands': {
    post: operation('applyCollectionOrderV2', {
      '200': described('Replay one Collection order command', 'CollectionOrderCommandResultV2'),
      '201': described('Apply one Collection order command', 'CollectionOrderCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Reject a non-disclosed unavailable Collection', 'CollectionOrderCommandResultV2'),
      '409': described('Reject a revision or operation identity conflict', 'CollectionOrderCommandResultV2'),
      '422': described('Reject an invalid ordering anchor', 'CollectionOrderCommandResultV2'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer, requestSchema: 'CollectionOrderCommandRequestV2' }),
  },
  '/v1/library/collection-commands': {
    post: operation('applyCollectionLifecycleV2', {
      '200': described('Replay one Collection lifecycle command', 'CollectionLifecycleCommandResultV2'),
      '201': described('Apply one Collection lifecycle command', 'CollectionLifecycleCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Reject a non-disclosed unavailable Collection', 'CollectionLifecycleCommandResultV2'),
      '409': described('Reject a revision or operation identity conflict', 'CollectionLifecycleCommandResultV2'),
      '422': described('Reject an invalid Collection lifecycle operation', 'CollectionLifecycleCommandResultV2'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer, requestSchema: 'CollectionLifecycleCommandRequestV2' }),
  },
  '/v1/library/publication-copy-commands': {
    post: operation('copyPublishedCollectionV2', {
      '200': described('Replay a published Collection copy', 'PublishedCollectionCopyCommandResultV2'),
      '201': described('Copy public Place identities and order into a new private Collection', 'PublishedCollectionCopyCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable or ineligible publication', 'PublishedCollectionCopyCommandResultV2'),
      '409': described('Reject a changed publication or reused operation identity', 'PublishedCollectionCopyCommandResultV2'),
      '422': described('Reject a selection outside the source publication', 'PublishedCollectionCopyCommandResultV2'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'PublishedCollectionCopyCommandRequestV2' }),
  },
  '/v1/library/places/{placeId}': {
    parameters: [pathParameters.placeId],
    get: operation('getPlacePreferences', {
      '200': described('Return current-member Place preferences', 'LibraryPlacePreferences'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer }),
  },
  '/v1/library/places': {
    get: operation('listLibraryPlaces', {
      '200': described('Return one bounded page of authoritative member Place preferences', 'LibraryPlaceListResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [
        libraryPlaceStateParameter,
        libraryTagIdsParameter,
        libraryTagMatchParameter,
        libraryAreaKeysParameter,
        libraryTaxonomyKeysParameter,
        boundedCursorParameter,
        boundedLimitParameter,
      ],
    }),
  },
  '/v1/library/map': {
    get: operation('getLibraryMap', {
      '200': described('Represent every projected member Place in the current viewport as a point or cluster', 'LibraryMapResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [
        libraryMapScopeParameter,
        libraryMapCollectionIdParameter,
        libraryPlaceStateParameter,
        libraryTagIdsParameter,
        libraryTagMatchParameter,
        libraryAreaKeysParameter,
        libraryTaxonomyKeysParameter,
        ...libraryMapViewportParameters,
      ],
    }),
  },
  '/v1/library/place-facets': {
    get: operation('getLibraryPlaceFacets', {
      '200': described('Return bounded area and taxonomy facets derived only from current-member saved Places', 'LibraryPlaceFacetsResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer }),
  },
  '/v1/library/places/{placeId}/organization': {
    parameters: [pathParameters.placeId],
    get: operation('getLibraryPlaceOrganization', {
      '200': described(
        'Return bounded current-member Collection and Tag choices with selection state for one Place',
        'LibraryPlaceOrganizationResponse',
      ),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/library/collections': {
    get: operation('listLibraryCollections', {
      '200': described('Return one bounded page of member Collection summaries', 'LibraryCollectionListResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/library/collections/{collectionId}': {
    parameters: [{
      name: 'collectionId', in: 'path', required: true,
      schema: { type: 'string', format: 'uuid' },
    }],
    get: operation('getLibraryCollection', {
      '200': described('Return Collection metadata and one bounded Place page', 'LibraryCollectionDetailResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/library/tags': {
    get: operation('listLibraryTags', {
      '200': described('Return one bounded page of member Tag summaries', 'LibraryTagListResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/public/collections/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceCollection', {
      '200': described('Return an allowlisted public collection', 'PublishedCollection'),
      '404': ref('responses', 'ProductNotFound'),
      '400': ref('responses', 'ProductRequestInvalid'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, publishedCollectionLimitParameter],
    }),
  },
  '/v1/public/collections/{publicationId}/map': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceCollectionMap', {
      '200': described('Return an allowlisted public collection map projection', 'PublishedCollectionMap'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: anonymous, parameters: [...libraryMapViewportParameters] }),
  },
  '/v1/public/collection-directory': {
    get: operation('listDiscoverableCollectionsV2', {
      '200': described('Return moderation-aware public Collection discovery results', 'PublicCollectionDirectoryV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: anonymous,
      parameters: [
        publicCollectionSearchParameter, libraryAreaKeysParameter, libraryTaxonomyKeysParameter,
        publicCollectionTopicKeysParameter, publicCollectionSortParameter,
        boundedCursorParameter, boundedLimitParameter,
      ],
    }),
  },
  '/v1/public/discoverable-collections/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getDiscoverableCollectionV2', {
      '200': described('Return a moderation-aware discoverable Collection', 'DiscoverableCollectionV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/library/workspace/map': {
    get: operation('getPersonalLibraryMapForBrowserV2', {
      '200': described('Return viewport-complete Collection-backed favorites matching the place filters', 'PersonalLibraryMapV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, parameters: [
      libraryMapCollectionIdParameter, personalLibraryRatingParameter, personalLibraryPlaceQueryParameter,
      libraryTagIdsParameter, libraryTagMatchParameter, libraryAreaKeysParameter, libraryTaxonomyKeysParameter,
      ...libraryMapViewportParameters,
    ] }),
  },
  '/v2/library/workspace/map': {
    get: operation('getPersonalLibraryMapV2', {
      '200': described('Return owner-scoped matching Place points and clusters independently of list pagination', 'PersonalLibraryMapV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'LibraryQueryUnavailable'),
    }, { security: bearer, parameters: [
      libraryMapCollectionIdParameter, personalLibraryRatingParameter, personalLibraryPlaceQueryParameter,
      libraryTagIdsParameter, libraryTagMatchParameter, libraryAreaKeysParameter, libraryTaxonomyKeysParameter,
      ...libraryMapViewportParameters,
    ] }),
  },
}
