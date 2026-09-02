export const mediaSurfaces = [
  'place-detail',
  'search-card',
  'library-card',
  'public-share',
] as const

export type MediaSurface = (typeof mediaSurfaces)[number]
export type MediaRightsState = 'pending' | 'allowed' | 'blocked' | 'expired' | 'withdrawn'
export type MediaRightsBasis =
  | 'unknown'
  | 'provider-terms'
  | 'open-license'
  | 'rights-holder-license'
  | 'member-license'
  | 'internal-license'

export type PlaceMediaSource = Readonly<{
  mediaId: string
  placeId: string
  sourceAssertionId: string
  source:
    | Readonly<{
        kind: 'provider-media'
        sourceObservationId: string
        providerKey: string
        providerMediaIdentity: string
      }>
    | Readonly<{
        kind: 'internal-object'
        sourceObservationId: string
        objectReference: string
      }>
  mediaType: 'image'
  size: Readonly<{ width: number; height: number }> | null
  contentFingerprint: string | null
  observedAt: string
  sourceFingerprint: string
  createdAt: string
}>

export type MediaAttribution = Readonly<{
  label: string
  uri: string | null
}>

export type MediaRightsRevision = Readonly<{
  mediaId: string
  revision: number
  expectedPreviousRevision: number | null
  state: MediaRightsState
  allowedSurfaces: readonly MediaSurface[]
  basis: MediaRightsBasis
  attributionRequired: boolean
  licenseUri: string | null
  validFrom: string
  validUntil: string | null
  decidedBy: Readonly<{ kind: 'policy' | 'reviewer'; reference: string }>
  decidedAt: string
  fingerprint: string
  attributions: readonly MediaAttribution[]
}>

export type DisplayablePlaceMedia = Readonly<{
  mediaReferenceId: string
  placeId: string
  profileRevision: number
  mediaType: 'image'
  rightsState: 'display-allowed' | 'attribution-required'
  size: Readonly<{ width: number; height: number }> | null
  validUntil: string | null
  requiredAttributions: readonly MediaAttribution[]
  deliverySource:
    | Readonly<{ kind: 'provider-media'; providerKey: string; providerMediaIdentity: string }>
    | Readonly<{ kind: 'internal-object'; objectReference: string }>
}>

export type RecordMediaSourceResult =
  | Readonly<{ status: 'recorded' | 'replayed'; mediaId: string }>
  | Readonly<{
      status: 'rejected'
      mediaId: string
      code: 'media-id-reused' | 'source-identity-reused' | 'place-unavailable' | 'evidence-unavailable'
    }>

export type DecideMediaRightsResult =
  | Readonly<{ status: 'decided' | 'replayed'; mediaId: string; revision: number }>
  | Readonly<{
      status: 'rejected'
      mediaId: string
      code: 'media-unavailable' | 'revision-conflict' | 'revision-reused'
      currentRevision?: number
    }>

export class InvalidPlaceMediaError extends Error {
  override readonly name = 'InvalidPlaceMediaError'
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fingerprintPattern = /^[a-f0-9]{64}$/

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function validHttpUri(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) &&
      url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function assertPlaceMediaSource(source: PlaceMediaSource): void {
  const validSize = source.size === null || (
    Number.isInteger(source.size.width) && source.size.width > 0 && source.size.width <= 100_000 &&
    Number.isInteger(source.size.height) && source.size.height > 0 && source.size.height <= 100_000
  )
  const validSource = source.source.kind === 'provider-media'
    ? uuidPattern.test(source.source.sourceObservationId) &&
      /^[a-z][a-z0-9-]{0,62}$/.test(source.source.providerKey) &&
      source.source.providerMediaIdentity.length >= 1 &&
      source.source.providerMediaIdentity.length <= 2_048 &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source.source.providerMediaIdentity)
    : uuidPattern.test(source.source.sourceObservationId) &&
      source.source.objectReference.length >= 1 &&
      source.source.objectReference.length <= 1_024 &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source.source.objectReference)
  if (
    !uuidPattern.test(source.mediaId) || !uuidPattern.test(source.placeId) ||
    !uuidPattern.test(source.sourceAssertionId) ||
    !validSource || !validSize ||
    (source.contentFingerprint !== null && !fingerprintPattern.test(source.contentFingerprint)) ||
    !validTimestamp(source.observedAt) || !validTimestamp(source.createdAt) ||
    Date.parse(source.createdAt) < Date.parse(source.observedAt) ||
    !fingerprintPattern.test(source.sourceFingerprint)
  ) throw new InvalidPlaceMediaError('Place media source is invalid.')
}

export function assertMediaRightsRevision(rights: MediaRightsRevision): void {
  const surfaces = new Set(rights.allowedSurfaces)
  const allowedShape = rights.state === 'allowed'
    ? rights.allowedSurfaces.length > 0 && rights.basis !== 'unknown'
    : rights.allowedSurfaces.length === 0
  if (
    !uuidPattern.test(rights.mediaId) ||
    !Number.isInteger(rights.revision) || rights.revision < 1 ||
    rights.expectedPreviousRevision !== (rights.revision === 1 ? null : rights.revision - 1) ||
    surfaces.size !== rights.allowedSurfaces.length ||
    rights.allowedSurfaces.some((surface) => !mediaSurfaces.includes(surface)) ||
    !allowedShape ||
    (rights.licenseUri !== null && (!validHttpUri(rights.licenseUri) || rights.licenseUri.length > 2_048)) ||
    !validTimestamp(rights.validFrom) || !validTimestamp(rights.decidedAt) ||
    (rights.validUntil !== null && (
      !validTimestamp(rights.validUntil) ||
      Date.parse(rights.validUntil) <= Date.parse(rights.validFrom) ||
      (rights.state === 'allowed' && Date.parse(rights.validUntil) <= Date.parse(rights.decidedAt))
    )) ||
    (rights.state === 'expired' && (
      rights.validUntil === null || Date.parse(rights.validUntil) > Date.parse(rights.decidedAt)
    )) ||
    !['policy', 'reviewer'].includes(rights.decidedBy.kind) ||
    rights.decidedBy.reference.trim().length < 1 || rights.decidedBy.reference.length > 512 ||
    !fingerprintPattern.test(rights.fingerprint) ||
    rights.attributions.length > 16 ||
    rights.attributions.some(({ label, uri }) => (
      label.trim().length < 1 || label.length > 200 ||
      (uri !== null && (!validHttpUri(uri) || uri.length > 2_048))
    )) ||
    (rights.state === 'allowed' && rights.attributionRequired && rights.attributions.length === 0)
  ) throw new InvalidPlaceMediaError('Media rights revision is invalid.')
}
