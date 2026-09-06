import type { MapFeature } from './pixel-projection.js'

/** Preview metadata shares a response-wide point budget; every coordinate group retains at least one choice. */
export function boundMapPreviews(features: readonly MapFeature[], pointBudget: number): readonly MapFeature[] {
  let remaining = pointBudget - features.filter((feature) => feature.kind === 'place').length
  let groups = features.filter((feature) => feature.kind === 'cluster' && feature.coincidentPreview !== null).length
  return features.map((feature) => {
    if (feature.kind === 'place' || feature.coincidentPreview === null) return feature
    groups -= 1
    const places = feature.coincidentPreview.places.slice(0, Math.max(1, remaining - groups))
    remaining -= places.length
    return { ...feature, coincidentPreview: { places, remainingCount: feature.count - places.length } }
  })
}
