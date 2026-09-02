import type {
  AreaAssignment,
  CanonicalFact,
  CanonicalFactAssertionBatch,
  CanonicalKnowledgeSubject,
  CanonicalKnowledgeValidationIssue,
  CanonicalMediaFactValue,
  CanonicalMediaReference,
  CanonicalPlaceProfileContent,
  OpeningHoursFactValue,
  PublishCanonicalPlaceProfile,
  TaxonomyAssignment,
} from './catalog-place-knowledge.js'

type Issue = CanonicalKnowledgeValidationIssue
type UnknownRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const providerKeyPattern = /^[a-z][a-z0-9-]{0,62}$/
const rightsProfileKeyPattern = /^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)*[.]v[1-9][0-9]{0,8}$/
const languageTagPattern = /^(?:und|[A-Za-z]{2,3})(?:-[A-Za-z0-9]{2,8})*$/
const timePattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/
const maximumAssignmentVersion = 2_147_483_647
const operationalStatuses = new Set(['operating', 'temporarily-closed', 'permanently-closed', 'unknown'])
const taxonomyRoles = new Set(['primary', 'secondary', 'attribute'])
const areaRoles = new Set(['primary', 'ancestor', 'alternate'])
const mediaRights = new Set(['display-allowed', 'attribution-required', 'restricted', 'unknown'])
const days = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])

function issue(path: string, code: Issue['code']): Issue {
  return { path, code }
}

function exactKeys(value: object, expected: readonly string[], path: string): Issue[] {
  const allowed = new Set(expected)
  return Object.keys(value).flatMap((key) =>
    allowed.has(key) ? [] : [issue(path === '' ? key : `${path}.${key}`, 'unexpected')],
  )
}

function validUuid(value: string): boolean {
  return uuidPattern.test(value)
}

function validText(value: string, maximum: number, minimum = 1): boolean {
  return value.length >= minimum && value.length <= maximum && value.trim() === value
}

function validTimestamp(value: string): boolean {
  return /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) && Number.isFinite(new Date(value).getTime())
}

