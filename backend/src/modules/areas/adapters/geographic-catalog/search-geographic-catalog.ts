import type { GeographicDestination } from '../../domain/geographic-destination.js'
import { geographicReferenceData } from './reference-data.generated.js'

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')
}

export function searchGeographicCatalog(query: string, limit = 8): readonly GeographicDestination[] {
  const text = normalized(query)
  if (text.length < 2) return []
  return geographicReferenceData.flatMap((destination) => {
    const names = destination.names.map(normalized)
    const score = names.includes(text) ? 3 : names.some((name) => name.startsWith(text)) ? 2
      : names.some((name) => name.includes(text)) ? 1 : 0
    return score === 0 ? [] : [{ destination, score }]
  }).sort((left, right) => right.score - left.score ||
    left.destination.name.localeCompare(right.destination.name, 'ko'))
    .slice(0, Math.max(1, Math.min(20, limit))).map(({ destination }) => destination)
}
