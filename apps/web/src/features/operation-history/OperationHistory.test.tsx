import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { OperationState, OperationSummary } from './operation-history-model'
import { OperationHistoryView } from './OperationHistory'
import type { OperationHistoryWorkflow } from './operation-history-workflow'

const states: readonly OperationState[] = [
  'queued', 'running', 'retry-scheduled', 'action-required', 'partial-failure',
  'outcome-unknown', 'completed', 'cancelled', 'failed',
]

function operation(state: OperationState, index: number, stage = 'preview-approved'): OperationSummary {
  return {
    operationId: `01992d20-0000-7000-8000-${String(index).padStart(12, '0')}`,
    operationRevision: `operation-r${index}`, kind: 'outbound-transfer', providerKey: 'naver',
    providerLabel: 'NAVER', accountLabel: '여행 계정', title: '컬렉션 내보내기', state, stage,
    progress: { total: 10, processed: 6, applied: 4, failed: 1, outcomeUnknown: 1 },
    attemptCount: 1, nextAttemptAt: null, actionRequired: state === 'action-required' ? 'consent-required' : null,
    lastError: null, allowedActions: state === 'outcome-unknown' ? ['reconcile'] : ['cancel'],
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:01:00.000Z', completedAt: null,
  }
}

function workflow(selected: OperationSummary, operations = states.map((state, index) => operation(state, index + 1))) {
  return {
    filters: { kind: '', state: '' }, setFilters() {}, operations, nextCursor: undefined,
    selectedId: selected.operationId, select() {}, detail: selected,
    receipts: [{ itemId: 'item-1', label: '처리 항목', targetReference: 'remote-place-1', state: 'outcome-unknown', reason: 'provider-timeout', retryable: true, occurredAt: '2026-09-03T00:01:00.000Z' }],
    nextItemCursor: undefined, listState: 'ready', detailState: 'ready', actionState: { kind: 'idle' }, confirmingAction: undefined,
    requestAction() {}, confirmAction() {}, dismissConfirmation() {}, loadMore() {}, loadMoreItems() {}, retry() {}, reloadDetail() {},
  } as unknown as OperationHistoryWorkflow
}

describe('OperationHistoryView', () => {
  it('renders every durable state, item receipts, and approval as not externally completed', () => {
    const selected = operation('action-required', 4)
    const markup = renderToStaticMarkup(<OperationHistoryView workflow={workflow(selected)} />)
    for (const label of ['대기 중', '진행 중', '재시도 예정', '확인 필요', '일부 실패', '결과 확인 필요', '완료', '취소됨', '실패']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('내보내기 범위 승인됨 · 외부 실행 전')
    expect(markup).toContain('외부 서비스에 반영됐다는 뜻이 아닙니다')
    expect(markup).toContain('provider-timeout')
    expect(markup).not.toContain('외부 서비스 반영 완료</strong>')
  })

  it('labels only an externally-completed stage as provider completion and gives outcome-unknown a reconcile path', () => {
    const completed = operation('completed', 10, 'externally-completed')
    const completeMarkup = renderToStaticMarkup(<OperationHistoryView workflow={workflow(completed, [completed])} />)
    expect(completeMarkup).toContain('외부 서비스 반영 완료')

    const unknown = operation('outcome-unknown', 11, 'reconciling')
    const unknownMarkup = renderToStaticMarkup(<OperationHistoryView workflow={workflow(unknown, [unknown])} />)
    expect(unknownMarkup).toContain('같은 쓰기를 다시 보내지 않습니다')
    expect(unknownMarkup).toContain('외부 결과 확인')
  })

  it('shows account erasure as an operator review without a fake permanent-delete action', () => {
    const erasure: OperationSummary = {
      ...operation('action-required', 12, 'retention-review'), kind: 'account-erasure', providerKey: null,
      providerLabel: '곳곳간', accountLabel: null, title: '계정 데이터 삭제',
      actionRequired: 'operator-approval-required', allowedActions: [],
    }
    const markup = renderToStaticMarkup(<OperationHistoryView workflow={workflow(erasure, [erasure])} />)
    expect(markup).toContain('운영자 검토 필요')
    expect(markup).toContain('현재 실행할 수 있는 후속 작업이 없습니다')
    expect(markup).not.toContain('영구 삭제 실행')
  })

  it('renders an empty progress state without an invalid zero-maximum progressbar', () => {
    const empty = { ...operation('queued', 13, 'awaiting-connector'), progress: {
      total: 0, processed: 0, applied: 0, failed: 0, outcomeUnknown: 0,
    } }
    const markup = renderToStaticMarkup(<OperationHistoryView workflow={workflow(empty, [empty])} />)
    expect(markup).toContain('처리 항목 없음')
    expect(markup).not.toContain('aria-valuemax="0"')
    expect(markup).toContain('aria-pressed="true"')
  })
})
