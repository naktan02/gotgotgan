import { describe, expect, it } from 'vitest'

import {
  importAcquisitionCommandResultV1Schema,
  importAcquisitionV1Schema,
  startImportAcquisitionV1Schema,
} from '../src/transfers/index.js'
import { buildOpenApiDocument } from '../src/http/openapi.js'

const ids = Array.from({ length: 30 }, (_, index) => (
  `01992d55-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
))

describe('one-shot import acquisition contracts', () => {
  it('accepts a bounded multi-link command and rejects duplicate entry identities', () => {
    const command = {
      schemaVersion: 'start-import-acquisition.v1',
      kind: 'shared-links',
      commandId: ids[0],
      acquisitionId: ids[1],
      importSourceId: ids[2],
      snapshotId: ids[3],
      providerKey: 'naver',
      links: [
        { entryId: ids[4], position: 0, url: 'https://naver.me/AbCd1234' },
        { entryId: ids[5], position: 1, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share-1' },
      ],
    }
    expect(startImportAcquisitionV1Schema.safeParse(command).success).toBe(true)
    expect(startImportAcquisitionV1Schema.safeParse({
      ...command,
      links: [command.links[0], { ...command.links[1], entryId: ids[4] }],
    }).success).toBe(false)
    expect(startImportAcquisitionV1Schema.safeParse({
      ...command,
      links: Array.from({ length: 21 }, (_, index) => ({
        entryId: ids[index + 4], position: index, url: `https://naver.me/link-${index}`,
      })),
    }).success).toBe(false)
  })

  it('represents partial success without exposing input URLs or account identity', () => {
    const acquisition = {
      schemaVersion: 'import-acquisition.v1',
      acquisitionId: ids[1],
      acquisitionRevision: 'import-acquisition-revision.v1.value',
      importSourceId: ids[2],
      providerKey: 'naver',
      method: 'shared-links',
      state: 'partial',
      items: [{
        entryId: ids[4], position: 0, state: 'ready', sourceListId: 'share-1',
        name: '서울 카페', itemCount: 12,
      }, {
        entryId: ids[5], position: 1, state: 'invalid',
        failure: { code: 'unsupported-host', retryable: false },
      }],
      progress: { total: 2, processed: 2, ready: 1, failed: 1 },
      snapshot: { snapshotId: ids[3], snapshotVersion: 'source-snapshot-revision.v3.value' },
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:01.000Z',
    }
    expect(importAcquisitionV1Schema.safeParse(acquisition).success).toBe(true)
    expect(importAcquisitionV1Schema.safeParse({
      ...acquisition,
      items: [{ ...acquisition.items[0], url: 'https://naver.me/secret' }],
    }).success).toBe(false)
    expect(importAcquisitionCommandResultV1Schema.safeParse({
      schemaVersion: 'import-acquisition-command-result.v1',
      outcome: 'accepted',
      commandId: ids[0],
      status: 'applied',
      acquisition,
    }).success).toBe(true)
  })

  it('keeps remote browser startup separate and account-unverified', () => {
    expect(startImportAcquisitionV1Schema.safeParse({
      schemaVersion: 'start-import-acquisition.v1',
      kind: 'remote-browser',
      commandId: ids[0],
      acquisitionId: ids[1],
      importSourceId: ids[2],
      providerKey: 'naver',
    }).success).toBe(true)
    expect(startImportAcquisitionV1Schema.safeParse({
      schemaVersion: 'start-import-acquisition.v1',
      kind: 'remote-browser',
      commandId: ids[0],
      acquisitionId: ids[1],
      importSourceId: ids[2],
      providerKey: 'naver',
      connectionId: ids[3],
    }).success).toBe(false)
  })

  it('represents the member in-flight batch limit as a versioned rejection', () => {
    expect(importAcquisitionCommandResultV1Schema.safeParse({
      schemaVersion: 'import-acquisition-command-result.v1',
      outcome: 'rejected',
      commandId: ids[0],
      rejection: { code: 'limit-exceeded' },
    }).success).toBe(true)
  })

  it('publishes the in-flight batch rejection on the start route', () => {
    const openApi = buildOpenApiDocument() as Readonly<{
      paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    }>
    const start = openApi.paths['/v1/transfers/import-acquisitions']?.post as
      Readonly<{ responses?: Readonly<Record<string, unknown>> }> | undefined

    expect(start?.responses?.['429']).toBeDefined()
  })
})
