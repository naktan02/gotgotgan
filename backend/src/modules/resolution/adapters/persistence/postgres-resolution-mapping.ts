import type {
  NormalizedNameRepresentation,
  NormalizedPlaceIdentityEvidence,
} from '../../domain/model.js'

export type EvidenceRow = Readonly<{
  provider_key: string
  external_place_id: string
  source_observation_id: string
  observed_at: string | Date
  names: unknown
  normalized_name_search: string
  address: string | null
  normalized_address: string | null
  phone: string | null
  phone_digits: string | null
  website: string | null
  website_host: string | null
  category_label: string | null
  category_key: string | null
  branch_label: string | null
  branch_key: string | null
  floor_label: string | null
  floor_key: string | null
  latitude: number | string | null
  longitude: number | string | null
  evidence_fingerprint: string
}>

export function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function namesFrom(value: unknown): readonly NormalizedNameRepresentation[] {
  if (!Array.isArray(value)) throw new Error('Resolution evidence names are invalid.')
  return value as readonly NormalizedNameRepresentation[]
}

export function evidenceFromRow(row: EvidenceRow): NormalizedPlaceIdentityEvidence {
  return {
    sourceObservationId: row.source_observation_id,
    providerIdentity: {
      providerKey: row.provider_key,
      externalPlaceId: row.external_place_id,
    },
    observedAt: iso(row.observed_at),
    names: namesFrom(row.names),
    normalizedNameSearch: row.normalized_name_search,
    address: row.address,
    normalizedAddress: row.normalized_address,
    phone: row.phone,
    phoneDigits: row.phone_digits,
    website: row.website,
    websiteHost: row.website_host,
    category: row.category_label,
    categoryKey: row.category_key,
    branch: row.branch_label,
    branchKey: row.branch_key,
    floor: row.floor_label,
    floorKey: row.floor_key,
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    fingerprint: row.evidence_fingerprint,
  }
}

export const evidenceColumns = `
  provider_key, external_place_id, source_observation_id, observed_at, names,
  normalized_name_search, address, normalized_address, phone, phone_digits,
  website, website_host, category_label, category_key, branch_label, branch_key,
  floor_label, floor_key,
  CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location::geometry) END AS latitude,
  CASE WHEN location IS NULL THEN NULL ELSE ST_X(location::geometry) END AS longitude,
  evidence_fingerprint
`
