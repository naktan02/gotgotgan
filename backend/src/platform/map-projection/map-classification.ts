import type { MapFeature, MapPoint, MapTaxonomy } from './pixel-projection.js'

export type MapTaxonomyReader = () => Promise<readonly Readonly<MapTaxonomy & { parentKey: string | null }>[]>

/** Only registered canonical keys are followed; neither key punctuation nor provider labels imply ancestry. */
export async function classifyMapFeatures(features: readonly MapFeature[], read?: MapTaxonomyReader): Promise<readonly MapFeature[]> {
  if (read === undefined) return features
  const nodes = new Map((await read()).map((node) => [node.key, node]))
  function classify(point: MapPoint): MapPoint {
    if (point.classification === null) return point
    let node = nodes.get(point.classification.primaryTaxonomy.key)
    const visited = new Set<string>()
    while (node !== undefined && node.parentKey !== null && !visited.has(node.key)) {
      visited.add(node.key)
      node = nodes.get(node.parentKey)
    }
    return { ...point, classification: { ...point.classification,
      rootTaxonomy: node?.parentKey === null ? { key: node.key, label: node.label } : null } }
  }
  return features.map((feature) => feature.kind === 'place' ? classify(feature) : feature.coincidentPreview === null
    ? feature : { ...feature, coincidentPreview: { ...feature.coincidentPreview, places: feature.coincidentPreview.places.map(classify) } })
}
