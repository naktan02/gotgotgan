import { anonymous, bearer, browserSession, described, operation, ref } from '../model.js'
import {
  boundedCursorParameter,
  boundedLimitParameter,
  libraryAreaKeysParameter,
  libraryMapViewportParameters,
  libraryTaxonomyKeysParameter,
  pathParameters,
  publicCollectionSearchParameter,
  publicCollectionSortParameter,
  publicCollectionTopicKeysParameter,
  publishedCollectionLimitParameter,
} from '../parameters.js'

export const accessAndCommunityPaths = {
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
      '400': ref('responses', 'ProductRequestInvalid'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, publishedCollectionLimitParameter],
    }),
  },
  '/api/public/collections/{publicationId}/map': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceCollectionMapForBrowser', {
      '200': described('Return a validated public collection map projection', 'PublishedCollectionMap'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: anonymous, parameters: [...libraryMapViewportParameters] }),
  },
  '/api/public/collection-directory': {
    get: operation('listDiscoverableCollectionsForBrowserV2', {
      '200': described('Return moderation-aware public Collection discovery results', 'PublicCollectionDirectoryV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: anonymous,
      parameters: [
        publicCollectionSearchParameter, libraryAreaKeysParameter, libraryTaxonomyKeysParameter,
        publicCollectionTopicKeysParameter, publicCollectionSortParameter,
        boundedCursorParameter, boundedLimitParameter,
      ],
    }),
  },
  '/api/public/discoverable-collections/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getDiscoverableCollectionForBrowserV2', {
      '200': described('Return a moderation-aware discoverable Collection', 'DiscoverableCollectionV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/public/writing/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceWritingForBrowser', {
      '200': described('Return validated public writing', 'PublishedWriting'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: anonymous }),
  },
  '/api/profile': {
    get: operation('getCurrentPublicProfileForBrowser', {
      '200': described('Return the current member public profile settings', 'PublicProfileRecord'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession }),
    put: operation('setCurrentPublicProfileForBrowser', {
      '200': described('Replay a public profile command', 'PublicProfileCommandResult'),
      '201': described('Apply a public profile command', 'PublicProfileCommandResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'SetPublicProfileRequest' }),
  },
  '/api/profile/moderation-notices': {
    get: operation('listCurrentPublicProfileModerationNoticesForBrowser', {
      '200': described('Return validated owner-scoped moderation notices', 'PublicProfileModerationNotices'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: browserSession,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/profile/moderation-notices/{noticeId}/acknowledgement': {
    parameters: [pathParameters.noticeId],
    put: operation('acknowledgeCurrentPublicProfileModerationNoticeForBrowser', {
      '200': described('Return an existing moderation-notice acknowledgement', 'PublicProfileNoticeAcknowledgementResult'),
      '201': described('Acknowledge an owner moderation notice', 'PublicProfileNoticeAcknowledgementResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession }),
  },
  '/api/profile/moderation-appeals': {
    post: operation('submitCurrentPublicProfileAppealForBrowser', {
      '200': described('Return an existing Public Profile appeal outcome', 'PublicProfileAppealResult'),
      '201': described('Record a structured Public Profile appeal', 'PublicProfileAppealResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PublicProfileAppealRequest' }),
  },
  '/api/public/profiles/{handle}': {
    parameters: [pathParameters.handle],
    get: operation('getPublicProfileForBrowser', {
      '200': described('Return a published profile and only its public Collections', 'PublicProfileProjection'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/api/public/profiles/{handle}/reports': {
    parameters: [pathParameters.handle],
    post: operation('reportPublicProfileForBrowser', {
      '200': described('Return an existing Public Profile report outcome', 'PublicProfileReportResult'),
      '201': described('Record a categorized Public Profile report', 'PublicProfileReportResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'BrowserBackendUnavailable'),
    }, { security: browserSession, requestSchema: 'PublicProfileReportRequest' }),
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
  '/v1/profiles/current': {
    get: operation('getCurrentPublicProfile', {
      '200': described('Return the current member public profile settings', 'PublicProfileRecord'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
    put: operation('setCurrentPublicProfile', {
      '200': described('Replay a public profile command', 'PublicProfileCommandResult'),
      '201': described('Apply a public profile command', 'PublicProfileCommandResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'SetPublicProfileRequest' }),
  },
  '/v1/public/profiles/{handle}': {
    parameters: [pathParameters.handle],
    get: operation('getPublicProfile', {
      '200': described('Return a published profile and only its public Collections', 'PublicProfileProjection'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: anonymous,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/public/profiles/{handle}/reports': {
    parameters: [pathParameters.handle],
    post: operation('reportPublicProfile', {
      '200': described('Return an existing Public Profile report outcome', 'PublicProfileReportResult'),
      '201': described('Record a categorized Public Profile report', 'PublicProfileReportResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'PublicProfileReportRequest' }),
  },
  '/v1/administration/public-profile-reports': {
    get: operation('listPendingPublicProfileReports', {
      '200': described('Return a bounded reporter-redacted moderation queue', 'PublicProfileReportQueue'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/administration/public-profiles/{handle}/moderation': {
    parameters: [pathParameters.handle],
    get: operation('getPublicProfileModeration', {
      '200': described('Return current Public Profile moderation state', 'PublicProfileModerationRecord'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
    put: operation('moderatePublicProfile', {
      '200': described('Replay a Public Profile moderation decision', 'PublicProfileModerationResult'),
      '201': described('Apply a Public Profile moderation decision', 'PublicProfileModerationResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'PublicProfileModerationRequest' }),
  },
  '/v1/profiles/current/moderation-notices': {
    get: operation('listCurrentPublicProfileModerationNotices', {
      '200': described('Return bounded owner-scoped moderation notices', 'PublicProfileModerationNotices'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/profiles/current/moderation-notices/{noticeId}/acknowledgement': {
    parameters: [pathParameters.noticeId],
    put: operation('acknowledgeCurrentPublicProfileModerationNotice', {
      '200': described('Return an existing moderation-notice acknowledgement', 'PublicProfileNoticeAcknowledgementResult'),
      '201': described('Acknowledge an owner moderation notice', 'PublicProfileNoticeAcknowledgementResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v1/profiles/current/moderation-appeals': {
    post: operation('submitCurrentPublicProfileAppeal', {
      '200': described('Return an existing Public Profile appeal outcome', 'PublicProfileAppealResult'),
      '201': described('Record a structured Public Profile appeal', 'PublicProfileAppealResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'PublicProfileAppealRequest' }),
  },
  '/v1/administration/public-profile-appeals': {
    get: operation('listPendingPublicProfileAppeals', {
      '200': described('Return a bounded owner-redacted appeal queue', 'PublicProfileAppealQueue'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: bearer,
      parameters: [boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v1/administration/public-profile-appeals/{appealId}': {
    parameters: [pathParameters.appealId],
    put: operation('resolvePublicProfileAppeal', {
      '200': described('Replay a Public Profile appeal resolution', 'PublicProfileAppealResolutionResult'),
      '201': described('Resolve a Public Profile appeal', 'PublicProfileAppealResolutionResult'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '409': ref('responses', 'ProductConflict'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'PublicProfileAppealResolutionRequest' }),
  },
}
