import type { Pool } from 'pg'
import {
  PostgresMinimumPlaceCatalog,
  type MinimumPlacePublication,
  type SharedCatalogContributionPort,
} from '../../modules/places/index.js'
import { PostgresCanonicalCatalogProjection } from '../../modules/search/index.js'

export function createMinimumPlacePublication(pool: Pool) {
  const catalog = new PostgresMinimumPlaceCatalog(pool)
  const projection = new PostgresCanonicalCatalogProjection(pool)
  const contribute: SharedCatalogContributionPort['contribute'] = async (input) => {
    const result = await catalog.publish(input)
    // A failure is retryable: the immutable profile survives; replay repairs only the index.
    await projection.project(result.current)
    return result
  }
  return {
    catalog,
    contribute,
    /** Compatibility alias for callers that still use the publication vocabulary. */
    publish: (input: MinimumPlacePublication) => contribute(input),
    async rebuild() {
      let after = '0'
      let projected = 0
      let skipped = 0
      for (;;) {
        const changes = await catalog.changes(after)
        if (changes.length === 0) return { projected, skipped, afterSequence: after }
        const profiles = await catalog.read([...new Set(changes.map((change) => change.placeId))])
        for (const profile of profiles) {
          if (await projection.project(profile) === 'projected') projected += 1
          else skipped += 1
        }
        after = changes.at(-1)!.sequence
      }
    },
  }
}
