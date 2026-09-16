export type CanonicalIdentityState = 'active' | 'redirected' | 'retired'
export type OperationalStatus =
  | 'operating'
  | 'temporarily-closed'
  | 'permanently-closed'
  | 'unknown'
export type TaxonomyAssignmentRole = 'primary' | 'secondary' | 'attribute'
export type AreaAssignmentRole = 'primary' | 'ancestor' | 'alternate'
export type MediaRightsState =
  | 'display-allowed'
  | 'attribution-required'
  | 'restricted'
  | 'unknown'
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type CanonicalKnowledgeActor = Readonly<{
  kind: 'policy' | 'reviewer'
  reference: string
}>

export type CanonicalKnowledgeWriteContext = Readonly<{
  actor: CanonicalKnowledgeActor
}>

export type CanonicalKnowledgeSubject =
  | Readonly<{
      kind: 'provider-identity'
      providerKey: string
      externalPlaceId: string
    }>
  | Readonly<{ kind: 'canonical-place'; placeId: string }>

export type LocalizedTextFactValue = Readonly<{
  text: string
  languageTag?: string
}>

export type GeographicLocation = Readonly<{
  latitude: number
  longitude: number
}>

export type OperationalStatusFactValue = Readonly<{ status: OperationalStatus }>
export type PhoneFactValue = Readonly<{ display: string; e164?: string }>
export type WebsiteFactValue = Readonly<{ uri: string }>
export type OpeningMoment = Readonly<{ dayOfWeek: DayOfWeek; localTime: string }>
export type OpeningHoursPeriod = Readonly<{
  opens: OpeningMoment
  closes: OpeningMoment
}>
export type OpeningHoursFactValue = Readonly<{
  timeZone: string
  weeklyPeriods: readonly OpeningHoursPeriod[]
}>

export type TaxonomyAssignment = Readonly<{
  key: string
  version: number
  role: TaxonomyAssignmentRole
}>

export type AreaAssignment = Readonly<{
  key: string
  version: number
  role: AreaAssignmentRole
}>

export type MediaAttribution = Readonly<{ label: string; uri?: string }>
export type CanonicalMediaFactValue = Readonly<{
  externalUri: string
  size?: Readonly<{ width: number; height: number }>
  rightsState: MediaRightsState
  requiredAttributions: readonly MediaAttribution[]
  validUntil?: string
}>

export type CanonicalMediaReference = Readonly<{
  mediaReferenceId: string
  sourceAssertionId: string
}>

export type CanonicalFact =
  | Readonly<{ kind: 'name'; value: LocalizedTextFactValue }>
  | Readonly<{ kind: 'formatted-address'; value: LocalizedTextFactValue }>
  | Readonly<{ kind: 'location'; value: GeographicLocation }>
  | Readonly<{ kind: 'operational-status'; value: OperationalStatusFactValue }>
  | Readonly<{ kind: 'phone'; value: PhoneFactValue }>
  | Readonly<{ kind: 'website'; value: WebsiteFactValue }>
  | Readonly<{ kind: 'opening-hours'; value: OpeningHoursFactValue }>
  | Readonly<{ kind: 'taxonomy'; value: TaxonomyAssignment }>
  | Readonly<{ kind: 'area'; value: AreaAssignment }>
  | Readonly<{ kind: 'media'; value: CanonicalMediaFactValue }>

export type CanonicalFactAssertion = Readonly<{
  assertionId: string
  subject: CanonicalKnowledgeSubject
  fact: CanonicalFact
  sourceObservationId: string
  observedAt: string
  confidence: number
  rightsProfileKey: string
}>

export type CanonicalFactAssertionBatch = Readonly<{
  schemaVersion: 'catalog-fact-assertion-batch.v1'
  batchId: string
  recordedAt: string
  assertions: readonly CanonicalFactAssertion[]
}>

export type SelectedFact<T> = Readonly<{ value: T; sourceAssertionId: string }>
export type ProfileTaxonomyAssignment = TaxonomyAssignment & Readonly<{
  sourceAssertionId: string
}>
export type ProfileAreaAssignment = AreaAssignment & Readonly<{
  sourceAssertionId: string
}>

export type CanonicalPlaceProfileContent = Readonly<{
  displayName: SelectedFact<LocalizedTextFactValue>
  formattedAddress: SelectedFact<LocalizedTextFactValue> | null
  location: SelectedFact<GeographicLocation> | null
  operationalStatus: SelectedFact<OperationalStatusFactValue> | null
  phone: SelectedFact<PhoneFactValue> | null
  website: SelectedFact<WebsiteFactValue> | null
  openingHours: SelectedFact<OpeningHoursFactValue> | null
  taxonomyAssignments: readonly ProfileTaxonomyAssignment[]
  areaAssignments: readonly ProfileAreaAssignment[]
  media: readonly CanonicalMediaReference[]
}>

export type PublishCanonicalPlaceProfile = Readonly<{
  schemaVersion: 'catalog-publish-profile-command.v1'
  commandId: string
  placeId: string
  expectedRevision: number | null
  policyVersion: string
  rationale: string
  evidenceAssertionIds: readonly string[]
  profile: CanonicalPlaceProfileContent
}>

export type CanonicalCurrentProfile = Readonly<{
  schemaVersion: 'catalog-current-profile.v1'
  placeId: string
  identityState: CanonicalIdentityState
  revision: number
  policyVersion: string
  publishedAt: string
  evidenceAssertionIds: readonly string[]
  profile: CanonicalPlaceProfileContent
}>

export type CanonicalKnowledgeValidationIssue = Readonly<{
  path: string
  code:
    | 'required'
    | 'invalid-format'
    | 'out-of-range'
    | 'duplicate'
    | 'too-many'
    | 'unexpected'
    | 'evidence-missing'
}>

export type CanonicalFactAssertionResult =
  | Readonly<{
      outcome: 'accepted'
      batchId: string
      status: 'recorded' | 'replayed'
      fingerprint: string
      assertionIds: readonly string[]
    }>
  | Readonly<{
      outcome: 'rejected'
      batchId: string
      rejection:
        | Readonly<{ code: 'batch-id-reused' }>
        | Readonly<{ code: 'subject-unavailable'; subject: CanonicalKnowledgeSubject }>
        | Readonly<{
            code: 'invalid-assertions'
            issues: readonly CanonicalKnowledgeValidationIssue[]
          }>
    }>

export type CanonicalProfilePublishRejection =
  | Readonly<{ code: 'revision-conflict'; currentRevision: number | null }>
  | Readonly<{ code: 'evidence-unavailable' }>
  | Readonly<{ code: 'policy-unavailable' }>
  | Readonly<{ code: 'place-unavailable' }>
  | Readonly<{ code: 'command-id-reused' }>

export type CanonicalProfilePublishResult =
  | Readonly<{
      schemaVersion: 'catalog-publish-profile-result.v1'
      outcome: 'accepted'
      commandId: string
      status: 'applied' | 'replayed'
      currentProfile: CanonicalCurrentProfile
    }>
  | Readonly<{
      schemaVersion: 'catalog-publish-profile-result.v1'
      outcome: 'rejected'
      commandId: string
      rejection: CanonicalProfilePublishRejection
    }>

export type CanonicalProfileReadResult =
  | Readonly<{ status: 'available'; currentProfile: CanonicalCurrentProfile }>
  | Readonly<{ status: 'not-found'; placeId: string }>
  | Readonly<{ status: 'invalid'; issues: readonly CanonicalKnowledgeValidationIssue[] }>
