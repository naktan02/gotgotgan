import { z } from 'zod'

const MAX_URI_LENGTH = 2_048
const MAX_ASSERTIONS_PER_BATCH = 256
const MAX_EVIDENCE_ASSERTIONS = 512
const MAX_POSTGRES_INTEGER = 2_147_483_647

const catalogUuidSchema = z.string().uuid()
const catalogTimestampSchema = z.iso.datetime({ offset: true })
const catalogRevisionSchema = z.number().int().positive()
const catalogKeySchema = z.string().trim().min(1).max(128)
const catalogProviderKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)
const catalogRightsProfileKeySchema = z.string().trim().min(1).max(128)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\.v[1-9][0-9]{0,8}$/)
const catalogLanguageTagSchema = z.string()
  .regex(/^(?:und|[A-Za-z]{2,3})(?:-[A-Za-z0-9]{2,8})*$/)
const catalogHttpUriSchema = z.url().max(MAX_URI_LENGTH).refine((value) => {
  const uri = new URL(value)
  return (uri.protocol === 'http:' || uri.protocol === 'https:') &&
    uri.username === '' && uri.password === ''
}, 'Only HTTP(S) URIs without user information are allowed')

const uniqueStringArray = <T extends z.ZodType<string>>(item: T, maximum: number) => z.array(item)
  .max(maximum)
  .refine((values) => new Set(values).size === values.length, 'Values must be unique')

export const catalogFactSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('provider-identity'),
    providerKey: catalogProviderKeySchema,
    externalPlaceId: z.string().trim().min(1).max(512),
  }).strict(),
  z.object({
    kind: z.literal('canonical-place'),
    placeId: catalogUuidSchema,
  }).strict(),
])

export const catalogNameFactSchema = z.object({
  kind: z.literal('name'),
  value: z.object({
    text: z.string().trim().min(1).max(300),
    languageTag: catalogLanguageTagSchema.optional(),
  }).strict(),
}).strict()

export const catalogFormattedAddressFactSchema = z.object({
  kind: z.literal('formatted-address'),
  value: z.object({
    text: z.string().trim().min(1).max(500),
    languageTag: catalogLanguageTagSchema.optional(),
  }).strict(),
}).strict()

export const catalogLocationFactSchema = z.object({
  kind: z.literal('location'),
  value: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }).strict(),
}).strict()

export const catalogOperationalStatusSchema = z.enum([
  'operating',
  'temporarily-closed',
  'permanently-closed',
  'unknown',
])

export const catalogOperationalStatusFactSchema = z.object({
  kind: z.literal('operational-status'),
  value: z.object({
    status: catalogOperationalStatusSchema,
  }).strict(),
}).strict()

export const catalogPhoneFactSchema = z.object({
  kind: z.literal('phone'),
  value: z.object({
    display: z.string().trim().min(1).max(128),
    e164: z.string().regex(/^\+[1-9][0-9]{1,14}$/).optional(),
  }).strict(),
}).strict()

export const catalogWebsiteFactSchema = z.object({
  kind: z.literal('website'),
  value: z.object({
    uri: catalogHttpUriSchema,
  }).strict(),
}).strict()

const catalogDayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
])

const catalogLocalTimeSchema = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)

const catalogOpeningMomentSchema = z.object({
  dayOfWeek: catalogDayOfWeekSchema,
  localTime: catalogLocalTimeSchema,
}).strict()

export const catalogOpeningHoursFactSchema = z.object({
  kind: z.literal('opening-hours'),
  value: z.object({
    timeZone: z.string().trim().min(1).max(128),
    weeklyPeriods: z.array(z.object({
      opens: catalogOpeningMomentSchema,
      closes: catalogOpeningMomentSchema,
    }).strict()).min(1).max(64),
  }).strict(),
}).strict()

export const catalogTaxonomyAssignmentRoleSchema = z.enum([
  'primary',
  'secondary',
  'attribute',
])

export const catalogAreaAssignmentRoleSchema = z.enum([
  'primary',
  'ancestor',
  'alternate',
])

export const catalogTaxonomyAssignmentSchema = z.object({
  key: catalogKeySchema,
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  role: catalogTaxonomyAssignmentRoleSchema,
}).strict()

export const catalogAreaAssignmentSchema = z.object({
  key: catalogKeySchema,
  version: z.number().int().positive().max(MAX_POSTGRES_INTEGER),
  role: catalogAreaAssignmentRoleSchema,
}).strict()

export const catalogTaxonomyFactSchema = z.object({
  kind: z.literal('taxonomy'),
  value: catalogTaxonomyAssignmentSchema,
}).strict()

export const catalogAreaFactSchema = z.object({
  kind: z.literal('area'),
  value: catalogAreaAssignmentSchema,
}).strict()

