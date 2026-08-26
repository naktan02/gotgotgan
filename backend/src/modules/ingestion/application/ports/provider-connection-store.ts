import type { ProviderConnectionProjection } from '../../domain/imports.js'

export type ProviderConnectionRegistration = Readonly<{
  connectionId: string
  memberId: string
  providerKey: 'naver' | 'kakao' | 'google'
  label: string
  secretReference?: string
  profileReference?: string
  registeredAt: string
}>

export interface ProviderConnectionStore {
  registerConnection(command: ProviderConnectionRegistration): Promise<'registered' | 'replayed' | 'conflict'>
  listConnections(memberId: string): Promise<readonly ProviderConnectionProjection[]>
}
