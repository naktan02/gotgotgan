import type { SharedCatalogContributionPort } from '../../modules/places/index.js'
import type { VerifiedSourcePlaceMaterializerPort } from '../../modules/transfers/index.js'

/**
 * Adds only the explicitly typed Provider facts to the shared catalog. Snapshot aliases and
 * other member-scoped capture fields remain available to the private Library path only.
 */
export function withProviderListedPlaceContribution(
  materializer: VerifiedSourcePlaceMaterializerPort,
  catalog: SharedCatalogContributionPort,
): VerifiedSourcePlaceMaterializerPort {
  return {
    async materialize(input) {
      const resolved = await materializer.materialize(input)
      const snapshot = input.snapshotEvidence
      const providerFacts = snapshot?.providerListedFacts
      if (snapshot === undefined || providerFacts === undefined) return resolved

      await catalog.contribute({
        placeId: resolved.placeId,
        providerKey: input.providerKey,
        externalPlaceId: input.providerPlaceId,
        sourceObservationId: input.sourceObservationId,
        observedAt: snapshot.observedAt,
        recordedAt: snapshot.acquiredAt,
        publicationBasis: 'provider-listed-facts',
        facts: {
          schemaVersion: 'minimum-place-facts.v1',
          name: providerFacts.name,
          address: providerFacts.address,
          location: providerFacts.location,
        },
      })
      return resolved
    },
  }
}
