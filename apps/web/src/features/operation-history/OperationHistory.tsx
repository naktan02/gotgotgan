'use client'

import Link from 'next/link'

import type {
  OperationAction,
  OperationHistoryGateway,
  OperationKind,
  OperationState,
  OperationSummary,
} from './operation-history-model'
import styles from './operation-history.module.css'
import {
  type OperationHistoryWorkflow,
  useOperationHistory,
} from './operation-history-workflow'

const stateLabels: Record<OperationState, string> = {
  queued: '대기 중',
  running: '진행 중',
  'retry-scheduled': '재시도 예정',
  'action-required': '확인 필요',
  'partial-failure': '일부 실패',
  'outcome-unknown': '결과 확인 필요',
  completed: '완료',
  cancelled: '취소됨',
  failed: '실패',
}

const kindLabels: Record<OperationKind, string> = {
  'import-capture': '외부 즐겨찾기 수집',
  'import-materialization': '곳곳간 가져오기',
  'outbound-transfer': '외부 서비스 내보내기',
  'account-erasure': '계정 데이터 삭제',
}

const stageLabels: Readonly<Record<string, string>> = {
  'awaiting-connector': 'Connector 연결 대기',
  'receiving-chunks': '수집 데이터 수신 중',
  'validating-manifest': '수집 목록 검증 중',
  'snapshot-recorded': '저장된 스냅샷 준비됨',
  'preview-approved': '내보내기 범위 승인됨 · 외부 실행 전',
  'queued-for-materialization': '곳곳간 반영 대기',
  materializing: '곳곳간 컬렉션 반영 중',
  'library-completed': '곳곳간 저장 완료',
  'authorizing-execution': '외부 쓰기 권한 확인 중',
  'executing-provider-write': '외부 서비스 반영 중',
  reconciling: '외부 결과 대조 중',
  'externally-completed': '외부 서비스 반영 완료',
  'retention-review': '삭제 범위 검토 중',
  purging: '계정 데이터 삭제 중',
  'erasure-completed': '계정 데이터 삭제 완료',
}

const actionLabels: Record<OperationAction, string> = {
  retry: '다시 시도', resume: '이어서 진행', cancel: '작업 취소', reconcile: '외부 결과 확인',
}

const receiptLabels = {
  pending: '대기', applied: '반영됨', 'already-present': '이미 존재', failed: '실패',
  'outcome-unknown': '결과 미확인', present: '외부에 존재', absent: '외부에 없음', skipped: '건너뜀',
} as const

