export const familyNavigationDeliveryStates = [
  'active',
  'integration-gated',
  'source-only',
  'not-integrated',
] as const

export type FamilyNavigationItem = Readonly<{
  serviceId: string
  label: string
  href: string
}>

export type FamilyNavigation = Readonly<{
  contract: 'family-navigation.v1'
  deliveryState: (typeof familyNavigationDeliveryStates)[number]
  items: readonly FamilyNavigationItem[]
}>

export const unavailableFamilyNavigation: FamilyNavigation = {
  contract: 'family-navigation.v1',
  deliveryState: 'not-integrated',
  items: [],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function parseItem(value: unknown): FamilyNavigationItem {
  if (!isObject(value)) throw new Error('Family navigation item must be an object.')
  if (!hasOnlyKeys(value, ['serviceId', 'label', 'href'])) {
    throw new Error('Family navigation item contains an unsupported field.')
  }
  const { serviceId, label, href } = value
  if (typeof serviceId !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(serviceId)) {
    throw new Error('Family navigation serviceId is invalid.')
  }
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('Family navigation label is invalid.')
  }
  if (typeof href !== 'string') throw new Error('Family navigation href is invalid.')
  const destination = new URL(href)
  if (
    destination.protocol !== 'https:' ||
    destination.username !== '' ||
    destination.password !== '' ||
    destination.hash !== ''
  ) {
    throw new Error('Family navigation href must be a credential-free public HTTPS URL.')
  }
  return { serviceId, label, href: destination.toString() }
}

export function parseFamilyNavigation(value: unknown): FamilyNavigation {
  if (!isObject(value)) throw new Error('Family navigation manifest must be an object.')
  if (!hasOnlyKeys(value, ['contract', 'deliveryState', 'items'])) {
    throw new Error('Family navigation manifest contains an unsupported field.')
  }
  if (value.contract !== 'family-navigation.v1') {
    throw new Error('Unsupported family navigation contract.')
  }
  if (
    typeof value.deliveryState !== 'string' ||
    !familyNavigationDeliveryStates.includes(
      value.deliveryState as (typeof familyNavigationDeliveryStates)[number],
    )
  ) {
    throw new Error('Family navigation deliveryState is invalid.')
  }
  const deliveryState = value.deliveryState as FamilyNavigation['deliveryState']
  if (!Array.isArray(value.items)) throw new Error('Family navigation items must be an array.')
  if (deliveryState !== 'active' && value.items.length > 0) {
    throw new Error('Only an active family navigation manifest may contain destinations.')
  }
  const items = value.items.map(parseItem)
  if (new Set(items.map((item) => item.serviceId)).size !== items.length) {
    throw new Error('Family navigation serviceId values must be unique.')
  }
  return {
    contract: 'family-navigation.v1',
    deliveryState,
    items,
  }
}

export function readFamilyNavigation(serialized: string | undefined): FamilyNavigation {
  if (serialized === undefined || serialized.trim() === '') return unavailableFamilyNavigation
  try {
    return parseFamilyNavigation(JSON.parse(serialized))
  } catch {
    return { ...unavailableFamilyNavigation, deliveryState: 'integration-gated' }
  }
}
