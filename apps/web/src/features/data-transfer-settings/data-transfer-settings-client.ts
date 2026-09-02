import { problemSchema } from '@place/contracts/http'
import { personalLibraryWorkspaceResponseV2Schema } from '@place/contracts/library'
import {
  importPlanCommandResultV2Schema,
  outboundTransferCommandResultV2Schema,
  providerCapabilityListV2Schema,
  providerConnectionCommandResultV2Schema,
  providerConnectionListV2Schema,
  providerTargetListProjectionV2Schema,
  sourceSnapshotDetailV2Schema,
  sourceSnapshotListV2Schema,
  type ImportPlanV2,
  type OutboundTransferV2,
} from '@place/contracts/transfers'

import type {
  DataTransferSettingsGateway,
  ImportMapping,
  ProviderCapability,
  SourceSnapshot,
  TransferProviderKey,
} from './data-transfer-settings-model'
import { DataTransferSettingsProblem } from './data-transfer-settings-model'

async function responseValue(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

function failure(response: Response, value: unknown): DataTransferSettingsProblem {
  const parsed = problemSchema.safeParse(value)
  return new DataTransferSettingsProblem(response.status || 503, parsed.success ? parsed.data.code : undefined)
}

async function get<T>(
  fetcher: typeof fetch,
  path: string,
  parse: (value: unknown) => Readonly<{ success: boolean; data?: T }>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetcher(path, { cache: 'no-store', signal })
  const value = await responseValue(response)
  if (!response.ok) throw failure(response, value)
  const parsed = parse(value)
  if (!parsed.success || parsed.data === undefined) throw new DataTransferSettingsProblem(503)
  return parsed.data
}

async function post<T>(
  fetcher: typeof fetch,
  path: string,
  body: unknown,
  parse: (value: unknown) => Readonly<{ success: boolean; data?: T }>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetcher(path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  const value = await responseValue(response)
  const parsed = parse(value)
  if (parsed.success && parsed.data !== undefined) return parsed.data
  if (!response.ok) throw failure(response, value)
  throw new DataTransferSettingsProblem(503)
}

function rejection(code: string): DataTransferSettingsProblem {
  if (code === 'not-found') return new DataTransferSettingsProblem(404, code)
  if (code === 'invalid-selection' || code === 'connection-not-ready' || code === 'target-unavailable' || code === 'not-approvable') {
    return new DataTransferSettingsProblem(422, code)
  }
  return new DataTransferSettingsProblem(409, code)
}

function availability(
  value: Readonly<{ availability: 'available' | 'integration-gated' | 'unavailable'; reason?: string }>,
  operation: 'import' | 'export',
): ProviderCapability['import'] {
  if (value.availability === 'available') return { state: 'available', label: '사용 가능' }
  if (value.availability === 'integration-gated') return {
    state: 'integration-gated', label: '연동 준비 중',
    reason: '운영자가 제공자 연동을 활성화한 뒤 사용할 수 있습니다.',
    alternative: operation === 'export' ? '지금은 공개 링크로 컬렉션을 공유할 수 있습니다.' : '지원되는 파일 가져오기 경로가 열리면 안내합니다.',
  }
  const adapter = operation === 'import' ? '가져오기 어댑터' : '내보내기 어댑터'
  return {
    state: 'unavailable',
    label: '현재 미지원',
    reason: `${adapter}가 준비되지 않았습니다.`,
    alternative: operation === 'import'
      ? '공식 내보내기 파일 지원은 별도 기능으로 제공될 때 안내합니다.'
      : '컬렉션 링크 공유는 공개 프로필에서 이용할 수 있습니다.',
  }
}

function approvalReason(reason: ImportPlanV2['approval']['reason']): string | undefined {
  if (reason === 'unresolved-places') return '매칭되지 않은 장소가 있어 승인할 수 없습니다.'
  if (reason === 'already-decided') return '이미 승인되었거나 종료된 가져오기입니다.'
  if (reason === 'materialization-rejected') return '대상 컬렉션 변경을 적용할 수 없습니다.'
  return undefined
}

function outboundReason(reason: OutboundTransferV2['approval']['reason']): string | undefined {
  if (reason === 'target-adapter-unavailable') return '대상 서비스의 내보내기 어댑터가 준비되지 않았습니다.'
  if (reason === 'connection-not-ready') return '대상 계정을 다시 인증해 주세요.'
  if (reason === 'already-decided') return '이미 승인되었거나 종료된 내보내기입니다.'
  if (reason === 'apply-failed') return '이전 적용이 실패했습니다. 작업 내역에서 확인해 주세요.'
  if (reason === 'preview-has-unresolved-items') return '미해결·미지원 장소가 있어 먼저 검토해야 합니다.'
  return undefined
}

function selectedMappings(mappings: readonly ImportMapping[]) {
  return mappings.filter((mapping) => mapping.selected).map((mapping) => ({
    sourceListId: mapping.sourceListId,
    target: mapping.target,
  }))
}

export function createDataTransferSettingsGateway(fetcher: typeof fetch = fetch): DataTransferSettingsGateway {
  const connectionAuthMethods = new Map<TransferProviderKey, 'browser-session' | 'managed-profile' | 'oauth' | 'account-export' | 'manual-file'>()
  const importMappings = new Map<string, readonly ImportMapping[]>()

  function importPreview(plan: ImportPlanV2, mappings: readonly ImportMapping[]) {
    const summary = plan.mappings.reduce((total, mapping) => ({
      add: total.add + mapping.preview.addCount,
      alreadyPresent: total.alreadyPresent + mapping.preview.alreadyPresentCount,
      reviewRequired: total.reviewRequired + mapping.preview.unresolvedCount,
      unsupported: total.unsupported + mapping.preview.skippedCount,
    }), { add: 0, alreadyPresent: 0, reviewRequired: 0, unsupported: 0 })
    return {
      planId: plan.planId, planRevision: plan.planRevision,
      snapshotId: plan.snapshotId, snapshotRevision: plan.snapshotVersion,
      mappings,
      summary,
      matches: plan.mappings.flatMap((mapping) => mapping.preview.items.map((item) => ({
        sourceListId: mapping.sourceListId,
        sourceItemId: item.sourceItemId,
        sourceName: item.observedName,
        sourceAddress: item.observedAddress,
        sourceListName: mapping.observedName,
        status: item.status === 'unresolved' ? 'review-required' as const : item.status,
        ...(item.placeId === null ? {} : { placeId: item.placeId }),
      }))).slice(0, 100),
      approvalEligible: plan.approval.eligible,
      ...(approvalReason(plan.approval.reason) === undefined ? {} : { approvalReason: approvalReason(plan.approval.reason) }),
    }
  }

  return {
    async overview(signal) {
      const [capabilities, connections, workspace] = await Promise.all([
        get(fetcher, '/api/v2/transfers/provider-capabilities', (value) => providerCapabilityListV2Schema.safeParse(value), signal),
        get(fetcher, '/api/v2/transfers/provider-connections', (value) => providerConnectionListV2Schema.safeParse(value), signal),
        get(fetcher, '/api/library/workspace?rating=any&tagMatch=all&limit=50', (value) => personalLibraryWorkspaceResponseV2Schema.safeParse(value), signal),
      ])
      for (const capability of capabilities.items) {
        connectionAuthMethods.set(capability.providerKey, capability.connections.authMethods[0])
      }
      return {
        providers: capabilities.items.map((capability) => ({
          capability: {
            providerKey: capability.providerKey,
            label: capability.displayName,
            connectionState: capability.connections.availability,
            authMethods: capability.connections.authMethods,
            import: availability(capability.importSavedPlaces, 'import'),
            export: availability(capability.exportCollections, 'export'),
          },
          connections: connections.items.filter((connection) => connection.providerKey === capability.providerKey).map((connection) => ({
            connectionId: connection.connectionId,
            providerKey: connection.providerKey,
            authMethod: connection.authMethod,
            accountLabel: connection.label,
            state: connection.state,
            ...(connection.actionRequired === null ? {} : { stateReason: connection.actionRequired }),
            lastVerifiedAt: connection.lastVerifiedAt,
            revision: connection.connectionRevision,
          })),
        })),
        collections: workspace.collections.map((collection) => ({
          collectionId: collection.collectionId,
          name: collection.name,
          placeCount: collection.placeCount,
          collectionRevision: collection.collectionRevision,
          places: [],
        })),
      }
    },

    async collection(collectionId, signal) {
      const workspace = await get(
        fetcher,
        `/api/library/workspace?collectionId=${encodeURIComponent(collectionId)}&rating=any&tagMatch=all&limit=50`,
        (value) => personalLibraryWorkspaceResponseV2Schema.safeParse(value),
        signal,
      )
      const collection = workspace.collections.find((item) => item.collectionId === collectionId)
      if (collection === undefined) throw new DataTransferSettingsProblem(404, 'collection-not-found')
      return {
        collectionId: collection.collectionId,
        name: collection.name,
        placeCount: collection.placeCount,
        collectionRevision: collection.collectionRevision,
        places: workspace.places.map((item) => ({
          placeId: item.placeId,
          name: item.place?.name ?? '현재 조회할 수 없는 장소',
        })),
      }
    },

    async targetLists(connectionId, signal) {
      const projection = await get(
        fetcher,
        `/api/v2/transfers/provider-connections/${encodeURIComponent(connectionId)}/target-lists`,
        (value) => providerTargetListProjectionV2Schema.safeParse(value),
        signal,
      )
      return {
        state: projection.availability,
        ...(projection.reason === null ? {} : { reason: projection.reason }),
        items: projection.items,
      }
    },

    async connectionCommand(input, signal) {
      const command = input.kind === 'connect' ? {
        schemaVersion: 'provider-connection-command.v2' as const,
        commandId: input.commandId,
        kind: 'create' as const,
        // The aggregate identifier is derived from the stable retry command so the exact
        // create body is replayed after a network failure.
        connectionId: input.commandId,
        providerKey: input.providerKey,
        label: `${input.providerKey.toUpperCase()} 계정`,
        authMethod: connectionAuthMethods.get(input.providerKey) ?? 'oauth',
      } : input.kind === 'reconnect' ? {
        schemaVersion: 'provider-connection-command.v2' as const,
        commandId: input.commandId,
        kind: 'request-reauthorization' as const,
        connectionId: input.connectionId ?? '',
        expectedConnectionRevision: input.expectedRevision ?? '',
      } : {
        schemaVersion: 'provider-connection-command.v2' as const,
        commandId: input.commandId,
        kind: 'revoke' as const,
        connectionId: input.connectionId ?? '',
        expectedConnectionRevision: input.expectedRevision ?? '',
      }
      const result = await post(fetcher, '/api/v2/transfers/provider-connection-commands', command, (value) => providerConnectionCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw rejection(result.rejection.code)
    },

    async acquireSnapshot(input, signal) {
      const list = await get(fetcher, `/api/v2/transfers/source-snapshots?connectionId=${encodeURIComponent(input.connectionId)}&limit=20`, (value) => sourceSnapshotListV2Schema.safeParse(value), signal)
      const latest = [...list.items].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0]
      if (latest === undefined) throw new DataTransferSettingsProblem(404, 'source-snapshot-not-found')
      const detail = await get(fetcher, `/api/v2/transfers/source-snapshots/${encodeURIComponent(latest.snapshotId)}`, (value) => sourceSnapshotDetailV2Schema.safeParse(value), signal)
      const snapshot: SourceSnapshot = {
        snapshotId: detail.snapshotId,
        snapshotRevision: detail.snapshotVersion,
        providerKey: detail.providerKey,
        connectionId: detail.connectionId,
        capturedAt: detail.capturedAt,
        lists: detail.lists.map((item) => ({
          sourceListId: item.sourceListId,
          name: item.observedName,
          itemCount: item.itemCount,
          unresolvedItemCount: item.unresolvedItemCount,
        })),
      }
      return snapshot
    },

    async previewImport(input, signal) {
      const result = await post(fetcher, '/api/v2/transfers/import-plan-commands', {
        schemaVersion: 'import-plan-command.v2', commandId: input.commandId,
        kind: 'create', planId: input.commandId,
        snapshotId: input.snapshotId, expectedSnapshotVersion: input.expectedSnapshotRevision,
        mappings: selectedMappings(input.mappings),
      }, (value) => importPlanCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw rejection(result.rejection.code)
      importMappings.set(result.plan.planId, input.mappings)
      return importPreview(result.plan, input.mappings)
    },

    async approveImport(input, signal) {
      const result = await post(fetcher, '/api/v2/transfers/import-plan-commands', {
        schemaVersion: 'import-plan-command.v2', commandId: input.commandId,
        kind: 'approve', planId: input.planId, expectedPlanRevision: input.expectedPlanRevision,
      }, (value) => importPlanCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw rejection(result.rejection.code)
      return {
        operationId: result.plan.planId,
        state: result.plan.state === 'completed' ? 'completed'
          : result.plan.state === 'applying' ? 'applying'
            : result.plan.state === 'blocked' ? 'blocked' : 'action-required',
      }
    },

    async decideImportItem(input, signal) {
      const result = await post(fetcher, '/api/v2/transfers/import-plan-commands', {
        schemaVersion: 'import-plan-command.v2', commandId: input.commandId,
        kind: 'decide-item', planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        sourceListId: input.sourceListId, sourceItemId: input.sourceItemId,
        decision: input.decision,
      }, (value) => importPlanCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw rejection(result.rejection.code)
      const mappings = importMappings.get(input.planId) ?? []
      return importPreview(result.plan, mappings)
    },

    async previewExport(input, signal) {
      const result = await post(fetcher, '/api/v2/transfers/outbound-transfer-commands', {
        schemaVersion: 'outbound-transfer-command.v2', commandId: input.commandId,
        kind: 'preview', transferId: input.commandId,
        connectionId: input.connectionId, collectionId: input.collectionId,
        expectedCollectionRevision: input.expectedCollectionRevision,
        selection: input.selection,
        target: input.targetList.kind === 'new'
          ? { kind: 'new-list', name: input.targetList.name }
          : { kind: 'existing-list', targetListId: input.targetList.targetListId },
      }, (value) => outboundTransferCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw rejection(result.rejection.code)
      const transfer = result.transfer
      const blockedReason = outboundReason(transfer.approval.reason)
      return {
        transferId: transfer.transferId,
        transferRevision: transfer.transferRevision,
        state: transfer.state === 'blocked' ? 'blocked' : 'ready-for-approval',
        providerKey: transfer.providerKey as TransferProviderKey,
        collectionId: transfer.collectionId,
        targetList: input.targetList,
        summary: {
          add: transfer.preview.addCount,
          alreadyPresent: transfer.preview.alreadyPresentCount,
          unresolved: transfer.preview.unresolvedCount,
          unsupported: transfer.preview.unsupportedCount,
        },
        items: transfer.preview.items.slice(0, 100).map((item) => ({
          placeId: item.placeId, name: item.placeId,
          status: item.status === 'unknown' ? 'unresolved' as const : item.status,
        })), approvalEligible: transfer.approval.eligible,
        ...(blockedReason === undefined ? {} : { blockedReason }),
      }
    },

    async approveExport(input, signal) {
      const result = await post(fetcher, '/api/v2/transfers/outbound-transfer-commands', {
        schemaVersion: 'outbound-transfer-command.v2', commandId: input.commandId,
        kind: 'approve', transferId: input.transferId,
        expectedTransferRevision: input.expectedTransferRevision,
      }, (value) => outboundTransferCommandResultV2Schema.safeParse(value), signal)
      if (result.outcome === 'rejected') throw new DataTransferSettingsProblem(409, result.rejection.code)
      return {
        operationId: result.transfer.transferId,
        state: result.transfer.state === 'blocked' ? 'blocked'
          : result.transfer.state === 'completed' ? 'completed'
            : result.transfer.state === 'approved' ? 'approved' : 'action-required',
      }
    },
  }
}

export const dataTransferSettingsGateway = createDataTransferSettingsGateway()