function validHttpUri(value: string): boolean {
  if (value.length > 2_048) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function validateLocalizedText(value: UnknownRecord, path: string, maximum: number): Issue[] {
  const issues = exactKeys(value, ['text', 'languageTag'], path)
  if (typeof value.text !== 'string' || !validText(value.text, maximum)) {
    issues.push(issue(`${path}.text`, 'invalid-format'))
  }
  if (value.languageTag !== undefined &&
    (typeof value.languageTag !== 'string' ||
      !validText(value.languageTag, 35, 2) ||
      !languageTagPattern.test(value.languageTag))) {
    issues.push(issue(`${path}.languageTag`, 'invalid-format'))
  }
  return issues
}

function validateOpeningHours(value: OpeningHoursFactValue, path: string): Issue[] {
  const issues = exactKeys(value, ['timeZone', 'weeklyPeriods'], path)
  if (!validText(value.timeZone, 128)) issues.push(issue(`${path}.timeZone`, 'invalid-format'))
  if (value.weeklyPeriods.length === 0) issues.push(issue(`${path}.weeklyPeriods`, 'required'))
  if (value.weeklyPeriods.length > 64) issues.push(issue(`${path}.weeklyPeriods`, 'too-many'))
  value.weeklyPeriods.forEach((period, index) => {
    const prefix = `${path}.weeklyPeriods.${index}`
    issues.push(...exactKeys(period, ['opens', 'closes'], prefix))
    for (const [key, moment] of [['opens', period.opens], ['closes', period.closes]] as const) {
      const momentPath = `${prefix}.${key}`
      issues.push(...exactKeys(moment, ['dayOfWeek', 'localTime'], momentPath))
      if (!days.has(moment.dayOfWeek)) issues.push(issue(`${momentPath}.dayOfWeek`, 'invalid-format'))
      if (!timePattern.test(moment.localTime)) issues.push(issue(`${momentPath}.localTime`, 'invalid-format'))
    }
  })
  return issues
}

function validateTaxonomy(
  value: TaxonomyAssignment,
  path: string,
  allowSourceAssertion = false,
): Issue[] {
  const issues = exactKeys(
    value,
    allowSourceAssertion ? ['key', 'version', 'role', 'sourceAssertionId'] : ['key', 'version', 'role'],
    path,
  )
  if (!validText(value.key, 128)) issues.push(issue(`${path}.key`, 'invalid-format'))
  if (!Number.isInteger(value.version) ||
    value.version <= 0 || value.version > maximumAssignmentVersion) {
    issues.push(issue(`${path}.version`, 'out-of-range'))
  }
  if (!taxonomyRoles.has(value.role)) issues.push(issue(`${path}.role`, 'invalid-format'))
  return issues
}

function validateArea(
  value: AreaAssignment,
  path: string,
  allowSourceAssertion = false,
): Issue[] {
  const issues = exactKeys(
    value,
    allowSourceAssertion ? ['key', 'version', 'role', 'sourceAssertionId'] : ['key', 'version', 'role'],
    path,
  )
  if (!validText(value.key, 128)) issues.push(issue(`${path}.key`, 'invalid-format'))
  if (!Number.isInteger(value.version) ||
    value.version <= 0 || value.version > maximumAssignmentVersion) {
    issues.push(issue(`${path}.version`, 'out-of-range'))
  }
  if (!areaRoles.has(value.role)) issues.push(issue(`${path}.role`, 'invalid-format'))
  return issues
}

function validateMediaFact(value: CanonicalMediaFactValue, path: string): Issue[] {
  const issues = exactKeys(
    value,
    ['externalUri', 'size', 'rightsState', 'requiredAttributions', 'validUntil'],
    path,
  )
  if (!validHttpUri(value.externalUri)) issues.push(issue(`${path}.externalUri`, 'invalid-format'))
  if (value.size !== undefined) {
    issues.push(...exactKeys(value.size, ['width', 'height'], `${path}.size`))
    if (!Number.isInteger(value.size.width) || value.size.width <= 0 || value.size.width > 100_000) {
      issues.push(issue(`${path}.size.width`, 'out-of-range'))
    }
    if (!Number.isInteger(value.size.height) || value.size.height <= 0 || value.size.height > 100_000) {
      issues.push(issue(`${path}.size.height`, 'out-of-range'))
    }
  }
  if (!mediaRights.has(value.rightsState)) issues.push(issue(`${path}.rightsState`, 'invalid-format'))
  if (value.requiredAttributions.length > 16) issues.push(issue(`${path}.requiredAttributions`, 'too-many'))
  if (value.rightsState === 'attribution-required' && value.requiredAttributions.length === 0) {
    issues.push(issue(`${path}.requiredAttributions`, 'required'))
  }
  value.requiredAttributions.forEach((attribution, index) => {
    const prefix = `${path}.requiredAttributions.${index}`
    issues.push(...exactKeys(attribution, ['label', 'uri'], prefix))
    if (!validText(attribution.label, 200)) issues.push(issue(`${prefix}.label`, 'invalid-format'))
    if (attribution.uri !== undefined && !validHttpUri(attribution.uri)) {
      issues.push(issue(`${prefix}.uri`, 'invalid-format'))
    }
  })
  if (value.validUntil !== undefined && !validTimestamp(value.validUntil)) {
    issues.push(issue(`${path}.validUntil`, 'invalid-format'))
  }
  return issues
}

function validateMediaReference(value: CanonicalMediaReference, path: string): Issue[] {
  const issues = exactKeys(value, ['mediaReferenceId', 'sourceAssertionId'], path)
  if (!validUuid(value.mediaReferenceId)) issues.push(issue(`${path}.mediaReferenceId`, 'invalid-format'))
  if (value.sourceAssertionId === undefined) issues.push(issue(`${path}.sourceAssertionId`, 'required'))
  else if (!validUuid(value.sourceAssertionId)) issues.push(issue(`${path}.sourceAssertionId`, 'invalid-format'))
  return issues
}

function validateSubject(subject: CanonicalKnowledgeSubject, path: string): Issue[] {
  if (subject.kind === 'canonical-place') {
    const issues = exactKeys(subject, ['kind', 'placeId'], path)
    if (!validUuid(subject.placeId)) issues.push(issue(`${path}.placeId`, 'invalid-format'))
    return issues
  }
  const issues = exactKeys(subject, ['kind', 'providerKey', 'externalPlaceId'], path)
  if (!providerKeyPattern.test(subject.providerKey)) issues.push(issue(`${path}.providerKey`, 'invalid-format'))
  if (!validText(subject.externalPlaceId, 512)) issues.push(issue(`${path}.externalPlaceId`, 'invalid-format'))
  return issues
}

function subjectsMatch(
  left: CanonicalKnowledgeSubject,
  right: CanonicalKnowledgeSubject,
): boolean {
  if (left.kind !== right.kind) return false
  return left.kind === 'canonical-place' && right.kind === 'canonical-place'
    ? left.placeId === right.placeId
    : left.kind === 'provider-identity' && right.kind === 'provider-identity' &&
        left.providerKey === right.providerKey &&
        left.externalPlaceId === right.externalPlaceId
}

function validateFact(fact: CanonicalFact, path: string): Issue[] {
  const issues = exactKeys(fact, ['kind', 'value'], path)
  switch (fact.kind) {
    case 'name':
      return [...issues, ...validateLocalizedText(fact.value, `${path}.value`, 300)]
    case 'formatted-address':
      return [...issues, ...validateLocalizedText(fact.value, `${path}.value`, 500)]
    case 'location':
      issues.push(...exactKeys(fact.value, ['latitude', 'longitude'], `${path}.value`))
      if (!Number.isFinite(fact.value.latitude) || fact.value.latitude < -90 || fact.value.latitude > 90) {
        issues.push(issue(`${path}.value.latitude`, 'out-of-range'))
      }
      if (!Number.isFinite(fact.value.longitude) || fact.value.longitude < -180 || fact.value.longitude > 180) {
        issues.push(issue(`${path}.value.longitude`, 'out-of-range'))
      }
      return issues
    case 'operational-status':
      issues.push(...exactKeys(fact.value, ['status'], `${path}.value`))
      if (!operationalStatuses.has(fact.value.status)) issues.push(issue(`${path}.value.status`, 'invalid-format'))
      return issues
    case 'phone':
      issues.push(...exactKeys(fact.value, ['display', 'e164'], `${path}.value`))
      if (!validText(fact.value.display, 128)) issues.push(issue(`${path}.value.display`, 'invalid-format'))
      if (fact.value.e164 !== undefined && !/^\+[1-9][0-9]{1,14}$/.test(fact.value.e164)) {
        issues.push(issue(`${path}.value.e164`, 'invalid-format'))
      }
      return issues
    case 'website':
      issues.push(...exactKeys(fact.value, ['uri'], `${path}.value`))
      if (!validHttpUri(fact.value.uri)) issues.push(issue(`${path}.value.uri`, 'invalid-format'))
      return issues
    case 'opening-hours':
      return [...issues, ...validateOpeningHours(fact.value, `${path}.value`)]
    case 'taxonomy':
      return [...issues, ...validateTaxonomy(fact.value, `${path}.value`)]
    case 'area':
      return [...issues, ...validateArea(fact.value, `${path}.value`)]
    case 'media':
      return [...issues, ...validateMediaFact(fact.value, `${path}.value`)]
  }
}

function sourceAssertionIds(profile: CanonicalPlaceProfileContent): string[] {
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
    ...selected.flatMap((item) => item?.sourceAssertionId === undefined ? [] : [item.sourceAssertionId]),
    ...profile.taxonomyAssignments.flatMap((item) => item.sourceAssertionId === undefined ? [] : [item.sourceAssertionId]),
    ...profile.areaAssignments.flatMap((item) => item.sourceAssertionId === undefined ? [] : [item.sourceAssertionId]),
    ...profile.media.flatMap((item) => item.sourceAssertionId === undefined ? [] : [item.sourceAssertionId]),
  ]
}

