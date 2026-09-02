import type { ConnectorProviderKey } from '@place/contracts/connector'

import type {
  SavedPlaceTargetCapabilities,
  SavedPlaceTargetCapability,
  SavedPlaceTargetCapabilityState,
} from './ports/saved-place-target.js'

const capabilityKeys = [
  'list-target-lists',
  'create-target-list',
  'resolve-places',
  'preflight-add',
  'add-places',
  'reconcile-add',
] as const satisfies readonly SavedPlaceTargetCapability[]

function capabilityMap(
  state: SavedPlaceTargetCapabilityState,
): Readonly<Record<SavedPlaceTargetCapability, SavedPlaceTargetCapabilityState>> {
  return Object.freeze(Object.fromEntries(
    capabilityKeys.map((capability) => [capability, state]),
  )) as Readonly<Record<SavedPlaceTargetCapability, SavedPlaceTargetCapabilityState>>
}

const catalog = new Map<ConnectorProviderKey, SavedPlaceTargetCapabilities>([
  ['naver', Object.freeze({
    providerKey: 'naver',
    deliveryState: 'integration-gated',
    transport: null,
    capabilities: capabilityMap('integration-gated'),
    maximumAddItems: null,
    preservesOrder: 'unknown',
    acceptsPrivateNotes: 'unknown',
    evidence: Object.freeze({
      kind: 'research-required',
      summary: 'No verified public saved-list write contract or outbound adapter is available.',
    }),
  })],
  ['google', Object.freeze({
    providerKey: 'google',
    deliveryState: 'unavailable',
    transport: null,
    capabilities: capabilityMap('unavailable'),
    maximumAddItems: null,
    preservesOrder: 'unknown',
    acceptsPrivateNotes: 'unknown',
    evidence: Object.freeze({
      kind: 'public-api-unavailable',
      summary: 'The Connector has no verified Google saved-list write contract or adapter.',
    }),
  })],
  ['kakao', Object.freeze({
    providerKey: 'kakao',
    deliveryState: 'unavailable',
    transport: null,
    capabilities: capabilityMap('unavailable'),
    maximumAddItems: null,
    preservesOrder: 'unknown',
    acceptsPrivateNotes: 'unknown',
    evidence: Object.freeze({
      kind: 'public-api-unavailable',
      summary: 'The Connector has no verified Kakao saved-list write contract or adapter.',
    }),
  })],
])

export function readSavedPlaceTargetCapabilities(
  providerKey: ConnectorProviderKey,
): SavedPlaceTargetCapabilities {
  return catalog.get(providerKey)!
}

export function listSavedPlaceTargetCapabilities(): readonly SavedPlaceTargetCapabilities[] {
  return [...catalog.values()]
}
