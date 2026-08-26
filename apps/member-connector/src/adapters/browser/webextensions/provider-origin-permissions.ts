import type { ConnectorProviderKey } from '@place/contracts/connector'

type OriginPermissionApi = Readonly<{
  contains(permission: Readonly<{ origins: string[] }>): Promise<boolean>
  request(permission: Readonly<{ origins: string[] }>): Promise<boolean>
}>

const providerOrigins = new Map<ConnectorProviderKey, string>([
  ['naver', 'https://pages.map.naver.com/*'],
])

function permission(providerKey: ConnectorProviderKey): Readonly<{ origins: string[] }> {
  const origin = providerOrigins.get(providerKey)
  if (origin === undefined) throw new Error(`Unsupported provider permission: ${providerKey}`)
  return { origins: [origin] }
}

export function providerPermissionOrigin(providerKey: ConnectorProviderKey): string {
  return permission(providerKey).origins[0]!
}

export async function hasProviderOriginPermission(
  api: OriginPermissionApi,
  providerKey: ConnectorProviderKey,
): Promise<boolean> {
  return api.contains(permission(providerKey))
}

export async function requestProviderOriginPermission(
  api: OriginPermissionApi,
  providerKey: ConnectorProviderKey,
): Promise<boolean> {
  return api.request(permission(providerKey))
}