function formatDate(value: string | null): string {
  if (value === null) return '기록 없음'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '시각 확인 불가' : new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

function Progress({ operation, compact = false }: Readonly<{
  operation: OperationSummary
  compact?: boolean
}>) {
  const { total, processed, applied, failed, outcomeUnknown } = operation.progress
  const percent = total === 0 ? 0 : Math.min(100, Math.round((processed / total) * 100))
  return <div className={compact ? styles.compactProgress : styles.progress}>
    {total === 0 ? <span className={styles.emptyProgress}>처리 항목 없음</span> : <>
      <div className={styles.progressTrack} role="progressbar" aria-label={`${operation.title} 처리 진행률`} aria-valuemax={total} aria-valuemin={0} aria-valuenow={processed}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <span>{processed.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}</span>
    </>}
    {!compact && <small>반영 {applied.toLocaleString('ko-KR')} · 실패 {failed.toLocaleString('ko-KR')} · 결과 미확인 {outcomeUnknown.toLocaleString('ko-KR')}</small>}
  </div>
}

function StatePill({ state }: Readonly<{ state: OperationState }>) {
  return <span className={styles.statePill} data-state={state}>{stateLabels[state]}</span>
}

function LoadPanel({ state, onRetry }: Readonly<{
  state: OperationHistoryWorkflow['listState']
  onRetry: () => void
}>) {
  if (state === 'loading') return <section className={styles.statePanel} aria-live="polite"><strong>작업 내역을 불러오는 중입니다.</strong></section>
  if (state === 'authentication-required') return <section className={styles.statePanel}><strong>로그인이 필요합니다.</strong><p>내 작업 기록은 로그인한 사용자만 볼 수 있습니다.</p><a href="/api/auth/oidc/start">로그인</a></section>
  if (state === 'forbidden') return <section className={styles.statePanel}><strong>작업 내역을 볼 권한이 없습니다.</strong><p>현재 계정의 접근 권한을 확인해 주세요.</p></section>
  return <section className={styles.statePanel}><strong>작업 내역 서비스를 사용할 수 없습니다.</strong><p>잠시 뒤 서버에 저장된 최신 상태를 다시 확인해 주세요.</p><button onClick={onRetry} type="button">다시 불러오기</button></section>
}

function OperationCard({ operation, selected, onSelect }: Readonly<{
  operation: OperationSummary
  selected: boolean
  onSelect: () => void
}>) {
  return <li><button aria-pressed={selected} className={selected ? `${styles.operationCard} ${styles.selectedCard}` : styles.operationCard} onClick={onSelect} type="button">
    <span className={styles.cardTop}><strong>{operation.title}</strong><StatePill state={operation.state} /></span>
    <span className={styles.cardMeta}>{operation.providerLabel}{operation.accountLabel === null ? '' : ` · ${operation.accountLabel}`}</span>
    <span className={styles.cardStage}>{stageLabels[operation.stage] ?? operation.stage}</span>
    <Progress compact operation={operation} />
    <time dateTime={operation.updatedAt}>최근 갱신 {formatDate(operation.updatedAt)}</time>
  </button></li>
}

function DetailState({ workflow }: Readonly<{ workflow: OperationHistoryWorkflow }>) {
  if (workflow.detailState === 'loading') return <section className={styles.detailState} aria-live="polite">선택한 작업의 서버 기록을 확인하는 중입니다.</section>
  if (workflow.detailState === 'authentication-required') return <section className={styles.detailState}><strong>로그인이 만료되었습니다.</strong><a href="/api/auth/oidc/start">다시 로그인</a></section>
  if (workflow.detailState === 'forbidden') return <section className={styles.detailState}><strong>이 작업의 상세 기록을 볼 권한이 없습니다.</strong></section>
  if (workflow.detailState === 'not-found') return <section className={styles.detailState}><strong>이 작업을 찾을 수 없습니다.</strong><p>목록을 새로 불러와 최신 상태를 확인해 주세요.</p><button onClick={workflow.retry} type="button">목록 새로고침</button></section>
  if (workflow.detailState !== 'ready') return <section className={styles.detailState}><strong>상세 기록을 불러오지 못했습니다.</strong><button onClick={workflow.reloadDetail} type="button">다시 시도</button></section>
  return null
}

function Detail({ workflow }: Readonly<{ workflow: OperationHistoryWorkflow }>) {
  const operation = workflow.detail
  if (workflow.detailState !== 'ready' || operation === undefined) return <DetailState workflow={workflow} />
  const pending = workflow.actionState.kind === 'working'
  return <article className={styles.detail} aria-labelledby="operation-detail-title">
    <header className={styles.detailHeader}>
      <div><p className={styles.eyebrow}>{kindLabels[operation.kind]}</p><h3 id="operation-detail-title">{operation.title}</h3><p>{operation.providerLabel}{operation.accountLabel === null ? '' : ` · ${operation.accountLabel}`}</p></div>
      <StatePill state={operation.state} />
    </header>
    <div className={styles.stage} data-stage={operation.stage}>
      <strong>{stageLabels[operation.stage] ?? operation.stage}</strong>
      {operation.stage === 'preview-approved' && <p>변경 범위를 승인한 상태입니다. 외부 서비스에 반영됐다는 뜻이 아닙니다.</p>}
      {operation.stage === 'externally-completed' && <p>외부 서비스의 결과를 확인해 반영 완료로 기록했습니다.</p>}
      {operation.state === 'outcome-unknown' && <p>같은 쓰기를 다시 보내지 않습니다. ‘외부 결과 확인’으로 실제 상태를 먼저 대조하세요.</p>}
      {operation.actionRequired !== null && <p>사용자 확인: {{
        'reauth-required': '외부 계정 재인증 필요', 'mfa-required': '다중 인증 필요',
        'captcha-required': '보안 문자 확인 필요', 'consent-required': '추가 동의 필요',
        'retention-review-required': '운영 보존 정책 검토 필요',
        'operator-approval-required': '운영자 검토 필요',
      }[operation.actionRequired]}</p>}
    </div>
    <Progress operation={operation} />
    <dl className={styles.facts}>
      <div><dt>시작</dt><dd>{formatDate(operation.createdAt)}</dd></div>
      <div><dt>최근 갱신</dt><dd>{formatDate(operation.updatedAt)}</dd></div>
      <div><dt>시도 횟수</dt><dd>{operation.attemptCount.toLocaleString('ko-KR')}회</dd></div>
      <div><dt>다음 시도</dt><dd>{formatDate(operation.nextAttemptAt)}</dd></div>
    </dl>
    {operation.lastError !== null && <p className={styles.error} role="alert">최근 오류: {operation.lastError.code}{operation.lastError.retryable ? ' · 재시도 가능' : ''}</p>}
    <div className={styles.actions} aria-label="허용된 작업">
      {operation.allowedActions.length === 0 && <span>현재 실행할 수 있는 후속 작업이 없습니다.</span>}
      {operation.allowedActions.map((action) => <button disabled={pending} key={action} onClick={() => workflow.requestAction(action)} type="button">{actionLabels[action]}</button>)}
    </div>
    {workflow.actionState.kind === 'working' && <p className={styles.actionStatus} role="status">{actionLabels[workflow.actionState.action]} 요청을 처리 중입니다.</p>}
    {workflow.actionState.kind === 'error' && <p className={styles.error} role="alert">{workflow.actionState.message}</p>}
    {workflow.confirmingAction === 'cancel' && <section aria-labelledby="cancel-title" className={styles.confirmation} role="group">
      <h4 id="cancel-title">이 작업을 취소할까요?</h4><p>이미 외부에 반영된 항목은 자동으로 되돌리지 않습니다.</p><div><button onClick={workflow.dismissConfirmation} type="button">계속 유지</button><button className={styles.danger} onClick={workflow.confirmAction} type="button">작업 취소</button></div>
    </section>}
    <section className={styles.receipts} aria-labelledby="receipt-title">
      <header><div><h4 id="receipt-title">항목별 처리 기록</h4><p>서버에 저장된 최신 receipt입니다.</p></div><span>{workflow.receipts.length.toLocaleString('ko-KR')}개 표시</span></header>
      {workflow.receipts.length === 0 ? <p className={styles.emptyReceipts}>아직 항목별 처리 기록이 없습니다.</p> : <ol>
        {workflow.receipts.map((receipt, index) => <li key={receipt.itemId}>
          <span aria-hidden="true">{index + 1}</span>
          <div><strong>{receipt.targetReference ?? `처리 항목 ${index + 1}`}</strong><small>{receipt.reason ?? (receipt.retryable ? '재시도 가능한 항목' : '추가 메시지 없음')}</small></div>
          <span className={styles.receiptState} data-state={receipt.state}>{receiptLabels[receipt.state]}</span>
          <time dateTime={receipt.occurredAt ?? undefined}>{formatDate(receipt.occurredAt)}</time>
        </li>)}
      </ol>}
      {workflow.nextItemCursor !== undefined && <button className={styles.moreButton} onClick={workflow.loadMoreItems} type="button">처리 기록 더 보기</button>}
    </section>
  </article>
}

export function OperationHistoryView({ workflow }: Readonly<{ workflow: OperationHistoryWorkflow }>) {
  return <section className={styles.history} aria-labelledby="history-title">
    <header className={styles.heading}><div><p className={styles.eyebrow}>DURABLE OPERATIONS</p><h2 id="history-title">작업 내역</h2><p>가져오기와 내보내기의 실제 서버 상태를 확인하고 필요한 후속 작업을 이어갑니다.</p></div><button onClick={workflow.retry} type="button">새로고침</button></header>
    <p className={styles.notice} role="note">페이지를 새로 열어도 서버에 저장된 command와 operation 기록에서 상태를 복구합니다. 개인 메모·방문 기록·사진·평점은 전송 기록에 포함되지 않습니다.</p>
    <div className={styles.filters}>
      <label>작업 유형<select value={workflow.filters.kind} onChange={(event) => workflow.setFilters((current) => ({ ...current, kind: event.target.value as '' | OperationKind }))}>
        <option value="">전체</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>상태<select value={workflow.filters.state} onChange={(event) => workflow.setFilters((current) => ({ ...current, state: event.target.value as '' | OperationState }))}>
        <option value="">전체</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {workflow.listState !== 'ready' ? <LoadPanel onRetry={workflow.retry} state={workflow.listState} /> : workflow.operations.length === 0
      ? <section className={styles.statePanel}><strong>조건에 맞는 작업이 없습니다.</strong><p>가져오기 또는 내보내기를 승인하면 서버 작업 기록이 여기에 표시됩니다.</p><Link href="/settings?tab=import">데이터 가져오기 보기</Link></section>
      : <div className={styles.layout}>
        <section className={styles.listPane} aria-label="작업 목록"><ul>{workflow.operations.map((operation) => <OperationCard key={operation.operationId} onSelect={() => workflow.select(operation.operationId)} operation={operation} selected={operation.operationId === workflow.selectedId} />)}</ul>{workflow.nextCursor !== undefined && <button className={styles.moreButton} onClick={workflow.loadMore} type="button">작업 더 보기</button>}</section>
        <section className={styles.detailPane} aria-label="선택한 작업 상세"><Detail workflow={workflow} /></section>
      </div>}
  </section>
}

export function OperationHistory({ gateway }: Readonly<{ gateway: OperationHistoryGateway }>) {
  return <OperationHistoryView workflow={useOperationHistory(gateway)} />
}
