import type { ImportAcquisitionV1 } from '@place/contracts/transfers'

import type { SourceSnapshot } from '../data-transfer-settings-model'

export type ImportAcquisitionMethod = ImportAcquisitionV1['method']
export type ImportAcquisitionState = ImportAcquisitionV1['state']
export type ImportAcquisitionItemState = ImportAcquisitionV1['items'][number]['state']
export type ImportAcquisitionItem = ImportAcquisitionV1['items'][number] & Readonly<{
  inputLabel: string
}>
export type ImportAcquisition = Omit<ImportAcquisitionV1, 'items'> & Readonly<{
  items: readonly ImportAcquisitionItem[]
}>

export type ImportAcquisitionGateway = Readonly<{
  startSharedLinkImport(input: Readonly<{
    commandId: string
    acquisitionId: string
    importSourceId: string
    snapshotId: string
    providerKey: 'naver'
    links: readonly Readonly<{ entryId: string; position: number; url: string }>[]
  }>, signal?: AbortSignal): Promise<ImportAcquisitionV1>
  startRemoteImport(input: Readonly<{
    commandId: string
    acquisitionId: string
    importSourceId: string
    providerKey: 'naver'
  }>, signal?: AbortSignal): Promise<ImportAcquisitionV1>
  readImportAcquisition(acquisitionId: string, signal?: AbortSignal): Promise<ImportAcquisitionV1>
  readSourceSnapshot(snapshotId: string, signal?: AbortSignal): Promise<SourceSnapshot>
  cancelImportAcquisition(input: Readonly<{
    commandId: string
    acquisitionId: string
    expectedRevision: string
  }>, signal?: AbortSignal): Promise<ImportAcquisitionV1>
}>
