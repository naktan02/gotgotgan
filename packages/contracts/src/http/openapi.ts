import { z, type ZodType } from 'zod'

import {
  connectorCaptureBatchSchema,
  connectorCaptureReceiptSchema,
  connectorGrantRequestSchema,
  connectorGrantSchema,
  connectorPublicOriginSchema,
} from '../connector/index.js'

import {
  authorityRoleChangeRequestSchema,
  authorityRoleChangeResultSchema,
  currentMembershipConsentsSchema,
  currentMembershipSchema,
  membershipConsentSchema,
  membershipOnboardingRequestSchema,
  membershipOnboardingResultSchema,
  problemSchema,
} from './access.js'
import {
  addCollectionPlaceCommandSchema,
  copyPublishedCollectionCommandSchema,
  createCollectionCommandSchema,
  createEntryCommandSchema,
  createNoteCommandSchema,
  createTagCommandSchema,
  deleteCollectionCommandSchema,
  deleteTagCommandSchema,
  libraryCommandRequestSchema,
  moveCollectionPlaceCommandSchema,
  publishedCollectionSchema,
  publishedWritingSchema,
  removeCollectionPlaceCommandSchema,
  renameCollectionCommandSchema,
  renameTagCommandSchema,
  setPlacePreferencesCommandSchema,
  tagPlaceCommandSchema,
  untagPlaceCommandSchema,
  updateEntryCommandSchema,
  updateNoteCommandSchema,
  visitRecordRequestSchema,
  writingCommandRequestSchema,
} from './content.js'
import {
  placeImportBatchDetailSchema,
  placeImportBatchListSchema,
  placeImportBatchSchema,
  placeImportCancelRequestSchema,
  placeImportRequestSchema,
  placeImportResumeRequestSchema,
  placeImportReviewRequestSchema,
  placeImportReviewResultSchema,
  providerConnectionListSchema,
} from '../imports/index.js'
import {
  libraryCommandResultSchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionListResponseSchema,
  libraryPlacePreferencesResponseSchema,
  libraryPlaceOrganizationResponseSchema,
  libraryPlaceListResponseSchema,
  libraryTagListResponseSchema,
} from '../library/index.js'
import { placeDetailResponseSchema } from '../places/index.js'
import {
  visitHistoryResponseSchema,
  visitRecordResultSchema,
  visitSummaryResponseSchema,
} from '../visits/index.js'
import {
  writingCommandResultSchema,
  writingDetailResponseSchema,
  writingListResponseSchema,
} from '../writing/index.js'
import {
  placeSearchRequestSchema,
  placeSearchResponseSchema,
  placeSuggestionMaterializationRequestSchema,
  placeSuggestionMaterializationResponseSchema,
  placeSuggestionSelectionRequestSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsRequestSchema,
  placeSuggestionsResponseSchema,
  providerPlaceDetailRequestSchema,
  providerPlaceDetailSchema,
  taxonomyProjectionSchema,
} from '../search/index.js'
import { processStatusSchema } from './system.js'

const anonymous: readonly unknown[] = []
const bearer = [{ placeBearer: [] }]
const browserSession = [{ placeBrowserSession: [] }]
const connectorGrant = [{ placeConnector: [] }]
const optionalBearer = [{ placeBearer: [] }, {}]

const ref = (section: 'responses' | 'schemas', name: string) => ({
  $ref: `#/components/${section}/${name}`,
})
const described = (description: string, schemaName?: string) => ({
  description,
  ...(schemaName === undefined ? {} : {
    content: { 'application/json': { schema: ref('schemas', schemaName) } },
  }),
})

function requestBody(schemaName: string) {
  return {
    required: true,
    content: { 'application/json': { schema: ref('schemas', schemaName) } },
  }
}

function operation(
  operationId: string,
  responses: Readonly<Record<string, unknown>>,
  options: Readonly<{
    parameters?: readonly unknown[]
    security?: readonly unknown[]
    requestSchema?: string
    summary?: string
  }> = {},
) {
  return {
    operationId,
    summary: options.summary ?? operationId,
    ...(options.security === undefined ? {} : { security: options.security }),
    ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
    ...(options.requestSchema === undefined ? {} : {
      requestBody: requestBody(options.requestSchema),
    }),
    responses,
  }
}