function validateSelected(
  selected: { value: unknown; sourceAssertionId?: string },
  path: string,
  validateValue: (value: never, path: string) => Issue[],
): Issue[] {
  const issues = exactKeys(selected, ['value', 'sourceAssertionId'], path)
  issues.push(...validateValue(selected.value as never, `${path}.value`))
  if (selected.sourceAssertionId === undefined) issues.push(issue(`${path}.sourceAssertionId`, 'required'))
  else if (!validUuid(selected.sourceAssertionId)) issues.push(issue(`${path}.sourceAssertionId`, 'invalid-format'))
  return issues
}

function validateProfile(profile: CanonicalPlaceProfileContent, path: string): Issue[] {
  const issues = exactKeys(profile, [
    'displayName', 'formattedAddress', 'location', 'operationalStatus', 'phone', 'website',
    'openingHours', 'taxonomyAssignments', 'areaAssignments', 'media',
  ], path)
  issues.push(...validateSelected(profile.displayName, `${path}.displayName`,
    (value: UnknownRecord, valuePath) => validateLocalizedText(value, valuePath, 300)))
  if (profile.formattedAddress !== null) issues.push(...validateSelected(
    profile.formattedAddress, `${path}.formattedAddress`,
    (value: UnknownRecord, valuePath) => validateLocalizedText(value, valuePath, 500),
  ))
  if (profile.location !== null) issues.push(...validateSelected(
    profile.location, `${path}.location`, (value: { latitude: number; longitude: number }, valuePath) => {
      const result = exactKeys(value, ['latitude', 'longitude'], valuePath)
      if (!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) result.push(issue(`${valuePath}.latitude`, 'out-of-range'))
      if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) result.push(issue(`${valuePath}.longitude`, 'out-of-range'))
      return result
    },
  ))
  if (profile.operationalStatus !== null) issues.push(...validateSelected(
    profile.operationalStatus, `${path}.operationalStatus`, (value: { status: string }, valuePath) => {
      const result = exactKeys(value, ['status'], valuePath)
      if (!operationalStatuses.has(value.status)) result.push(issue(`${valuePath}.status`, 'invalid-format'))
      return result
    },
  ))
  if (profile.phone !== null) issues.push(...validateSelected(
    profile.phone, `${path}.phone`, (value: { display: string; e164?: string }, valuePath) => {
      const result = exactKeys(value, ['display', 'e164'], valuePath)
      if (!validText(value.display, 128)) result.push(issue(`${valuePath}.display`, 'invalid-format'))
      if (value.e164 !== undefined && !/^\+[1-9][0-9]{1,14}$/.test(value.e164)) result.push(issue(`${valuePath}.e164`, 'invalid-format'))
      return result
    },
  ))
  if (profile.website !== null) issues.push(...validateSelected(
    profile.website, `${path}.website`, (value: { uri: string }, valuePath) => {
      const result = exactKeys(value, ['uri'], valuePath)
      if (!validHttpUri(value.uri)) result.push(issue(`${valuePath}.uri`, 'invalid-format'))
      return result
    },
  ))
  if (profile.openingHours !== null) issues.push(...validateSelected(
    profile.openingHours, `${path}.openingHours`, validateOpeningHours,
  ))
  if (profile.taxonomyAssignments.length > 64) issues.push(issue(`${path}.taxonomyAssignments`, 'too-many'))
  profile.taxonomyAssignments.forEach((item, index) => {
    issues.push(...validateTaxonomy(item, `${path}.taxonomyAssignments.${index}`, true))
    if (item.sourceAssertionId === undefined) issues.push(issue(`${path}.taxonomyAssignments.${index}.sourceAssertionId`, 'required'))
    else if (!validUuid(item.sourceAssertionId)) issues.push(issue(`${path}.taxonomyAssignments.${index}.sourceAssertionId`, 'invalid-format'))
  })
  if (new Set(profile.taxonomyAssignments.map(({ key, version }) => `${key}\u0000${version}`)).size !==
    profile.taxonomyAssignments.length) {
    issues.push(issue(`${path}.taxonomyAssignments`, 'duplicate'))
  }
  if (profile.taxonomyAssignments.filter(({ role }) => role === 'primary').length > 1) {
    issues.push(issue(`${path}.taxonomyAssignments`, 'too-many'))
  }
  if (profile.areaAssignments.length > 64) issues.push(issue(`${path}.areaAssignments`, 'too-many'))
  profile.areaAssignments.forEach((item, index) => {
    issues.push(...validateArea(item, `${path}.areaAssignments.${index}`, true))
    if (item.sourceAssertionId === undefined) issues.push(issue(`${path}.areaAssignments.${index}.sourceAssertionId`, 'required'))
    else if (!validUuid(item.sourceAssertionId)) issues.push(issue(`${path}.areaAssignments.${index}.sourceAssertionId`, 'invalid-format'))
  })
  if (new Set(profile.areaAssignments.map(({ key, version }) => `${key}\u0000${version}`)).size !==
    profile.areaAssignments.length) {
    issues.push(issue(`${path}.areaAssignments`, 'duplicate'))
  }
  if (profile.areaAssignments.filter(({ role }) => role === 'primary').length > 1) {
    issues.push(issue(`${path}.areaAssignments`, 'too-many'))
  }
  if (profile.media.length > 32) issues.push(issue(`${path}.media`, 'too-many'))
  profile.media.forEach((item, index) => {
    issues.push(...validateMediaReference(item, `${path}.media.${index}`))
  })
  if (new Set(profile.media.map(({ mediaReferenceId }) => mediaReferenceId)).size !==
    profile.media.length) {
    issues.push(issue(`${path}.media`, 'duplicate'))
  }
  return issues
}

