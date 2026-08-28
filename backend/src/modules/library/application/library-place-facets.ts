import { createHash } from 'node:crypto'

import type {
  LibraryPlaceFacet,
  LibraryPlaceFacetsPage,
  LibraryPlaceSummary,
} from '../domain/queries.js'

export const libraryFacetSampleLimit = 2_000
export const libraryFacetFilterScanLimit = 500
const facetResultLimit = 50

function displayAreaLabel(label: string): string {
  return label.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function normalizedAreaLabel(label: string): string {
  return displayAreaLabel(label).toLowerCase()
}

export function libraryAreaFacetKey(label: string): string {
  return `area_${createHash('sha256').update(normalizedAreaLabel(label)).digest('base64url').slice(0, 22)}`
}

function increment(
  facets: Map<string, Readonly<{ label: string; count: number }>>,
  key: string,
  label: string,
): void {
  const current = facets.get(key)
  facets.set(key, {
    label: current === undefined || label < current.label ? label : current.label,
    count: (current?.count ?? 0) + 1,
  })
}

function ranked(facets: ReadonlyMap<string, Readonly<{ label: string; count: number }>>) {
  return [...facets.entries()]
    .map(([key, value]): LibraryPlaceFacet => ({ key, ...value }))
    .sort((left, right) => right.count - left.count || (
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    ))
}

export function buildLibraryPlaceFacets(input: Readonly<{
  summaries: readonly LibraryPlaceSummary[]
  savedPlaceCount: number
  sampledPlaceCount: number
}>): LibraryPlaceFacetsPage {
  const uniqueSummaries = new Map(input.summaries.map((summary) => [summary.placeId, summary]))
  const areas = new Map<string, Readonly<{ label: string; count: number }>>()
  const taxonomies = new Map<string, Readonly<{ label: string; count: number }>>()
  for (const summary of uniqueSummaries.values()) {
    if (summary.areaLabel !== null) {
      increment(areas, libraryAreaFacetKey(summary.areaLabel), displayAreaLabel(summary.areaLabel))
    }
    if (summary.primaryTaxonomy !== null) {
      increment(
        taxonomies,
        summary.primaryTaxonomy.key,
        summary.primaryTaxonomy.label,
      )
    }
  }
  const rankedAreas = ranked(areas)
  const rankedTaxonomies = ranked(taxonomies)
  return {
    schemaVersion: 'library-place-facets.v1',
    sourceState: 'saved',
    coverage: {
      savedPlaceCount: input.savedPlaceCount,
      sampledPlaceCount: input.sampledPlaceCount,
      projectedPlaceCount: uniqueSummaries.size,
      complete: input.savedPlaceCount === input.sampledPlaceCount &&
        rankedAreas.length <= facetResultLimit && rankedTaxonomies.length <= facetResultLimit,
    },
    areas: rankedAreas.slice(0, facetResultLimit),
    taxonomies: rankedTaxonomies.slice(0, facetResultLimit),
  }
}

export function matchesLibraryPlaceFacets(
  summary: LibraryPlaceSummary | undefined,
  filter: Readonly<{ areaKeys: readonly string[]; taxonomyKeys: readonly string[] }>,
): boolean {
  if (filter.areaKeys.length === 0 && filter.taxonomyKeys.length === 0) return true
  if (summary === undefined) return false
  const matchesArea = filter.areaKeys.length === 0 || (
    summary.areaLabel !== null && filter.areaKeys.includes(libraryAreaFacetKey(summary.areaLabel))
  )
  const taxonomyKeys = new Set([
    ...summary.taxonomyKeys,
    ...(summary.primaryTaxonomy === null ? [] : [summary.primaryTaxonomy.key]),
  ])
  const matchesTaxonomy = filter.taxonomyKeys.length === 0 ||
    filter.taxonomyKeys.some((key) => taxonomyKeys.has(key))
  return matchesArea && matchesTaxonomy
}
