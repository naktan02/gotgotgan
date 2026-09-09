import type {
  CurrentMinimumPlace,
  MinimumPlacePublication,
} from '../../domain/minimum-place-facts.js'

export type SharedCatalogContributionResult = Readonly<{
  status: 'published' | 'existing'
  current: CurrentMinimumPlace
}>

/** Publishes share-eligible facts to the common catalog and its search projection. */
export interface SharedCatalogContributionPort {
  contribute(input: MinimumPlacePublication): Promise<SharedCatalogContributionResult>
}
