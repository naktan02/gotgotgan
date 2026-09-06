import {
  startImportAcquisitionV1Schema,
  type ImportAcquisitionCapabilitiesV2,
  type StartImportAcquisitionResultV2,
  type StartImportAcquisitionV2,
} from '@place/contracts/transfers'

import type { ImportAcquisitions } from '../domain/acquisitions.js'

type Availability = ImportAcquisitionCapabilitiesV2['providers'][number]['methods'][number]['availability']

/** Product capability is separate from a provider enum and from diagnostic remote flags. */
export function createProviderImportAcquisitions(acquisitions?: ImportAcquisitions) {
  function availability(provider: StartImportAcquisitionV2['providerKey'], method: StartImportAcquisitionV2['kind']): Availability {
    if (method === 'remote-browser') {
      return { status: 'not-implemented', reason: 'remote-browser-integration-gated' }
    }
    if (provider !== 'naver') {
      return { status: 'not-implemented', reason: 'provider-adapter-unavailable' }
    }
    return acquisitions === undefined
      ? { status: 'configuration-required', reason: 'runtime-disabled' }
      : { status: 'available' }
  }

  return {
    capabilities(): ImportAcquisitionCapabilitiesV2 {
      return {
        schemaVersion: 'import-acquisition-capabilities.v2',
        providers: (['naver', 'google', 'kakao'] as const).map((providerKey) => ({
          providerKey,
          methods: (['shared-links', 'remote-browser'] as const).map((method) => ({
            method, availability: availability(providerKey, method),
          })),
        })),
      }
    },
    async start(memberId: string, command: StartImportAcquisitionV2): Promise<StartImportAcquisitionResultV2> {
      const capability = availability(command.providerKey, command.kind)
      if (capability.status !== 'available') {
        return {
          schemaVersion: 'start-import-acquisition-result.v2',
          outcome: 'rejected', commandId: command.commandId,
          rejection: { code: 'capability-unavailable', availability: capability },
        }
      }
      // The sole implemented adapter consumes the frozen NAVER command. Keeping that
      // envelope preserves encrypted queued artifacts and command replay across deploys.
      if (acquisitions === undefined) throw new Error('acquisition runtime is unavailable')
      const naverCommand = startImportAcquisitionV1Schema.parse({
        ...command, schemaVersion: 'start-import-acquisition.v1',
      })
      const result = await acquisitions.start(memberId, naverCommand)
      return { ...result, schemaVersion: 'start-import-acquisition-result.v2' }
    },
  }
}
