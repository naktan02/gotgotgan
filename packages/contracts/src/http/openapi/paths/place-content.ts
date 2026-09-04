import { anonymous, bearer, described, operation, optionalBearer, ref } from '../model.js'
import {
  boundedCursorParameter,
  boundedLimitParameter,
  pathParameters,
  writingKindParameter,
  writingPlaceIdParameter,
} from '../parameters.js'

export const placeContentPaths = {
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
      parameters: [writingKindParameter, writingPlaceIdParameter, boundedCursorParameter, boundedLimitParameter],
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
}
