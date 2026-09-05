import { problemSchema } from '@place/contracts/http'
import {
  importAcquisitionCommandResultV1Schema,
  importAcquisitionV1Schema,
  sourceSnapshotDetailV3Schema,
  type ImportAcquisitionV1,
} from '@place/contracts/transfers'

import type { SourceSnapshot } from '../data-transfer-settings-model'
import { DataTransferSettingsProblem } from '../data-transfer-settings-model'
import type { ImportAcquisitionGateway } from './import-acquisition-model'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function responseValue(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

function failure(response: Response, value: unknown): DataTransferSettingsProblem {
  const parsed = problemSchema.safeParse(value)
  return new DataTransferSettingsProblem(response.status || 503, parsed.success ? parsed.data.code : undefined)
}

function safeInteraction(acquisition: ImportAcquisitionV1): ImportAcquisitionV1 {
  const currentInteraction = acquisition.interaction
  if (currentInteraction === undefined || currentInteraction.launchUrl === undefined) return acquisition
  const launchUrl = currentInteraction.launchUrl
  try {
    if (!launchUrl.startsWith('/') || launchUrl.startsWith('//')) throw new Error('external launch URL')
    const parsed = new URL(launchUrl, 'https://place.invalid')
    if (parsed.origin !== 'https://place.invalid') throw new Error('external launch URL')
    const safeLaunchUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`
    return { ...acquisition, interaction: { ...currentInteraction, launchUrl: safeLaunchUrl } }
  } catch {
    const { launchUrl: _, ...interaction } = currentInteraction
    return {
      ...acquisition,
      interaction,
    }
  }
}

async function getAcquisition(fetcher: typeof fetch, path: string, signal?: AbortSignal) {
  const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin', signal })
  const value = await responseValue(response)
  if (!response.ok) throw failure(response, value)
  const parsed = importAcquisitionV1Schema.safeParse(value)
  if (!parsed.success) throw new DataTransferSettingsProblem(503)
  return safeInteraction(parsed.data)
}

async function startAcquisition(fetcher: typeof fetch, body: unknown, signal?: AbortSignal) {
  const response = await fetcher('/api/v1/transfers/import-acquisitions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(body), signal,
  })
  const value = await responseValue(response)
  const parsed = importAcquisitionCommandResultV1Schema.safeParse(value)
  if (!parsed.success) {
    if (!response.ok) throw failure(response, value)
    throw new DataTransferSettingsProblem(503)
  }
  if (parsed.data.outcome === 'rejected') throw new DataTransferSettingsProblem(response.status || 409, parsed.data.rejection.code)
  return safeInteraction(parsed.data.acquisition)
}

async function readSourceSnapshot(fetcher: typeof fetch, snapshotId: string, signal?: AbortSignal): Promise<SourceSnapshot> {
  if (!uuidPattern.test(snapshotId)) throw new DataTransferSettingsProblem(400)
  const response = await fetcher(`/api/v3/transfers/source-snapshots/${encodeURIComponent(snapshotId)}`, {
    cache: 'no-store', credentials: 'same-origin', signal,
  })
  const value = await responseValue(response)
  if (!response.ok) throw failure(response, value)
  const parsed = sourceSnapshotDetailV3Schema.safeParse(value)
  if (!parsed.success) throw new DataTransferSettingsProblem(503)
  const snapshot = parsed.data
  return {
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.snapshotVersion,
    providerKey: snapshot.providerKey,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    totalListCount: snapshot.listCount,
    totalItemCount: snapshot.itemCount,
    hasUnloadedLists: snapshot.lists.length < snapshot.listCount,
    lists: snapshot.lists.map((list) => ({
      sourceListId: list.sourceListId,
      name: list.observedName,
      itemCount: list.itemCount,
      unresolvedItemCount: list.unresolvedItemCount,
    })),
  }
}

export function createImportAcquisitionGateway(fetcher: typeof fetch = fetch): ImportAcquisitionGateway {
  return {
    startSharedLinkImport(input, signal) {
      return startAcquisition(fetcher, {
        schemaVersion: 'start-import-acquisition.v1',
        kind: 'shared-links',
        ...input,
      }, signal)
    },
    startRemoteImport(input, signal) {
      return startAcquisition(fetcher, {
        schemaVersion: 'start-import-acquisition.v1',
        kind: 'remote-browser',
        ...input,
      }, signal)
    },
    readImportAcquisition(acquisitionId, signal) {
      if (!uuidPattern.test(acquisitionId)) return Promise.reject(new DataTransferSettingsProblem(400))
      return getAcquisition(fetcher, `/api/v1/transfers/import-acquisitions/${encodeURIComponent(acquisitionId)}`, signal)
    },
    readSourceSnapshot(snapshotId, signal) {
      return readSourceSnapshot(fetcher, snapshotId, signal)
    },
    async cancelImportAcquisition(input, signal) {
      const response = await fetcher('/api/v1/transfers/import-acquisition-commands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        cache: 'no-store', credentials: 'same-origin', signal,
        body: JSON.stringify({
          schemaVersion: 'import-acquisition-command.v1',
          commandId: input.commandId,
          kind: 'cancel',
          acquisitionId: input.acquisitionId,
          expectedAcquisitionRevision: input.expectedRevision,
        }),
      })
      const value = await responseValue(response)
      const parsed = importAcquisitionCommandResultV1Schema.safeParse(value)
      if (!parsed.success) {
        if (!response.ok) throw failure(response, value)
        throw new DataTransferSettingsProblem(503)
      }
      if (parsed.data.outcome === 'rejected') throw new DataTransferSettingsProblem(409, parsed.data.rejection.code)
      return safeInteraction(parsed.data.acquisition)
    },
  }
}

export const importAcquisitionGateway = createImportAcquisitionGateway()
