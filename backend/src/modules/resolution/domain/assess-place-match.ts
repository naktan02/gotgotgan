import { fingerprint } from './fingerprint.js'
import { scriptsOfComparisonText } from './normalize-place-evidence.js'
import type {
  MatchAssessment,
  MatchFeatureVector,
  MatchReason,
  NormalizedNameRepresentation,
  NormalizedPlaceIdentityEvidence,
} from './model.js'

export const placeMatchPolicyVersion = 'cross-provider-place-match.v1'

function rounded(value: number, digits = 3): number {
  return Number(value.toFixed(digits))
}

function stringBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value])
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)))
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1
  const leftBigrams = stringBigrams(left)
  const rightBigrams = stringBigrams(right)
  let shared = 0
  for (const value of leftBigrams) if (rightBigrams.has(value)) shared += 1
  return rounded((2 * shared) / (leftBigrams.size + rightBigrams.size))
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const union = new Set([...leftTokens, ...rightTokens])
  if (union.size === 0) return 0
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1
  return rounded(shared / union.size)
}

function comparableScripts(
  left: NormalizedNameRepresentation['scripts'],
  right: NormalizedNameRepresentation['scripts'],
): boolean {
  if (left.length === 0 || right.length === 0) return true
  return left.some((script) => right.includes(script))
}

function comparableSimilarity(
  left: Readonly<{ normalizedText: string; scripts: NormalizedNameRepresentation['scripts'] }>,
  right: Readonly<{ normalizedText: string; scripts: NormalizedNameRepresentation['scripts'] }>,
): number | null {
  if (!comparableScripts(left.scripts, right.scripts)) return null
  return rounded(
    (diceSimilarity(left.normalizedText, right.normalizedText) * 0.7) +
    (tokenSimilarity(left.normalizedText, right.normalizedText) * 0.3),
  )
}

function maximumNameSimilarity(
  left: NormalizedPlaceIdentityEvidence,
  right: NormalizedPlaceIdentityEvidence,
): number | null {
  const similarities = left.names.flatMap((leftName) => right.names.flatMap((rightName) => {
    const value = comparableSimilarity(leftName, rightName)
    return value === null ? [] : [value]
  }))
  return similarities.length === 0 ? null : Math.max(...similarities)
}

function addressSimilarity(
  left: NormalizedPlaceIdentityEvidence,
  right: NormalizedPlaceIdentityEvidence,
): number | null {
  if (left.normalizedAddress === null || right.normalizedAddress === null) return null
  return comparableSimilarity(
    {
      normalizedText: left.normalizedAddress,
      scripts: scriptsOfComparisonText(left.normalizedAddress),
    },
    {
      normalizedText: right.normalizedAddress,
      scripts: scriptsOfComparisonText(right.normalizedAddress),
    },
  )
}

function distanceMeters(
  left: NormalizedPlaceIdentityEvidence,
  right: NormalizedPlaceIdentityEvidence,
): number | null {
  if (left.location === null || right.location === null) return null
  const radians = (degrees: number) => degrees * Math.PI / 180
  const deltaLatitude = radians(right.location.latitude - left.location.latitude)
  const deltaLongitude = radians(right.location.longitude - left.location.longitude)
  const leftLatitude = radians(left.location.latitude)
  const rightLatitude = radians(right.location.latitude)
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(deltaLongitude / 2) ** 2
  return rounded(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 1)
}

function exact(left: string | null, right: string | null): boolean | null {
  return left === null || right === null ? null : left === right
}

function textRelation(left: string | null, right: string | null): 'same' | 'different' | 'unknown' {
  if (left === null || right === null) return 'unknown'
  if (!comparableScripts(scriptsOfComparisonText(left), scriptsOfComparisonText(right))) {
    return 'unknown'
  }
  return left === right ? 'same' : 'different'
}

function exactRelation(left: string | null, right: string | null): 'same' | 'different' | 'unknown' {
  if (left === null || right === null) return 'unknown'
  return left === right ? 'same' : 'different'
}

