import type {
  CatalogAreaVocabularyNode,
  CatalogTaxonomyVocabularyNode,
} from '../../domain/catalog-home-search.js'

export interface CatalogSearchVocabulary {
  listAreas(): Promise<readonly CatalogAreaVocabularyNode[]>
  listTaxonomies(): Promise<readonly CatalogTaxonomyVocabularyNode[]>
}
