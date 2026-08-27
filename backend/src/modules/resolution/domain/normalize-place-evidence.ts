import { fingerprint } from './fingerprint.js'
import {
  InvalidPlaceEvidenceError,
  type NormalizedNameRepresentation,
  type NormalizedPlaceIdentityEvidence,
  type PlaceIdentityEvidence,
  type TextScript,
} from './model.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const providerKeyPattern = /^[a-z][a-z0-9-]{0,62}$/
const languageTagPattern = /^(?:und|[a-z]{2,3})(?:-[a-z0-9]{2,8})*$/i

export function normalizeComparisonText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scriptsOfComparisonText(value: string): readonly TextScript[] {
  const scripts = new Set<TextScript>()
  for (const character of value) {
    if (/\p{Script=Hangul}/u.test(character)) scripts.add('hangul')
    else if (/\p{Script=Latin}/u.test(character)) scripts.add('latin')
    else if (/\p{Script=Han}/u.test(character)) scripts.add('han')
    else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) scripts.add('kana')
    else if (/\p{L}/u.test(character)) scripts.add('other')
  }
  return [...scripts].sort()
}

function boundedOptional(value: string | null | undefined, field: string, maximum: number) {
  if (value === undefined || value === null) return null
  if (value.trim().length === 0 || value.length > maximum) {
    throw new InvalidPlaceEvidenceError(`${field} must contain bounded non-empty text`)
  }
  return value
}

function normalizePhone(value: string | null): string | null {
  if (value === null) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return digits.length > 8 ? digits.slice(-8) : digits
}

function normalizeFloor(value: string | null): string | null {
  if (value === null) return null
  const normalized = normalizeComparisonText(value)
  const number = normalized.match(/\d+/)?.[0]
  if (number === undefined) return normalized
  const belowGround = /(?:^|\s)b\s*\d|basement|지하/u.test(normalized)
  return `${belowGround ? 'below' : 'above'}:${Number(number)}`
}

function normalizeWebsite(value: string | null): string | null {
  if (value === null) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InvalidPlaceEvidenceError('website must be an absolute HTTP URL')
  }
  if (!new Set(['http:', 'https:']).has(url.protocol)) {
    throw new InvalidPlaceEvidenceError('website must be an absolute HTTP URL')
  }
  return url.hostname.toLocaleLowerCase('und').replace(/^www\./, '')
}

function normalizeLanguageTag(value: string | undefined): string | null {
  if (value === undefined) return null
  if (!languageTagPattern.test(value)) {
    throw new InvalidPlaceEvidenceError('languageTag must be a bounded BCP 47-like tag')
  }
  return value.toLocaleLowerCase('und')
}

function normalizeNames(input: PlaceIdentityEvidence): readonly NormalizedNameRepresentation[] {
  if (input.names.length === 0 || input.names.length > 16) {
    throw new InvalidPlaceEvidenceError('names must contain between one and sixteen values')
  }
  const names = input.names.map((name) => {
    if (name.text.trim().length === 0 || name.text.length > 512) {
      throw new InvalidPlaceEvidenceError('name text must contain bounded non-empty text')
    }
    const normalizedText = normalizeComparisonText(name.text)
    if (normalizedText.length === 0) {
      throw new InvalidPlaceEvidenceError('name text must contain comparable characters')
    }
    return {
      rawText: name.text,
      languageTag: normalizeLanguageTag(name.languageTag),
      normalizedText,
      scripts: scriptsOfComparisonText(normalizedText),
    }
  })
  return names.filter((name, index) => names.findIndex((candidate) =>
    candidate.rawText === name.rawText &&
    candidate.languageTag === name.languageTag &&
    candidate.normalizedText === name.normalizedText) === index)
}

function assertLocation(input: PlaceIdentityEvidence): void {
  const location = input.location
  if (location === undefined || location === null) return
  if (
    !Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90 ||
    !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180
  ) throw new InvalidPlaceEvidenceError('location must contain valid WGS84 coordinates')
}

export function normalizePlaceIdentityEvidence(
  input: PlaceIdentityEvidence,
): NormalizedPlaceIdentityEvidence {
  if (!uuidPattern.test(input.sourceObservationId)) {
    throw new InvalidPlaceEvidenceError('sourceObservationId must be a UUID')
  }
  if (!providerKeyPattern.test(input.providerIdentity.providerKey)) {
    throw new InvalidPlaceEvidenceError('providerKey must be a stable lowercase identifier')
  }
  if (
    input.providerIdentity.externalPlaceId.length === 0 ||
    input.providerIdentity.externalPlaceId.length > 512
  ) throw new InvalidPlaceEvidenceError('externalPlaceId must contain bounded text')
  if (Number.isNaN(Date.parse(input.observedAt))) {
    throw new InvalidPlaceEvidenceError('observedAt must be an ISO timestamp')
  }
  assertLocation(input)

  const names = normalizeNames(input)
  const address = boundedOptional(input.address, 'address', 2_048)
  const phone = boundedOptional(input.phone, 'phone', 128)
  const website = boundedOptional(input.website, 'website', 2_048)
  const category = boundedOptional(input.category, 'category', 512)
  const branch = boundedOptional(input.branch, 'branch', 512)
  const floor = boundedOptional(input.floor, 'floor', 128)
  const values = {
    sourceObservationId: input.sourceObservationId,
    providerIdentity: input.providerIdentity,
    observedAt: new Date(input.observedAt).toISOString(),
    names,
    normalizedNameSearch: [...new Set(names.map((name) => name.normalizedText))]
      .sort()
      .join(' '),
    address,
    normalizedAddress: address === null ? null : normalizeComparisonText(address),
    phone,
    phoneDigits: normalizePhone(phone),
    website,
    websiteHost: normalizeWebsite(website),
    category,
    categoryKey: category === null ? null : normalizeComparisonText(category),
    branch,
    branchKey: branch === null ? null : normalizeComparisonText(branch),
    floor,
    floorKey: normalizeFloor(floor),
    location: input.location ?? null,
  }
  return { ...values, fingerprint: fingerprint(values) }
}