export const catalogMediaRightsStateSchema = z.enum([
  'display-allowed',
  'attribution-required',
  'restricted',
  'unknown',
])

export const catalogMediaAttributionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  uri: catalogHttpUriSchema.optional(),
}).strict()

export const catalogMediaSizeSchema = z.object({
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
}).strict()

const catalogSourceMediaFields = {
  externalUri: catalogHttpUriSchema,
  size: catalogMediaSizeSchema.optional(),
  validUntil: catalogTimestampSchema.optional(),
}

const catalogDisplayAllowedSourceMediaSchema = z.object({
  ...catalogSourceMediaFields,
  rightsState: z.literal('display-allowed'),
  requiredAttributions: z.array(catalogMediaAttributionSchema).max(16),
}).strict()

const catalogAttributionRequiredSourceMediaSchema = z.object({
  ...catalogSourceMediaFields,
  rightsState: z.literal('attribution-required'),
  requiredAttributions: z.array(catalogMediaAttributionSchema).min(1).max(16),
}).strict()

const catalogRestrictedSourceMediaSchema = z.object({
  ...catalogSourceMediaFields,
  rightsState: z.literal('restricted'),
  requiredAttributions: z.array(catalogMediaAttributionSchema).max(16),
}).strict()

const catalogUnknownRightsSourceMediaSchema = z.object({
  ...catalogSourceMediaFields,
  rightsState: z.literal('unknown'),
  requiredAttributions: z.array(catalogMediaAttributionSchema).max(16),
}).strict()

export const catalogMediaSchema = z.discriminatedUnion('rightsState', [
  catalogDisplayAllowedSourceMediaSchema,
  catalogAttributionRequiredSourceMediaSchema,
  catalogRestrictedSourceMediaSchema,
  catalogUnknownRightsSourceMediaSchema,
])

const catalogDisplayableMediaFields = {
  mediaReferenceId: catalogUuidSchema,
  displayUri: catalogHttpUriSchema,
  size: catalogMediaSizeSchema.optional(),
  validUntil: catalogTimestampSchema.optional(),
  sourceAssertionId: catalogUuidSchema.optional(),
}

export const publicDisplayableCatalogMediaSchema = z.discriminatedUnion('rightsState', [
  z.object({
    ...catalogDisplayableMediaFields,
    rightsState: z.literal('display-allowed'),
    requiredAttributions: z.array(catalogMediaAttributionSchema).max(16),
  }).strict(),
  z.object({
    ...catalogDisplayableMediaFields,
    rightsState: z.literal('attribution-required'),
    requiredAttributions: z.array(catalogMediaAttributionSchema).min(1).max(16),
  }).strict(),
])

export const catalogMediaFactSchema = z.object({
  kind: z.literal('media'),
  value: catalogMediaSchema,
}).strict()

export const catalogFactSchema = z.discriminatedUnion('kind', [
  catalogNameFactSchema,
  catalogFormattedAddressFactSchema,
  catalogLocationFactSchema,
  catalogOperationalStatusFactSchema,
  catalogPhoneFactSchema,
  catalogWebsiteFactSchema,
  catalogOpeningHoursFactSchema,
  catalogTaxonomyFactSchema,
  catalogAreaFactSchema,
  catalogMediaFactSchema,
])

export const catalogFactAssertionSchema = z.object({
  assertionId: catalogUuidSchema,
  subject: catalogFactSubjectSchema,
  fact: catalogFactSchema,
  sourceObservationId: catalogUuidSchema,
  observedAt: catalogTimestampSchema,
  confidence: z.number().finite().min(0).max(1).multipleOf(0.001),
  rightsProfileKey: catalogRightsProfileKeySchema,
}).strict()

const subjectsMatch = (
  left: z.infer<typeof catalogFactSubjectSchema>,
  right: z.infer<typeof catalogFactSubjectSchema>,
) => left.kind === right.kind && (
  left.kind === 'canonical-place' && right.kind === 'canonical-place'
    ? left.placeId === right.placeId
    : left.kind === 'provider-identity' && right.kind === 'provider-identity'
      && left.providerKey === right.providerKey
      && left.externalPlaceId === right.externalPlaceId
)

