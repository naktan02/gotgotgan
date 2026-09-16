import reference from './korea-reference-data.generated.json' with { type: 'json' }
import type { GeographicDestination } from '../../domain/geographic-destination.js'

export const koreanGeographicReferenceData = reference.destinations as readonly GeographicDestination[]
