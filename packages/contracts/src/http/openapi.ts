import { z, type ZodType } from 'zod'

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
  libraryCommandRequestSchema,
  publishedCollectionSchema,
  publishedWritingSchema,
  setPlacePreferencesCommandSchema,
  tagPlaceCommandSchema,
  updateEntryCommandSchema,
  updateNoteCommandSchema,
  visitRecordRequestSchema,
  writingCommandRequestSchema,
} from './content.js'
import {
  placeSearchRequestSchema,
  placeSearchResponseSchema,
  providerPlaceDetailRequestSchema,
  providerPlaceDetailSchema,
  taxonomyProjectionSchema,
} from '../search/index.js'

const anonymous: readonly unknown[] = []
const bearer = [{ placeBearer: [] }]
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
    security?: readonly unknown[]
    requestSchema?: string
    summary?: string
  }> = {},
) {
  return {
    operationId,
    summary: options.summary ?? operationId,
    ...(options.security === undefined ? {} : { security: options.security }),
    ...(options.requestSchema === undefined ? {} : {
      requestBody: requestBody(options.requestSchema),
    }),
    responses,
  }
}

const productReadResponses = {
  '200': described('Return the requested Place projection'),
  '401': ref('responses', 'AuthenticationRequired'),
  '403': ref('responses', 'AccessDenied'),
}

const publicReadResponses = {
  '200': described('Return the allowlisted public projection'),
  '404': ref('responses', 'ProductNotFound'),
}

const contentCommandResponses = {
  '200': described('An identical command was already applied'),
  '201': described('The command was applied'),
  '400': ref('responses', 'ProductRequestInvalid'),
  '401': ref('responses', 'AuthenticationRequired'),
  '403': ref('responses', 'AccessDenied'),
  '409': ref('responses', 'ProductConflict'),
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
}

const paths = {
  '/healthz': { get: operation('getPlaceHealth', { '200': described('Process is alive') }) },
  '/readyz': { get: operation('getPlaceReadiness', {
    '200': described('Process can accept traffic'),
    '503': described('One or more required process dependencies are unavailable'),
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
      '503': described('The fixed internal Place Backend is unavailable'),
    }, { security: anonymous }),
  },
  '/api/public/writing/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceWritingForBrowser', {
      '200': described('Return validated public writing', 'PublishedWriting'),
      '404': ref('responses', 'ProductNotFound'),
      '503': described('The fixed internal Place Backend is unavailable'),
    }, { security: anonymous }),
  },
  '/v1/library': { get: operation('getCurrentMemberPlaceLibrary', productReadResponses, { security: bearer }) },
  '/v1/library/commands': { post: operation('applyPlaceLibraryCommand', contentCommandResponses, { security: bearer, requestSchema: 'LibraryCommandRequest' }) },
  '/v1/library/places/{placeId}': {
    parameters: [pathParameters.placeId],
    get: operation('getPlacePreferences', {
      ...productReadResponses,
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer }),
  },
  '/v1/public/collections/{publicationId}': {
    parameters: [pathParameters.publicationId],
    get: operation('getPublishedPlaceCollection', {
      '200': described('Return an allowlisted public collection', 'PublishedCollection'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: anonymous }),
  },
  '/v1/visits': { post: operation('recordPlaceVisit', {
    ...contentCommandResponses,
    '201': described('Record an immutable visit occurrence'),
  }, { security: bearer, requestSchema: 'VisitRecordRequest' }) },
  '/v1/places/{placeId}/visit-summary': {
    parameters: [pathParameters.placeId],
    get: operation('getPlaceVisitSummary', productReadResponses, { security: bearer }),
  },
  '/v1/places/{placeId}/visits': {
    parameters: [pathParameters.placeId],
    get: operation('listCurrentMemberPlaceVisits', productReadResponses, { security: bearer }),
  },
  '/v1/writing': { get: operation('listCurrentMemberPlaceWriting', productReadResponses, { security: bearer }) },
  '/v1/writing/commands': { post: operation('applyPlaceWritingCommand', contentCommandResponses, { security: bearer, requestSchema: 'WritingCommandRequest' }) },
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
    '503': described('The fixed internal Place Backend is unavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSearchRequest' }) },
  '/api/search/provider-details': { post: operation('getProviderPlaceDetailsForBrowser', {
    '200': described('Return a validated provider detail projection', 'ProviderPlaceDetail'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': described('The fixed internal Place Backend or provider is unavailable'),
  }, { security: anonymous, requestSchema: 'ProviderPlaceDetailRequest' }) },
  '/v1/search/places': { post: operation('searchPlaces', {
    '200': described('Return provider-neutral local and official provider results', 'PlaceSearchResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': described('All configured search sources are unavailable'),
  }, { security: optionalBearer, requestSchema: 'PlaceSearchRequest' }) },
  '/v1/providers/place-details': { post: operation('getProviderPlaceDetails', {
    '200': described('Return a bounded provider detail projection', 'ProviderPlaceDetail'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': described('The configured provider detail capability is unavailable'),
  }, { security: anonymous, requestSchema: 'ProviderPlaceDetailRequest' }) },
  '/v1/taxonomy/nodes': { get: operation('listPlaceTaxonomyNodes', {
    '200': described('Return the current provider-neutral taxonomy', 'TaxonomyProjection'),
    '503': described('The taxonomy projection is unavailable'),
  }, { security: anonymous }) },
}

const schemas: Readonly<Record<string, ZodType>> = {
  LibraryCommandRequest: libraryCommandRequestSchema,
  SetPlacePreferencesCommand: setPlacePreferencesCommandSchema,
  CreateCollectionCommand: createCollectionCommandSchema,
  AddCollectionPlaceCommand: addCollectionPlaceCommandSchema,
  CreateTagCommand: createTagCommandSchema,
  TagPlaceCommand: tagPlaceCommandSchema,
  CopyPublishedCollectionCommand: copyPublishedCollectionCommandSchema,
  VisitRecordRequest: visitRecordRequestSchema,
  WritingCommandRequest: writingCommandRequestSchema,
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
  PlaceSearchRequest: placeSearchRequestSchema,
  PlaceSearchResponse: placeSearchResponseSchema,
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
      },
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [name, openApiSchema(schema)]),
      ),
      responses: {
        ProductRequestInvalid: problemResponse('The product request is malformed or contains unsupported fields'),
        ProductNotFound: problemResponse('The owned resource or disclosed publication is unavailable'),
        ProductConflict: problemResponse('The request conflicts with prior state'),
        AuthenticationRequired: problemResponse('The bearer token is missing or invalid'),
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
