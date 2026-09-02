import type {
  DiscoverableCollection,
  DiscoverableCollectionQuery,
  PublicCollectionDiscoveryPage,
  PublicCollectionDiscoveryQuery,
} from '../../domain/public-collection-discovery.js'

/** Anonymous, moderation-aware directory; unlisted Collections never enter this boundary. */
export interface PublicCollectionDiscovery {
  list(query: PublicCollectionDiscoveryQuery): Promise<PublicCollectionDiscoveryPage>
  get(query: DiscoverableCollectionQuery): Promise<DiscoverableCollection | undefined>
}