export const catalogFactAssertionBatchSchema = z.object({
  schemaVersion: z.literal('catalog-fact-assertion-batch.v1'),
  batchId: catalogUuidSchema,
  recordedAt: catalogTimestampSchema,
  assertions: z.array(catalogFactAssertionSchema)
    .min(1)
    .max(MAX_ASSERTIONS_PER_BATCH)
    .refine(
      (assertions) => new Set(assertions.map(({ assertionId }) => assertionId)).size === assertions.length,
      'Assertion IDs must be unique within a batch',
    ),
}).strict().superRefine(({ recordedAt, assertions }, context) => {
  const first = assertions[0]
  if (!first) return

  if (Date.parse(recordedAt) < Date.parse(first.observedAt)) {
    context.addIssue({
      code: 'custom',
      message: 'recordedAt must not be earlier than observedAt',
      path: ['recordedAt'],
    })
  }

  assertions.slice(1).forEach((assertion, offset) => {
    const index = offset + 1
    const consistencyChecks = [
      ['subject', subjectsMatch(assertion.subject, first.subject)],
      ['sourceObservationId', assertion.sourceObservationId === first.sourceObservationId],
      ['observedAt', assertion.observedAt === first.observedAt],
      ['rightsProfileKey', assertion.rightsProfileKey === first.rightsProfileKey],
    ] as const
    for (const [field, matches] of consistencyChecks) {
      if (!matches) {
        context.addIssue({
          code: 'custom',
          message: `All assertions in a batch must share ${field}`,
          path: ['assertions', index, field],
        })
      }
    }
  })
}).readonly()

const catalogSelectedFactSchema = <T extends z.ZodType>(valueSchema: T) => z.object({
  value: valueSchema,
  sourceAssertionId: catalogUuidSchema,
}).strict()

const catalogProfileTaxonomyAssignmentSchema = catalogTaxonomyAssignmentSchema.extend({
  sourceAssertionId: catalogUuidSchema,
}).strict()

const catalogProfileAreaAssignmentSchema = catalogAreaAssignmentSchema.extend({
  sourceAssertionId: catalogUuidSchema,
}).strict()

export const catalogProfileMediaReferenceSchema = z.object({
  mediaReferenceId: catalogUuidSchema,
  sourceAssertionId: catalogUuidSchema,
}).strict()

const uniqueVersionedAssignments = <T extends {
  key: string
  version: number
  role: string
}>(assignments: readonly T[], context: z.RefinementCtx) => {
  const identities = assignments.map(({ key, version }) => `${key}\u0000${version}`)
  if (new Set(identities).size !== identities.length) {
    context.addIssue({
      code: 'custom',
      message: 'Assignment key and version pairs must be unique',
    })
  }
  if (assignments.filter(({ role }) => role === 'primary').length > 1) {
    context.addIssue({
      code: 'custom',
      message: 'At most one primary assignment is allowed',
    })
  }
}

const catalogProfileTaxonomyAssignmentsSchema = z.array(catalogProfileTaxonomyAssignmentSchema)
  .max(64)
  .superRefine(uniqueVersionedAssignments)

const catalogProfileAreaAssignmentsSchema = z.array(catalogProfileAreaAssignmentSchema)
  .max(64)
  .superRefine(uniqueVersionedAssignments)

const catalogProfileMediaSchema = z.array(catalogProfileMediaReferenceSchema)
  .max(32)
  .refine(
    (media) => new Set(media.map(({ mediaReferenceId }) => mediaReferenceId)).size === media.length,
    'Media reference IDs must be unique',
  )

const catalogNameValueSchema = catalogNameFactSchema.shape.value
const catalogFormattedAddressValueSchema = catalogFormattedAddressFactSchema.shape.value
const catalogLocationValueSchema = catalogLocationFactSchema.shape.value
const catalogOperationalStatusValueSchema = catalogOperationalStatusFactSchema.shape.value
const catalogPhoneValueSchema = catalogPhoneFactSchema.shape.value
const catalogWebsiteValueSchema = catalogWebsiteFactSchema.shape.value
const catalogOpeningHoursValueSchema = catalogOpeningHoursFactSchema.shape.value

export const catalogProfileContentSchema = z.object({
  displayName: catalogSelectedFactSchema(catalogNameValueSchema),
  formattedAddress: catalogSelectedFactSchema(catalogFormattedAddressValueSchema).nullable(),
  location: catalogSelectedFactSchema(catalogLocationValueSchema).nullable(),
  operationalStatus: catalogSelectedFactSchema(catalogOperationalStatusValueSchema).nullable(),
  phone: catalogSelectedFactSchema(catalogPhoneValueSchema).nullable(),
  website: catalogSelectedFactSchema(catalogWebsiteValueSchema).nullable(),
  openingHours: catalogSelectedFactSchema(catalogOpeningHoursValueSchema).nullable(),
  taxonomyAssignments: catalogProfileTaxonomyAssignmentsSchema,
  areaAssignments: catalogProfileAreaAssignmentsSchema,
  media: catalogProfileMediaSchema,
}).strict()

