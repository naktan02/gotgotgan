import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'

const NAME_KEYS = ['name:ko', 'name', 'name:nonlatin', 'name:en', 'name_en', 'name:latin']
const KOREAN_FIRST_NAME = NAME_KEYS.reduceRight<ExpressionSpecification>((fallback, key) => [
  'case', ['!=', ['coalesce', ['get', key], ''], ''], ['get', key], fallback,
], ['literal', ''])

function referencedFields(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]!)
  if (!Array.isArray(value)) return []
  if ((value[0] === 'get' || value[0] === 'has') && typeof value[1] === 'string') return [value[1]]
  return value.flatMap(referencedFields)
}

export function koreanFirstNameField<T>(field: T): T | ExpressionSpecification {
  const references = referencedFields(field)
  // Only geographic names: preserve road shields, airport codes and mixed custom labels.
  return references.length > 0 && references.every((key) => NAME_KEYS.includes(key))
    ? KOREAN_FIRST_NAME
    : field
}

export function localizePlaceMapNames(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue
    const previous = layer.layout?.['text-field']
    const localized = koreanFirstNameField(previous)
    if (localized !== previous) map.setLayoutProperty(layer.id, 'text-field', localized)
  }
}
