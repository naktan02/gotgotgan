import type {
  ImportAcquisitionCommandResultV1,
  ImportAcquisitionV1,
} from '@place/contracts/transfers'

export type AcquisitionRejection = Extract<
  ImportAcquisitionCommandResultV1,
  { outcome: 'rejected' }
>['rejection']['code']

export function accepted(
  commandId: string,
  status: 'applied' | 'replayed',
  acquisition: ImportAcquisitionV1,
): ImportAcquisitionCommandResultV1 {
  return {
    schemaVersion: 'import-acquisition-command-result.v1',
    outcome: 'accepted', commandId, status, acquisition,
  }
}

export function rejected(
  commandId: string,
  code: AcquisitionRejection,
): ImportAcquisitionCommandResultV1 {
  return {
    schemaVersion: 'import-acquisition-command-result.v1',
    outcome: 'rejected', commandId, rejection: { code },
  }
}