export function validateCatalogAssertionBatch(input: CanonicalFactAssertionBatch): readonly Issue[] {
  const issues = exactKeys(input, ['schemaVersion', 'batchId', 'recordedAt', 'assertions'], '')
  if (input.schemaVersion !== 'catalog-fact-assertion-batch.v1') issues.push(issue('schemaVersion', 'invalid-format'))
  if (!validUuid(input.batchId)) issues.push(issue('batchId', 'invalid-format'))
  if (!validTimestamp(input.recordedAt)) issues.push(issue('recordedAt', 'invalid-format'))
  if (input.assertions.length === 0) issues.push(issue('assertions', 'required'))
  if (input.assertions.length > 256) issues.push(issue('assertions', 'too-many'))
  input.assertions.forEach((assertion, index) => {
    const prefix = `assertions.${index}`
    issues.push(...exactKeys(assertion, ['assertionId', 'subject', 'fact', 'sourceObservationId', 'observedAt', 'confidence', 'rightsProfileKey'], prefix))
    if (!validUuid(assertion.assertionId)) issues.push(issue(`${prefix}.assertionId`, 'invalid-format'))
    issues.push(...validateSubject(assertion.subject, `${prefix}.subject`))
    issues.push(...validateFact(assertion.fact, `${prefix}.fact`))
    if (!validUuid(assertion.sourceObservationId)) issues.push(issue(`${prefix}.sourceObservationId`, 'invalid-format'))
    if (!validTimestamp(assertion.observedAt)) issues.push(issue(`${prefix}.observedAt`, 'invalid-format'))
    if (!Number.isFinite(assertion.confidence) || assertion.confidence < 0 ||
      assertion.confidence > 1 || !Number.isInteger(assertion.confidence * 1_000)) {
      issues.push(issue(`${prefix}.confidence`, 'out-of-range'))
    }
    if (!validText(assertion.rightsProfileKey, 128) ||
      !rightsProfileKeyPattern.test(assertion.rightsProfileKey)) {
      issues.push(issue(`${prefix}.rightsProfileKey`, 'invalid-format'))
    }
  })
  if (new Set(input.assertions.map(({ assertionId }) => assertionId)).size !== input.assertions.length) issues.push(issue('assertions', 'duplicate'))
  const first = input.assertions[0]
  if (first !== undefined) {
    if (validTimestamp(input.recordedAt) && validTimestamp(first.observedAt) &&
      Date.parse(input.recordedAt) < Date.parse(first.observedAt)) {
      issues.push(issue('recordedAt', 'out-of-range'))
    }
    input.assertions.slice(1).forEach((assertion, offset) => {
      const index = offset + 1
      const consistencyChecks = [
        ['subject', subjectsMatch(assertion.subject, first.subject)],
        ['sourceObservationId', assertion.sourceObservationId === first.sourceObservationId],
        ['observedAt', assertion.observedAt === first.observedAt],
        ['rightsProfileKey', assertion.rightsProfileKey === first.rightsProfileKey],
      ] as const
      for (const [field, matches] of consistencyChecks) {
        if (!matches) issues.push(issue(`assertions.${index}.${field}`, 'invalid-format'))
      }
    })
  }
  return issues
}

