import { bearer, connectorGrant, described, operation, ref } from '../model.js'
import {
  boundedCursorParameter,
  boundedLimitParameter,
  importBatchStateParameter,
  importItemLimitParameter,
  legacyConnectorPublicOriginHeader,
  pathParameters,
} from '../parameters.js'

export const importPaths = {
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
    parameters: [legacyConnectorPublicOriginHeader],
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
    parameters: [legacyConnectorPublicOriginHeader],
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
}
