import type { LibraryPlaceSummary } from '../../modules/library/index.js'
import type { PostgresMinimumPlaceCatalog } from '../../modules/places/index.js'
import type { PostgresLocalSearch } from '../../modules/search/index.js'
import type { PostgresTaxonomyStore } from '../../modules/taxonomy/index.js'

/** Library reads current venue facts even while its derived search index is being repaired. */
export function createCanonicalLibrarySummaryReader(
  catalog: PostgresMinimumPlaceCatalog,
  search: PostgresLocalSearch,
  taxonomy: PostgresTaxonomyStore,
) {
  return async (placeIds: readonly string[]): Promise<readonly LibraryPlaceSummary[]> => {
    const [profiles, documents] = await Promise.all([catalog.read(placeIds), search.getCatalogPlaceDocuments(placeIds)])
    const primaryReferences = [...new Map(profiles.flatMap((profile) => profile.taxonomyReferences
      .filter((reference) => reference.role === 'primary')
      .map((reference) => [`${reference.key}:${reference.version}`, reference] as const))).values()]
    const nodes = new Map<string, Readonly<{ key: string; label: string }>>()
    for (let offset = 0; offset < primaryReferences.length; offset += 256) {
      for (const node of await taxonomy.readVersions(primaryReferences.slice(offset, offset + 256))) {
        nodes.set(`${node.key}:${node.version}`, { key: node.key, label: node.label })
      }
    }
    const result = new Map<string, LibraryPlaceSummary>(documents.map((document) => [document.placeId, {
      placeId: document.placeId, name: document.name, areaLabel: document.area?.label ?? null,
      location: document.location, primaryTaxonomy: document.primaryTaxonomy,
      taxonomyKeys: document.taxonomyReferences.map((reference) => reference.key),
      evidence: { status: document.evidenceStatus, projectedAt: document.projectedAt },
    }]))
    for (const profile of profiles) {
      const indexed = result.get(profile.placeId)
      const primary = profile.taxonomyReferences.find((reference) => reference.role === 'primary')
      result.set(profile.placeId, {
        placeId: profile.placeId, name: profile.name, location: profile.location,
        areaLabel: indexed?.areaLabel ?? null,
        primaryTaxonomy: primary === undefined ? null : nodes.get(`${primary.key}:${primary.version}`) ?? null,
        taxonomyKeys: profile.taxonomyReferences.map((reference) => reference.key),
        evidence: { status: indexed?.evidence.status ?? 'unverified', projectedAt: profile.publishedAt },
      })
    }
    return [...result.values()]
  }
}