const collectProfileSourceAssertionIds = (
  profile: z.infer<typeof catalogProfileContentSchema>,
) => {
  const selected = [
    profile.displayName,
    profile.formattedAddress,
    profile.location,
    profile.operationalStatus,
    profile.phone,
    profile.website,
    profile.openingHours,
  ]
  return [
    ...selected.flatMap((item) => item?.sourceAssertionId ? [item.sourceAssertionId] : []),
    ...profile.taxonomyAssignments.flatMap((item) => item.sourceAssertionId ? [item.sourceAssertionId] : []),
    ...profile.areaAssignments.flatMap((item) => item.sourceAssertionId ? [item.sourceAssertionId] : []),
    ...profile.media.flatMap((item) => item.sourceAssertionId ? [item.sourceAssertionId] : []),
  ]
}

const requireProfileEvidence = (
  evidenceAssertionIds: readonly string[],
  profile: z.infer<typeof catalogProfileContentSchema>,
  context: z.RefinementCtx,
) => {
  const evidence = new Set(evidenceAssertionIds)
  for (const sourceAssertionId of collectProfileSourceAssertionIds(profile)) {
    if (!evidence.has(sourceAssertionId)) {
      context.addIssue({
        code: 'custom',
        message: `Profile source assertion ${sourceAssertionId} is absent from evidenceAssertionIds`,
        path: ['profile'],
      })
    }
  }
}

export const catalogPublishProfileCommandSchema = z.object({
  schemaVersion: z.literal('catalog-publish-profile-command.v1'),
  commandId: catalogUuidSchema,
  placeId: catalogUuidSchema,
  expectedRevision: catalogRevisionSchema.nullable(),
  policyVersion: z.string().trim().min(1).max(128),
  rationale: z.string().trim().min(1).max(2_000),
  evidenceAssertionIds: uniqueStringArray(catalogUuidSchema, MAX_EVIDENCE_ASSERTIONS).min(1),
  profile: catalogProfileContentSchema,
}).strict().superRefine(({ evidenceAssertionIds, profile }, context) => {
  requireProfileEvidence(evidenceAssertionIds, profile, context)
})

export const catalogCanonicalIdentityStateSchema = z.enum(['active', 'redirected', 'retired'])

export const catalogCurrentProfileSchema = z.object({
  schemaVersion: z.literal('catalog-current-profile.v1'),
  placeId: catalogUuidSchema,
  identityState: catalogCanonicalIdentityStateSchema,
  revision: catalogRevisionSchema,
  policyVersion: z.string().trim().min(1).max(128),
  publishedAt: catalogTimestampSchema,
  evidenceAssertionIds: uniqueStringArray(catalogUuidSchema, MAX_EVIDENCE_ASSERTIONS).min(1),
  profile: catalogProfileContentSchema,
}).strict().superRefine(({ evidenceAssertionIds, profile }, context) => {
  requireProfileEvidence(evidenceAssertionIds, profile, context)
})

const catalogPublishProfileRejectionSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('revision-conflict'),
    currentRevision: catalogRevisionSchema.nullable(),
  }).strict(),
  z.object({ code: z.literal('evidence-unavailable') }).strict(),
  z.object({ code: z.literal('policy-unavailable') }).strict(),
  z.object({ code: z.literal('place-unavailable') }).strict(),
  z.object({ code: z.literal('command-id-reused') }).strict(),
])

export const catalogPublishProfileResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('catalog-publish-profile-result.v1'),
    outcome: z.literal('accepted'),
    commandId: catalogUuidSchema,
    status: z.enum(['applied', 'replayed']),
    currentProfile: catalogCurrentProfileSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('catalog-publish-profile-result.v1'),
    outcome: z.literal('rejected'),
    commandId: catalogUuidSchema,
    rejection: catalogPublishProfileRejectionSchema,
  }).strict(),
])

export type CatalogFactSubject = z.infer<typeof catalogFactSubjectSchema>
export type CatalogFact = z.infer<typeof catalogFactSchema>
export type CatalogFactAssertion = z.infer<typeof catalogFactAssertionSchema>
export type CatalogFactAssertionBatch = z.infer<typeof catalogFactAssertionBatchSchema>
export type CatalogMedia = z.infer<typeof catalogMediaSchema>
export type CatalogProfileMediaReference = z.infer<typeof catalogProfileMediaReferenceSchema>
export type PublicDisplayableCatalogMedia = z.infer<typeof publicDisplayableCatalogMediaSchema>
export type CatalogProfileContent = z.infer<typeof catalogProfileContentSchema>
export type CatalogPublishProfileCommand = z.infer<typeof catalogPublishProfileCommandSchema>
export type CatalogCurrentProfile = z.infer<typeof catalogCurrentProfileSchema>
export type CatalogPublishProfileResult = z.infer<typeof catalogPublishProfileResultSchema>
