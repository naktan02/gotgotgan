import type { GeographicDestination } from '../../domain/geographic-destination.js'
import { geographicReferenceData } from './reference-data.generated.js'
import { koreanGeographicReferenceData } from './korean-reference-data.js'

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')
}

const indexed = [...geographicReferenceData, ...koreanGeographicReferenceData]
  .map((destination) => ({ destination, names: destination.names.map(normalized) }))

function lookup(query: string, limit: number, legacy = false): readonly GeographicDestination[] {
  const text = normalized(query)
  if (text.length < 2) return []
  return (legacy ? indexed.slice(0, geographicReferenceData.length) : indexed).flatMap(({ destination, names }) => {
    const score = names.includes(text) ? 3 : names.some((name) => name.startsWith(text)) ? 2
      : names.some((name) => name.includes(text)) ? 1 : 0
    return score === 0 ? [] : [{ destination, score }]
  }).sort((left, right) => right.score - left.score ||
    (legacy ? 0 : Number(right.destination.kind === 'city') - Number(left.destination.kind === 'city')) ||
    left.destination.name.localeCompare(right.destination.name, 'ko'))
    .slice(0, Math.max(1, Math.min(20, limit))).map(({ destination }) => destination)
}

export const searchGeographicCatalog = (query: string, limit = 8) => lookup(query, limit)
export const searchLegacyGeographicCatalog = (query: string, limit = 8) => lookup(query, limit, true)