export function validateCatalogProfileCommand(input: PublishCanonicalPlaceProfile): readonly Issue[] {
  const issues = exactKeys(input, ['schemaVersion', 'commandId', 'placeId', 'expectedRevision', 'policyVersion', 'rationale', 'evidenceAssertionIds', 'profile'], '')
  if (input.schemaVersion !== 'catalog-publish-profile-command.v1') issues.push(issue('schemaVersion', 'invalid-format'))
  if (!validUuid(input.commandId)) issues.push(issue('commandId', 'invalid-format'))
  if (!validUuid(input.placeId)) issues.push(issue('placeId', 'invalid-format'))
  if (input.expectedRevision !== null && (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0)) issues.push(issue('expectedRevision', 'out-of-range'))
  if (!validText(input.policyVersion, 128)) issues.push(issue('policyVersion', 'invalid-format'))
  if (!validText(input.rationale, 2_000)) issues.push(issue('rationale', 'invalid-format'))
  if (input.evidenceAssertionIds.length === 0) issues.push(issue('evidenceAssertionIds', 'required'))
  if (input.evidenceAssertionIds.length > 512) issues.push(issue('evidenceAssertionIds', 'too-many'))
  input.evidenceAssertionIds.forEach((id, index) => {
    if (!validUuid(id)) issues.push(issue(`evidenceAssertionIds.${index}`, 'invalid-format'))
  })
  if (new Set(input.evidenceAssertionIds).size !== input.evidenceAssertionIds.length) issues.push(issue('evidenceAssertionIds', 'duplicate'))
  issues.push(...validateProfile(input.profile, 'profile'))
  const evidence = new Set(input.evidenceAssertionIds)
  for (const id of sourceAssertionIds(input.profile)) {
    if (!evidence.has(id)) issues.push(issue('profile', 'evidence-missing'))
  }
  return issues
}

export function validateCanonicalKnowledgeWriteContext(
  input: unknown,
): readonly Issue[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return [issue('context', 'required')]
  }
  const context = input as UnknownRecord
  const issues = exactKeys(context, ['actor'], 'context')
  if (context.actor === null || typeof context.actor !== 'object' || Array.isArray(context.actor)) {
    issues.push(issue('context.actor', 'required'))
    return issues
  }
  const actor = context.actor as UnknownRecord
  issues.push(...exactKeys(actor, ['kind', 'reference'], 'context.actor'))
  if (actor.kind !== 'policy' && actor.kind !== 'reviewer') {
    issues.push(issue('context.actor.kind', 'invalid-format'))
  }
  if (typeof actor.reference !== 'string' || !validText(actor.reference, 512)) {
    issues.push(issue('context.actor.reference', 'invalid-format'))
  }
  return issues
}

export function validCatalogUuid(value: string): boolean {
  return validUuid(value)
}

export class InvalidCanonicalPlaceKnowledgeInputError extends Error {
  override readonly name = 'InvalidCanonicalPlaceKnowledgeInputError'
  readonly issues: readonly Issue[]

  constructor(issues: readonly Issue[]) {
    super('Canonical Place knowledge input is invalid')
    this.issues = issues
  }
}
