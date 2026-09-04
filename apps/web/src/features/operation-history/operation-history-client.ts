import {
  transferOperationCommandResultV2Schema,
  transferOperationItemPageV2Schema,
  transferOperationListV2Schema,
  transferOperationSummaryV2Schema,
  transferOperationV2Schema,
  type TransferOperationV2,
} from '@place/contracts/transfers'

import type {
  OperationDetail,
  OperationFilters,
  OperationHistoryGateway,
  OperationIndicator,
  OperationItemPage,
  OperationSummary,
} from './operation-history-model'
import { OperationHistoryProblem } from './operation-history-model'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const providerLabels = { naver: 'NAVER', google: 'Google', kakao: 'Kakao' } as const
const kindTitles = {
  'import-capture': '외부 즐겨찾기 수집',
  'import-materialization': '컬렉션 가져오기',
  'outbound-transfer': '컬렉션 내보내기',
  'account-erasure': '계정 데이터 삭제',
} as const

export function mapOperation(operation: TransferOperationV2): OperationSummary {
  return {
    operationId: operation.operationId,
    operationRevision: operation.operationRevision,
    kind: operation.kind,
    providerKey: operation.providerKey,
    providerLabel: operation.providerKey === null ? '곳곳간' : providerLabels[operation.providerKey],
    accountLabel: operation.accountLabel,
    title: kindTitles[operation.kind],
    state: operation.state,
    stage: operation.stage,
    progress: operation.progress,
    attemptCount: operation.attemptCount,
    nextAttemptAt: operation.nextAttemptAt,
    actionRequired: operation.actionRequired,
    lastError: operation.lastError,
    allowedActions: operation.allowedActions,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt,
  }
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return undefined }
}

function statusForRejection(code: string): number {
  if (code === 'not-found') return 404
  if (code === 'invalid-selection' || code === 'not-approvable') return 422
  if (code === 'connection-not-ready' || code === 'target-unavailable') return 503
  return 409
}

async function parsed<T>(
  response: Response,
  schema: Readonly<{ safeParse(value: unknown): Readonly<{ success: true; data: T }> | Readonly<{ success: false }> }>,
): Promise<T> {
  const value = await json(response)
  const result = schema.safeParse(value)
  if (result.success) return result.data
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
      ? value.code
      : undefined
    throw new OperationHistoryProblem(response.status, code)
  }
  throw new OperationHistoryProblem(503, 'PLACE_OPERATION_RESPONSE_INVALID')
}

export function createOperationHistoryGateway(fetcher: Fetcher = fetch): OperationHistoryGateway {
  return {
    async list(filters: OperationFilters, cursor?: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ limit: '20' })
      if (filters.kind !== '') query.set('kind', filters.kind)
      if (filters.state !== '') query.set('state', filters.state)
      if (cursor !== undefined) query.set('cursor', cursor)
      const value = await parsed(await fetcher(`/api/v2/operations?${query}`, {
        cache: 'no-store', credentials: 'same-origin', signal,
      }), transferOperationListV2Schema)
      return { items: value.items.map(mapOperation), nextCursor: value.nextCursor }
    },
    async detail(operationId: string, signal?: AbortSignal): Promise<OperationDetail> {
      const value = await parsed(await fetcher(`/api/v2/operations/${encodeURIComponent(operationId)}`, {
        cache: 'no-store', credentials: 'same-origin', signal,
      }), transferOperationV2Schema)
      return mapOperation(value)
    },
    async items(operationId: string, cursor?: string, signal?: AbortSignal): Promise<OperationItemPage> {
      const query = new URLSearchParams({ limit: '100' })
      if (cursor !== undefined) query.set('cursor', cursor)
      const value = await parsed(await fetcher(`/api/v2/operations/${encodeURIComponent(operationId)}/items?${query}`, {
        cache: 'no-store', credentials: 'same-origin', signal,
      }), transferOperationItemPageV2Schema)
      return {
        items: value.items.map((item) => ({
          itemId: item.itemKey,
          label: item.placeId ?? item.itemKey,
          targetReference: item.targetReference,
          state: item.status,
          reason: item.code,
          retryable: item.retryable,
          occurredAt: item.updatedAt,
        })),
        nextCursor: value.nextCursor,
      }
    },
    async command(input, signal?: AbortSignal) {
      const value = await parsed(await fetcher('/api/v2/operation-commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 'transfer-operation-command.v2', ...input }),
        cache: 'no-store', credentials: 'same-origin', signal,
      }), transferOperationCommandResultV2Schema)
      if (value.outcome === 'rejected') {
        throw new OperationHistoryProblem(statusForRejection(value.rejection.code), value.rejection.code)
      }
      return { operation: mapOperation(value.operation) }
    },
  }
}

export async function loadOperationIndicator(
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<OperationIndicator> {
  const value = await parsed(await fetcher('/api/v2/operations/summary', {
    cache: 'no-store', credentials: 'same-origin', signal,
  }), transferOperationSummaryV2Schema)
  return {
    activeCount: value.activeCount,
    attentionCount: value.attentionCount,
    actionRequiredCount: value.actionRequiredCount,
    outcomeUnknownCount: value.outcomeUnknownCount,
    latest: value.latest.map(mapOperation),
  }
}

export const operationHistoryGateway = createOperationHistoryGateway()