const pathParameters = {
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
  collectionId: {
    name: 'collectionId', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  },
}

const connectorOriginHeader = {
  name: 'x-place-public-origin',
  in: 'header',
  required: true,
  schema: ref('schemas', 'ConnectorPublicOrigin'),
}

const boundedCursorParameter = {
  name: 'cursor', in: 'query', required: false,
  schema: { type: 'string', minLength: 1, maxLength: 2_048 },
}

const boundedLimitParameter = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
}

const libraryPlaceStateParameter = {
  name: 'state', in: 'query', required: false,
  schema: { type: 'string', enum: ['saved', 'wanted', 'rated'], default: 'saved' },
}

const libraryTagIdsParameter = {
  name: 'tagIds', in: 'query', required: false, style: 'form', explode: true,
  schema: {
    type: 'array', maxItems: 20, uniqueItems: true,
    items: { type: 'string', format: 'uuid' },
  },
}

const libraryTagMatchParameter = {
  name: 'tagMatch', in: 'query', required: false,
  schema: { type: 'string', enum: ['all', 'any'], default: 'all' },
}

const writingKindParameter = {
  name: 'kind', in: 'query', required: false,
  schema: { type: 'string', enum: ['all', 'note', 'entry'], default: 'all' },
}

const importBatchStateParameter = {
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

const importItemLimitParameter = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 200, default: 200 },
}

