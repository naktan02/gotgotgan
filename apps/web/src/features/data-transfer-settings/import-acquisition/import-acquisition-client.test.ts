import { describe, expect, it, vi } from 'vitest'

import { createImportAcquisitionGateway } from './import-acquisition-client'
import { DataTransferSettingsProblem } from '../data-transfer-settings-model'
import {
  importAcquisitionFailureMessage,
  sharedLinkLines,
} from './import-acquisition-workflow'

const acquisitionId = '01992d20-0000-7000-8000-000000000091'
const importSourceId = '01992d20-0000-7000-8000-000000000092'
const snapshotId = '01992d20-0000-7000-8000-000000000093'
const readyEntryId = '01992d20-0000-7000-8000-000000000094'
const duplicateEntryId = '01992d20-0000-7000-8000-000000000095'

function acquisition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'import-acquisition.v1',
    acquisitionId,
    acquisitionRevision: 'acquisition-r1',
    importSourceId,
    providerKey: 'naver',
    method: 'shared-links',
    state: 'partial',
    items: [
      { entryId: readyEntryId, position: 0, state: 'ready', sourceListId: 'list-1', name: '주말 산책', itemCount: 12 },
      { entryId: duplicateEntryId, position: 1, state: 'duplicate', duplicateOfEntryId: readyEntryId },
    ],
    progress: { total: 2, processed: 2, ready: 1, failed: 1 },
    snapshot: { snapshotId, snapshotVersion: 'snapshot-r1' },
    createdAt: '2026-09-05T01:00:00.000Z',
    updatedAt: '2026-09-05T01:00:01.000Z',
    ...overrides,
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function accepted(value: unknown) {
  return {
    schemaVersion: 'import-acquisition-command-result.v1', outcome: 'accepted',
    commandId: '01992d20-0000-7000-8000-000000000096', status: 'applied', acquisition: value,
  }
}

describe('one-shot import acquisition client', () => {
  it('submits the versioned shared-link command without browser credentials', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(accepted(acquisition())))
    const gateway = createImportAcquisitionGateway(fetchMock as unknown as typeof fetch)

    const result = await gateway.startSharedLinkImport({
      commandId: '01992d20-0000-7000-8000-000000000096',
      acquisitionId,
      importSourceId,
      snapshotId,
      providerKey: 'naver',
      links: [
        { entryId: readyEntryId, position: 0, url: 'https://naver.me/ready' },
        { entryId: duplicateEntryId, position: 1, url: 'https://naver.me/ready' },
      ],
    })

    expect(result.state).toBe('partial')
    expect(result.items.map((item) => item.state)).toEqual(['ready', 'duplicate'])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/transfers/import-acquisitions', expect.objectContaining({
      cache: 'no-store', credentials: 'same-origin', method: 'POST',
    }))
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      schemaVersion: 'start-import-acquisition.v1', kind: 'shared-links',
      acquisitionId, importSourceId, snapshotId, providerKey: 'naver',
      links: [
        { entryId: readyEntryId, position: 0, url: 'https://naver.me/ready' },
        { entryId: duplicateEntryId, position: 1, url: 'https://naver.me/ready' },
      ],
    })
    expect(JSON.stringify(body)).not.toMatch(/cookie|password|credential/i)
  })

  it('drops a remote interaction URL that is not same-origin', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(accepted(acquisition({
      method: 'remote-browser', state: 'processing', items: [],
      progress: { total: 0, processed: 0, ready: 0, failed: 0 }, snapshot: undefined,
      interaction: { state: 'ready', launchUrl: 'https://attacker.example/login' },
    }))))
    const result = await createImportAcquisitionGateway(fetchMock as unknown as typeof fetch).startRemoteImport({
      commandId: '01992d20-0000-7000-8000-000000000097', acquisitionId, importSourceId, providerKey: 'naver',
    })

    expect(result.interaction?.launchUrl).toBeUndefined()
  })

  it('reads the v3 one-shot snapshot without inventing a connection identity', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      schemaVersion: 'source-snapshot-detail.v3', snapshotId, snapshotVersion: 'snapshot-r1',
      source: { kind: 'one-shot', importSourceId, acquisitionMethod: 'shared-link', authorizationBasis: 'link-possession', accountAssurance: 'unverified' },
      providerKey: 'naver', sourceRevision: 'source-r1', listCount: 1, itemCount: 12, unresolvedItemCount: 0,
      observedAt: '2026-09-05T01:00:01.000Z', capturedAt: '2026-09-05T01:00:02.000Z',
      lists: [{
        sourceListId: 'list-1', observedName: '주말 산책', sourcePosition: 0, itemCount: 12, unresolvedItemCount: 0,
        items: [],
      }],
    }))

    const result = await createImportAcquisitionGateway(fetchMock as unknown as typeof fetch).readSourceSnapshot(snapshotId)

    expect(result.source).toEqual({
      kind: 'one-shot', importSourceId, acquisitionMethod: 'shared-link',
      authorizationBasis: 'link-possession', accountAssurance: 'unverified',
    })
    expect(result).not.toHaveProperty('connectionId')
  })

  it('preserves pasted line order so the server can report duplicates per entry', () => {
    expect(sharedLinkLines(' https://naver.me/a \n\nhttps://naver.me/a\r\nhttps://naver.me/b ')).toEqual([
      'https://naver.me/a', 'https://naver.me/a', 'https://naver.me/b',
    ])
  })

  it('distinguishes a member active-batch limit from a NAVER rate limit', () => {
    expect(importAcquisitionFailureMessage(new DataTransferSettingsProblem(429, 'limit-exceeded')))
      .toContain('가져오기 대기열이 가득')
    expect(importAcquisitionFailureMessage(new DataTransferSettingsProblem(429, 'provider-rate-limited')))
      .toContain('NAVER 요청이 잠시 제한')
    expect(importAcquisitionFailureMessage(new DataTransferSettingsProblem(422, 'not-cancellable')))
      .toContain('이미 목록 확인이 시작')
  })
})