function featuresOf(
  left: NormalizedPlaceIdentityEvidence,
  right: NormalizedPlaceIdentityEvidence,
): MatchFeatureVector {
  return {
    distanceMeters: distanceMeters(left, right),
    nameSimilarity: maximumNameSimilarity(left, right),
    addressSimilarity: addressSimilarity(left, right),
    phoneExact: exact(left.phoneDigits, right.phoneDigits),
    websiteHostExact: exact(left.websiteHost, right.websiteHost),
    categoryExact: exact(left.categoryKey, right.categoryKey),
    branchRelation: textRelation(left.branchKey, right.branchKey),
    floorRelation: exactRelation(left.floorKey, right.floorKey),
    observationGapDays: rounded(
      Math.abs(Date.parse(left.observedAt) - Date.parse(right.observedAt)) / 86_400_000,
      1,
    ),
  }
}

function classify(features: MatchFeatureVector): Readonly<{
  classification: MatchAssessment['classification']
  confidence: number
  reasons: readonly MatchReason[]
}> {
  const reasons: MatchReason[] = []
  if (features.nameSimilarity === null) reasons.push('cross-script-name')
  if (features.phoneExact === true) reasons.push('exact-phone')
  if (features.websiteHostExact === true) reasons.push('exact-website-host')
  if (features.distanceMeters !== null && features.distanceMeters <= 250) reasons.push('nearby-location')
  if (features.nameSimilarity !== null && features.nameSimilarity >= 0.6) reasons.push('similar-name')
  if (features.addressSimilarity !== null && features.addressSimilarity >= 0.7) reasons.push('similar-address')
  if (features.categoryExact === true) reasons.push('same-category')
  if (features.branchRelation === 'different') reasons.push('different-branch')
  if (features.floorRelation === 'different') reasons.push('different-floor')

  if (
    features.distanceMeters !== null &&
    features.distanceMeters > 5_000 &&
    features.observationGapDays <= 365
  ) {
    reasons.push('far-apart-concurrent-observations')
    return { classification: 'likely-different', confidence: 0.99, reasons }
  }
  if (
    features.distanceMeters !== null && features.distanceMeters <= 120 &&
    (features.floorRelation === 'different' || features.branchRelation === 'different')
  ) return { classification: 'likely-different', confidence: 0.95, reasons }

  let support = 0
  if (features.phoneExact === true) support += 0.45
  if (features.distanceMeters !== null) {
    if (features.distanceMeters <= 50) support += 0.35
    else if (features.distanceMeters <= 250) support += 0.25
    else if (features.distanceMeters <= 1_000) support += 0.1
  }
  if (features.nameSimilarity !== null) {
    if (features.nameSimilarity >= 0.82) support += 0.3
    else if (features.nameSimilarity >= 0.6) support += 0.15
  }
  if (features.addressSimilarity !== null && features.addressSimilarity >= 0.8) support += 0.2
  if (features.websiteHostExact === true) support += 0.05
  if (features.categoryExact === true) support += 0.05

  if (support >= 0.75) {
    return { classification: 'likely-same', confidence: rounded(Math.min(0.99, support)), reasons }
  }
  if (reasons.length === 0) reasons.push('insufficient-evidence')
  return {
    classification: 'needs-review',
    confidence: rounded(Math.max(0.5, Math.min(0.74, support))),
    reasons,
  }
}

export function assessPlaceMatch(
  first: NormalizedPlaceIdentityEvidence,
  second: NormalizedPlaceIdentityEvidence,
  assessedAt: string,
): MatchAssessment {
  const [left, right] = first.sourceObservationId.localeCompare(second.sourceObservationId) <= 0
    ? [first, second]
    : [second, first]
  const features = featuresOf(left, right)
  const result = classify(features)
  const values = {
    leftObservationId: left.sourceObservationId,
    rightObservationId: right.sourceObservationId,
    leftIdentity: left.providerIdentity,
    rightIdentity: right.providerIdentity,
    policyVersion: placeMatchPolicyVersion,
    classification: result.classification,
    confidence: result.confidence,
    features,
    reasons: result.reasons,
    assessedAt,
  }
  const { assessedAt: _assessedAt, ...repeatableValues } = values
  return { ...values, fingerprint: fingerprint(repeatableValues) }
}