const paths = {
  '/healthz': { get: operation('getPlaceHealth', {
    '200': described('Process is alive', 'ProcessStatus'),
  }) },
  '/readyz': { get: operation('getPlaceReadiness', {
    '200': described('Process can accept traffic', 'ProcessStatus'),
    '503': described('One or more required process dependencies are unavailable', 'ProcessStatus'),
  }) },
  '/api/auth/oidc/start': { get: operation('startPlaceBrowserLogin', {
    '302': described('Redirect to the configured Identity authorization endpoint'),
    '503': ref('responses', 'BrowserAuthUnavailable'),
  }) },
  '/api/auth/oidc/callback': { get: operation('completePlaceBrowserLogin', {
    '303': described('Create an opaque browser session and redirect locally'),
    '400': ref('responses', 'BrowserAuthRejected'),
    '503': ref('responses', 'BrowserAuthUnavailable'),
  }) },
  '/api/auth/logout': { post: operation('endPlaceBrowserSession', {
    '303': described('Delete the server-side session and redirect locally'),
    '503': ref('responses', 'BrowserAuthUnavailable'),
  }) },
  '/api/connector/grants': { post: operation('issuePlaceConnectorGrantForBrowser', {
    '200': described('Replay the operation with a rotated connector token', 'ConnectorGrant'),
    '201': described('Create an origin-bound connector operation', 'ConnectorGrant'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, {
    security: browserSession,
    requestSchema: 'ConnectorGrantRequest',
  }) },
  '/api/connector/captures': { post: operation('submitPlaceConnectorCaptureForBrowser', {
    '200': described('Replay an already committed capture', 'ConnectorCaptureReceipt'),
    '202': described('Accept and durably commit a capture', 'ConnectorCaptureReceipt'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'ConnectorGrantInvalid'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, {
    security: connectorGrant,
    requestSchema: 'ConnectorCaptureBatch',
  }) },
  '/api/membership-consents/current': { get: operation(
    'getCurrentPlaceMembershipConsentsForBrowser',
    {
      '200': described('Return current consent versions', 'CurrentMembershipConsents'),
      '503': ref('responses', 'BrowserMembershipUnavailable'),
    },
    { security: anonymous },
  ) },
  '/api/memberships/onboarding': { post: operation(
    'completePlaceBrowserMembershipOnboarding',
    {
      '200': described('Return the existing membership', 'MembershipOnboardingResult'),
      '201': described('Create a non-elevated membership', 'MembershipOnboardingResult'),
      '400': ref('responses', 'OnboardingRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '409': ref('responses', 'MembershipConsentRequired'),
      '503': ref('responses', 'BrowserMembershipUnavailable'),
    },
    { security: anonymous, requestSchema: 'MembershipOnboardingRequest' },
  ) },
  '/api/places/{placeId}': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceDetailForBrowser', {
      '200': described('Return Place detail with the requesting member personal state', 'PlaceDetailResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession }),
  },
  '/api/library/places': { get: operation('listPlaceLibraryPlacesForBrowser', {
    '200': described('Return a bounded member Place preference page', 'LibraryPlaceListResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, {
    security: browserSession,
    parameters: [
      libraryPlaceStateParameter,
      libraryTagIdsParameter,
      libraryTagMatchParameter,
      boundedCursorParameter,
      boundedLimitParameter,
    ],
  }) },
  '/api/library/places/{placeId}/organization': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceLibraryOrganizationForBrowser', {
      '200': described(
        'Return bounded current-member Collection and Tag choices with selection state for one Place',
        'LibraryPlaceOrganizationResponse',
      ),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: browserSession,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/library/collections': { get: operation('listPlaceLibraryCollectionsForBrowser', {
    '200': described('Return a bounded member Collection page', 'LibraryCollectionListResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, {
    security: browserSession,
    parameters: [boundedCursorParameter, boundedLimitParameter],
  }) },
  '/api/library/collections/{collectionId}': {
    parameters: [pathParameters.collectionId],
    get: operation('getPlaceLibraryCollectionForBrowser', {
      '200': described('Return Collection metadata and a bounded Place page', 'LibraryCollectionDetailResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: browserSession,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/library/tags': { get: operation('listPlaceLibraryTagsForBrowser', {
    '200': described('Return a bounded member Tag page', 'LibraryTagListResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, {
    security: browserSession,
    parameters: [boundedCursorParameter, boundedLimitParameter],
  }) },
  '/api/library/commands': { post: operation('applyPlaceLibraryCommandForBrowser', {
    '200': described('Return an idempotently replayed command result', 'LibraryCommandResult'),
    '201': described('Return an applied command result', 'LibraryCommandResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '409': ref('responses', 'ProductConflict'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: browserSession, requestSchema: 'LibraryCommandRequest' }) },
  '/api/imports/connections': { get: operation('listPlaceProviderConnectionsForBrowser', {
    '200': described('Return sanitized provider connection metadata', 'ProviderConnectionList'),
    '401': ref('responses', 'AuthenticationRequired'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: browserSession }) },
  '/api/imports': { post: operation('requestPlaceImportForBrowser', {
    '200': described('Return an idempotently replayed import batch', 'PlaceImportBatch'),
    '202': described('Queue a connected-account import', 'PlaceImportBatch'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: browserSession, requestSchema: 'PlaceImportRequest' }) },
  '/api/imports/{batchId}': {
    parameters: [pathParameters.batchId],
    get: operation('getPlaceImportForBrowser', {
      '200': described('Return a bounded import preview and progress', 'PlaceImportBatchDetail'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: browserSession,
      parameters: [boundedCursorParameter, importItemLimitParameter],
    }),
  },
  '/api/imports/{batchId}/cancel': {
    parameters: [pathParameters.batchId],
    post: operation('cancelPlaceImportForBrowser', {
      '200': described('Return the cancelled import batch', 'PlaceImportBatch'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PlaceImportCancelRequest' }),
  },
  '/api/imports/{batchId}/resume': {
    parameters: [pathParameters.batchId],
    post: operation('resumePlaceImportForBrowser', {
      '200': described('Return the resumed import batch', 'PlaceImportBatch'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PlaceImportResumeRequest' }),
  },
  '/api/import-reviews': { post: operation('reviewPlaceImportItemForBrowser', {
    '200': described('Return an idempotent import review receipt', 'PlaceImportReviewResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '409': ref('responses', 'ProductConflict'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: browserSession, requestSchema: 'PlaceImportReviewRequest' }) },
  '/v1/me': { get: operation('getCurrentPlaceMembership', {
    '200': described('Return the safe current membership', 'CurrentMembership'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
  }, { security: bearer }) },
  '/v1/memberships/onboarding': { post: operation(
    'completePlaceMembershipOnboarding',
    {
      '200': described('Return an existing membership', 'MembershipOnboardingResult'),
      '201': described('Create a non-elevated membership', 'MembershipOnboardingResult'),
      '400': ref('responses', 'OnboardingRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '409': ref('responses', 'MembershipConsentRequired'),
      '503': ref('responses', 'MembershipOnboardingUnavailable'),
    },
    { security: bearer, requestSchema: 'MembershipOnboardingRequest' },
  ) },
  '/v1/membership-consents/current': { get: operation(
    'getCurrentPlaceMembershipConsents',
    {
      '200': described('Return current consent versions', 'CurrentMembershipConsents'),
      '503': ref('responses', 'MembershipOnboardingUnavailable'),
    },
    { security: anonymous },
  ) },
  '/v1/administration/memberships/{membershipId}/authority-role': {
    parameters: [pathParameters.membershipId],
    patch: operation('changePlaceMembershipAuthorityRole', {
      '200': described('Return the audited authority mutation', 'AuthorityRoleChangeResult'),
      '400': ref('responses', 'AuthorityRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'MembershipNotFound'),
      '409': ref('responses', 'AuthorityChangeRejected'),
      '503': ref('responses', 'AuthorityChangeUnavailable'),
    }, { security: bearer, requestSchema: 'AuthorityRoleChangeRequest' }),
  },
  '/api/public/collections/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceCollectionForBrowser', {
      '200': described('Return a validated public collection', 'PublishedCollection'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: anonymous }),
  },
  '/api/public/writing/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceWritingForBrowser', {
      '200': described('Return validated public writing', 'PublishedWriting'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: anonymous }),
  },
  '/v1/library/commands': { post: operation('applyPlaceLibraryCommand', {
    '200': described('Return an idempotently replayed command result', 'LibraryCommandResult'),
    '201': described('Return an applied command result', 'LibraryCommandResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '409': ref('responses', 'ProductConflict'),
  }, { security: bearer, requestSchema: 'LibraryCommandRequest' }) },
  '/v1/provider-connections': { get: operation('listPlaceProviderConnections', {
    '200': described('Return sanitized provider connection metadata', 'ProviderConnectionList'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
  }, { security: bearer }) },
  '/v1/connector-grants': { post: operation('issuePlaceConnectorGrant', {
    '200': described('Replay the operation with a rotated connector token', 'ConnectorGrant'),
    '201': described('Create an origin-bound connector operation', 'ConnectorGrant'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
  }, {
    security: bearer,
    requestSchema: 'ConnectorGrantRequest',
    parameters: [connectorOriginHeader],
  }) },
  '/v1/connector-captures': { post: operation('submitPlaceConnectorCapture', {
    '200': described('Replay an already committed capture', 'ConnectorCaptureReceipt'),
    '202': described('Accept and durably commit a capture', 'ConnectorCaptureReceipt'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'ConnectorGrantInvalid'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
  }, {
    security: connectorGrant,
    requestSchema: 'ConnectorCaptureBatch',
    parameters: [connectorOriginHeader],
  }) },
  '/v1/imports': {
    get: operation('listCurrentMemberPlaceImports', {
      '200': described('Return a bounded current-member ImportBatch history', 'PlaceImportBatchList'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ImportQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [importBatchStateParameter, boundedCursorParameter, boundedLimitParameter],
    }),
    post: operation('requestPlaceImport', {
      '200': described('Return an idempotently replayed import batch', 'PlaceImportBatch'),
      '202': described('Queue a connected-account import', 'PlaceImportBatch'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '409': ref('responses', 'ProductConflict'),
    }, { security: bearer, requestSchema: 'PlaceImportRequest' }),
  },
  '/v1/imports/{batchId}': {
    parameters: [pathParameters.batchId],
    get: operation('getPlaceImport', {
      '200': described('Return an import preview and progress', 'PlaceImportBatchDetail'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ImportQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, importItemLimitParameter],
    }),
  },
  '/v1/imports/{batchId}/cancel': {
    parameters: [pathParameters.batchId],
    post: operation('cancelPlaceImport', {
      '200': described('Return the cancelled import batch', 'PlaceImportBatch'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer, requestSchema: 'PlaceImportCancelRequest' }),
  },
  '/v1/imports/{batchId}/resume': {
    parameters: [pathParameters.batchId],
    post: operation('resumePlaceImport', {
      '200': described('Return the resumed import batch', 'PlaceImportBatch'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer, requestSchema: 'PlaceImportResumeRequest' }),
  },
  '/v1/import-reviews': { post: operation('reviewPlaceImportItem', {
    '200': described('Return an idempotent import review receipt', 'PlaceImportReviewResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '409': ref('responses', 'ProductConflict'),
  }, { security: bearer, requestSchema: 'PlaceImportReviewRequest' }) },
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
        boundedCursorParameter,
        boundedLimitParameter,
      ],
    }),
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
    }, { security: anonymous }),
  },
  '/v1/visits': { post: operation('recordPlaceVisit', {
    '201': described('Record an immutable visit occurrence', 'VisitRecordResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '409': ref('responses', 'ProductConflict'),
  }, { security: bearer, requestSchema: 'VisitRecordRequest' }) },
  '/v1/places/{placeId}': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceDetail', {
      '200': described('Return canonical public facts with an optional personal overlay', 'PlaceDetail'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '410': ref('responses', 'PlaceRetired'),
      '503': ref('responses', 'PlaceDetailUnavailable'),
    }, { security: optionalBearer }),
  },
  '/v1/places/{placeId}/visit-summary': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceVisitSummary', {
      '200': described('Return the current-member Visit summary', 'VisitSummaryResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
    }, { security: bearer }),
  },
  '/v1/places/{placeId}/visits': {
    parameters: [pathParameters.placeId],
    get: operation('listCurrentMemberPlaceVisits', {
      '200': described('Return a bounded current-member Visit history', 'VisitHistoryResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'VisitQueryUnavailable'),
    }, { security: bearer, parameters: [boundedCursorParameter, boundedLimitParameter] }),
  },
  '/v1/writing': {
    get: operation('listCurrentMemberPlaceWriting', {
      '200': described('Return bounded current-member Writing summaries', 'WritingListResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'WritingQueryUnavailable'),
    }, {
      security: bearer,
      parameters: [writingKindParameter, boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/writing/{documentId}': {
    parameters: [pathParameters.documentId],
    get: operation('getCurrentMemberPlaceWriting', {
      '200': described('Return current-member Writing detail', 'WritingDetailResponse'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'WritingQueryUnavailable'),
    }, { security: bearer }),
  },
  '/v1/writing/commands': { post: operation('applyPlaceWritingCommand', {
    '200': described('Return an idempotently replayed command result', 'WritingCommandResult'),
    '201': described('Return an applied command result', 'WritingCommandResult'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '409': ref('responses', 'ProductConflict'),
  }, { security: bearer, requestSchema: 'WritingCommandRequest' }) },
  '/v1/public/writing/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceWriting', {
      '200': described('Return allowlisted public writing', 'PublishedWriting'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: anonymous }),
  },
  '/api/search/places': { post: operation('searchPlacesForBrowser', {
    '200': described('Return validated provider-neutral search results', 'PlaceSearchResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSearchRequest' }) },
  '/api/search/suggestions': { post: operation('suggestPlacesForBrowser', {
    '200': described('Return provider-neutral query-as-you-type candidates', 'PlaceSuggestionsResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionsRequest' }) },
  '/api/search/suggestion-selections': { post: operation('selectPlaceSuggestionForBrowser', {
    '200': described('Record an idempotent explicit suggestion selection', 'PlaceSuggestionSelectionResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionSelectionRequest' }) },
  '/api/search/provider-details': { post: operation('getProviderPlaceDetailsForBrowser', {
    '200': described('Return a validated provider detail projection', 'ProviderPlaceDetail'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'ProviderPlaceDetailRequest' }) },
  '/api/search/taxonomy': { get: operation('listPlaceTaxonomyNodesForBrowser', {
    '200': described('Return the current provider-neutral taxonomy', 'TaxonomyProjection'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous }) },
  '/v1/search/places': { post: operation('searchPlaces', {
    '200': described('Return provider-neutral local and official provider results', 'PlaceSearchResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: optionalBearer, requestSchema: 'PlaceSearchRequest' }) },
  '/v1/search/suggestions': { post: operation('suggestPlaces', {
    '200': described('Return bounded local and provider-backed suggestions', 'PlaceSuggestionsResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionsRequest' }) },
  '/v1/search/suggestion-selections': { post: operation('selectPlaceSuggestion', {
    '200': described('Record explicit selection evidence exactly once', 'PlaceSuggestionSelectionResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionSelectionRequest' }) },
  '/v1/search/suggestion-materializations': { post: operation('materializePlaceSuggestion', {
    '200': described('Create or link a Canonical Place through evidence and resolution', 'PlaceSuggestionMaterializationResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: bearer, requestSchema: 'PlaceSuggestionMaterializationRequest' }) },
  '/v1/providers/place-details': { post: operation('getProviderPlaceDetails', {
    '200': described('Return a bounded provider detail projection', 'ProviderPlaceDetail'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'ProviderPlaceDetailRequest' }) },
  '/v1/taxonomy/nodes': { get: operation('listPlaceTaxonomyNodes', {
    '200': described('Return the current provider-neutral taxonomy', 'TaxonomyProjection'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous }) },
}

const schemas: Readonly<Record<string, ZodType>> = {
  ProcessStatus: processStatusSchema,
  ConnectorPublicOrigin: connectorPublicOriginSchema,
  ConnectorGrantRequest: connectorGrantRequestSchema,
  ConnectorGrant: connectorGrantSchema,
  ConnectorCaptureBatch: connectorCaptureBatchSchema,
  ConnectorCaptureReceipt: connectorCaptureReceiptSchema,
  LibraryCommandRequest: libraryCommandRequestSchema,
  LibraryCommandResult: libraryCommandResultSchema,
  LibraryPlacePreferences: libraryPlacePreferencesResponseSchema,
  ProviderConnectionList: providerConnectionListSchema,
  PlaceImportRequest: placeImportRequestSchema,
  PlaceImportBatch: placeImportBatchSchema,
  PlaceImportBatchList: placeImportBatchListSchema,
  PlaceImportBatchDetail: placeImportBatchDetailSchema,
  PlaceImportCancelRequest: placeImportCancelRequestSchema,
  PlaceImportResumeRequest: placeImportResumeRequestSchema,
  PlaceImportReviewRequest: placeImportReviewRequestSchema,
  PlaceImportReviewResult: placeImportReviewResultSchema,
  SetPlacePreferencesCommand: setPlacePreferencesCommandSchema,
  CreateCollectionCommand: createCollectionCommandSchema,
  AddCollectionPlaceCommand: addCollectionPlaceCommandSchema,
  RenameCollectionCommand: renameCollectionCommandSchema,
  DeleteCollectionCommand: deleteCollectionCommandSchema,
  RemoveCollectionPlaceCommand: removeCollectionPlaceCommandSchema,
  MoveCollectionPlaceCommand: moveCollectionPlaceCommandSchema,
  CreateTagCommand: createTagCommandSchema,
  TagPlaceCommand: tagPlaceCommandSchema,
  RenameTagCommand: renameTagCommandSchema,
  DeleteTagCommand: deleteTagCommandSchema,
  UntagPlaceCommand: untagPlaceCommandSchema,
  CopyPublishedCollectionCommand: copyPublishedCollectionCommandSchema,
  VisitRecordRequest: visitRecordRequestSchema,
  VisitRecordResult: visitRecordResultSchema,
  VisitSummaryResponse: visitSummaryResponseSchema,
  WritingCommandRequest: writingCommandRequestSchema,
  WritingCommandResult: writingCommandResultSchema,
  CreateNoteCommand: createNoteCommandSchema,
  UpdateNoteCommand: updateNoteCommandSchema,
  CreateEntryCommand: createEntryCommandSchema,
  UpdateEntryCommand: updateEntryCommandSchema,
  CurrentMembership: currentMembershipSchema,
  MembershipConsent: membershipConsentSchema,
  MembershipOnboardingRequest: membershipOnboardingRequestSchema,
  CurrentMembershipConsents: currentMembershipConsentsSchema,
  MembershipOnboardingResult: membershipOnboardingResultSchema,
  AuthorityRoleChangeRequest: authorityRoleChangeRequestSchema,
  AuthorityRoleChangeResult: authorityRoleChangeResultSchema,
  PublishedCollection: publishedCollectionSchema,
  PublishedWriting: publishedWritingSchema,
  LibraryPlaceListResponse: libraryPlaceListResponseSchema,
  LibraryPlaceOrganizationResponse: libraryPlaceOrganizationResponseSchema,
  LibraryCollectionListResponse: libraryCollectionListResponseSchema,
  LibraryCollectionDetailResponse: libraryCollectionDetailResponseSchema,
  LibraryTagListResponse: libraryTagListResponseSchema,
  VisitHistoryResponse: visitHistoryResponseSchema,
  WritingListResponse: writingListResponseSchema,
  WritingDetailResponse: writingDetailResponseSchema,
  PlaceDetail: placeDetailResponseSchema,
  PlaceSearchRequest: placeSearchRequestSchema,
  PlaceSearchResponse: placeSearchResponseSchema,
  PlaceSuggestionsRequest: placeSuggestionsRequestSchema,
  PlaceSuggestionsResponse: placeSuggestionsResponseSchema,
  PlaceSuggestionSelectionRequest: placeSuggestionSelectionRequestSchema,
  PlaceSuggestionSelectionResponse: placeSuggestionSelectionResponseSchema,
  PlaceSuggestionMaterializationRequest: placeSuggestionMaterializationRequestSchema,
  PlaceSuggestionMaterializationResponse: placeSuggestionMaterializationResponseSchema,
  ProviderPlaceDetailRequest: providerPlaceDetailRequestSchema,
  ProviderPlaceDetail: providerPlaceDetailSchema,
  TaxonomyProjection: taxonomyProjectionSchema,
  Problem: problemSchema,
}

function openApiSchema(schema: ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })
  const { $schema: _, ...component } = generated
  return component
}

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ref('schemas', 'Problem') } },
})

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Place HTTP',
      version: '1.0.0',
      description: 'Place-owned source-only HTTP and browser BFF contract.',
    },
    servers: [],
    paths,
    components: {
      securitySchemes: {
        placeBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        placeBrowserSession: { type: 'apiKey', in: 'cookie', name: '__Host-place_session' },
        placeConnector: { type: 'http', scheme: 'PlaceConnector' },
      },
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [name, openApiSchema(schema)]),
      ),
      responses: {
        ProductUnavailable: problemResponse('A required product capability is temporarily unavailable'),
        BrowserBackendUnavailable: problemResponse('The fixed internal Place Backend is temporarily unavailable'),
        ProductRequestInvalid: problemResponse('The product request is malformed or contains unsupported fields'),
        ProductNotFound: problemResponse('The owned resource or disclosed publication is unavailable'),
        PlaceRetired: problemResponse('The canonical Place was retired and has no active successor'),
        PlaceDetailUnavailable: problemResponse('The canonical Place detail projection is temporarily unavailable'),
        LibraryQueryUnavailable: problemResponse('The bounded Library query is temporarily unavailable'),
        VisitQueryUnavailable: problemResponse('The bounded Visit query is temporarily unavailable'),
        WritingQueryUnavailable: problemResponse('The bounded Writing query is temporarily unavailable'),
        ImportQueryUnavailable: problemResponse('The bounded Import query is temporarily unavailable'),
        ProductConflict: problemResponse('The request conflicts with prior state'),
        AuthenticationRequired: problemResponse('The bearer token is missing or invalid'),
        ConnectorGrantInvalid: problemResponse('The connector grant is missing, expired, or invalid'),
        AccessDenied: problemResponse('The principal lacks Place access'),
        BrowserAuthRejected: problemResponse('The browser login transaction was rejected'),
        BrowserAuthUnavailable: problemResponse('Browser authentication is inactive or unavailable'),
        BrowserMembershipUnavailable: problemResponse('Browser membership is inactive or unavailable'),
        OnboardingRequestInvalid: problemResponse('The onboarding request is invalid'),
        MembershipConsentRequired: problemResponse('Current Place consent is required'),
        MembershipOnboardingUnavailable: problemResponse('Membership onboarding is unavailable'),
        AuthorityRequestInvalid: problemResponse('The authority-role request is invalid'),
        MembershipNotFound: problemResponse('The target membership does not exist'),
        AuthorityChangeRejected: problemResponse('The authority-role change was rejected'),
        AuthorityChangeUnavailable: problemResponse('Authority-role management is unavailable'),
      },
    },
  }
}
