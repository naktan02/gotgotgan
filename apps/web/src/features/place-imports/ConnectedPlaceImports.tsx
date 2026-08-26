'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { problemSchema } from '@place/contracts/http'
import {
  placeImportBatchDetailSchema,
  placeImportBatchSchema,
  placeImportReviewResultSchema,
  providerConnectionListSchema,
  type PlaceImportBatch,
  type PlaceImportBatchDetail,
  type PlaceImportItem,
} from '@place/contracts/imports'

import styles from './connected-place-imports.module.css'

type ImportAction =
  | Readonly<{ kind: 'create-place' }>
  | Readonly<{ kind: 'link-place'; canonicalPlaceId: string }>
  | Readonly<{ kind: 'skip'; reason?: string }>

const activeStates = new Set(['queued', 'running', 'partial'])
const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
const reviewReasonLabels: Readonly<Record<string, string>> = {
  'possible-duplicate': '중복 가능성',
  'missing-address': '주소 없음',
  'provider-place-id-unavailable': 'Provider 장소 ID 없음',
}
const stateMessages: Readonly<Record<PlaceImportBatch['state'], string>> = {
  queued: '가져오기를 기다리고 있습니다.',
  running: '저장목록을 가져오는 중입니다.',
  partial: '일부 항목을 가져오는 중입니다.',
  'needs-user-action': 'Provider 계정에서 확인이 필요합니다.',
  'needs-review': '검토할 항목이 있습니다.',
  completed: '가져오기가 완료되었습니다.',
  failed: '가져오기를 완료하지 못했습니다.',
  cancelled: '가져오기가 취소되었습니다.',
}

class ImportBrowserProblem extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new ImportBrowserProblem('가져오기 응답을 확인하지 못했습니다.', true)
  }
  const payload: unknown = await response.json()
  if (!response.ok) {
    const parsed = problemSchema.safeParse(payload)
    throw new ImportBrowserProblem(
      parsed.success ? parsed.data.title : '가져오기를 처리하지 못했습니다.',
      parsed.success ? parsed.data.retryable : true,
    )
  }
  return payload
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body === undefined ? init?.headers : {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      'content-type': 'application/json',
    },
    cache: 'no-store',
  })
  return responsePayload(response)
}

function ImportProgress({ batch }: Readonly<{ batch: PlaceImportBatch }>) {
  const progress = batch.progress
  return (
    <dl aria-label="가져오기 진행 상황" className={styles.progress}>
      <div><dt>발견</dt><dd>{progress.discovered}</dd></div>
      <div><dt>자동 확인</dt><dd>{progress.ready}</dd></div>
      <div><dt>검토 필요</dt><dd>{progress.reviewRequired}</dd></div>
      <div><dt>저장</dt><dd>{progress.applied}</dd></div>
      <div><dt>건너뜀</dt><dd>{progress.skipped}</dd></div>
      <div><dt>실패</dt><dd>{progress.failed}</dd></div>
    </dl>
  )
}

function ItemReview({
  item,
  busy,
  result,
  onReview,
}: Readonly<{
  item: PlaceImportItem
  busy: boolean
  result?: string
  onReview: (action: ImportAction) => Promise<void>
}>) {
  const [canonicalPlaceId, setCanonicalPlaceId] = useState('')
  const resolved = item.status === 'applied' || item.status === 'skipped'
  return (
    <li className={styles.item}>
      <div className={styles.itemHeading}>
        <div>
          <p className={styles.listName}>{item.listName}</p>
          <h3>{item.name}</h3>
        </div>
        <span className={styles.itemStatus}>{resolved ? '처리됨' : '검토 필요'}</span>
      </div>
      <p className={styles.itemFacts}>
        {item.address ?? '주소 정보 없음'}
        {item.categoryLabel === null ? '' : ` · ${item.categoryLabel}`}
      </p>
      {item.reviewReasons.length > 0 && (
        <ul aria-label="검토 사유" className={styles.reasons}>
          {item.reviewReasons.map((reason) => (
            <li key={reason}>{reviewReasonLabels[reason] ?? reason}</li>
          ))}
        </ul>
      )}
      {result !== undefined && <p className={styles.reviewResult}>{result}</p>}
      {!resolved && result !== '저장 완료' && (
        <div className={styles.reviewActions}>
          <button disabled={busy} onClick={() => void onReview({ kind: 'create-place' })} type="button">
            새 장소로 저장
          </button>
          <button disabled={busy} onClick={() => void onReview({ kind: 'skip', reason: 'member-skipped' })} type="button">
            건너뛰기
          </button>
          <label>
            연결할 기존 장소 ID
            <input
              aria-label="연결할 기존 장소 ID"
              onChange={(event) => setCanonicalPlaceId(event.target.value)}
              pattern={uuidPattern}
              placeholder="UUID"
              value={canonicalPlaceId}
            />
          </label>
          <button
            disabled={busy || !new RegExp(uuidPattern).test(canonicalPlaceId)}
            onClick={() => void onReview({ kind: 'link-place', canonicalPlaceId })}
            type="button"
          >
            기존 장소에 연결
          </button>
        </div>
      )}
    </li>
  )
}

export function ConnectedPlaceImports() {
  const [connections, setConnections] = useState<ReturnType<typeof providerConnectionListSchema.parse>['items']>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>()
  const [detail, setDetail] = useState<PlaceImportBatchDetail>()
  const [batch, setBatch] = useState<PlaceImportBatch>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [reviewingItemId, setReviewingItemId] = useState<string>()
  const [reviewResults, setReviewResults] = useState<Readonly<Record<string, string>>>({})
  const startCommand = useRef<string | undefined>(undefined)
  const reviewCommands = useRef(new Map<string, string>())

  const loadDetail = useCallback(async (batchId: string) => {
    const parsed = placeImportBatchDetailSchema.parse(await requestJson(`/api/imports/${batchId}`))
    setDetail(parsed)
    setBatch(parsed.batch)
  }, [])

  useEffect(() => {
    let active = true
    void requestJson('/api/imports/connections')
      .then((payload) => providerConnectionListSchema.parse(payload))
      .then((projection) => {
        if (!active) return
        setConnections(projection.items)
        setSelectedConnectionId(projection.items.find((item) => item.status === 'ready')?.connectionId)
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : '연결 계정을 불러오지 못했습니다.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (batch === undefined || !activeStates.has(batch.state)) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const parsed = placeImportBatchDetailSchema.parse(
          await requestJson(`/api/imports/${batch.batchId}`),
        )
        if (!active) return
        setDetail(parsed)
        setBatch(parsed.batch)
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : '진행 상황을 확인하지 못했습니다.')
        }
      }
      if (active) timer = window.setTimeout(() => void poll(), 1_000)
    }
    timer = window.setTimeout(() => void poll(), 1_000)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [batch?.batchId, batch?.state])

  async function startImport() {
    if (selectedConnectionId === undefined) return
    setBusy(true)
    setError(undefined)
    startCommand.current ??= crypto.randomUUID()
    try {
      const created = placeImportBatchSchema.parse(await requestJson('/api/imports', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 'place-import-request.v1',
          connectionId: selectedConnectionId,
          idempotencyKey: startCommand.current,
        }),
      }))
      setBatch(created)
      await loadDetail(created.batchId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '가져오기를 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function transition(kind: 'cancel' | 'resume') {
    if (batch === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const updated = placeImportBatchSchema.parse(await requestJson(
        `/api/imports/${batch.batchId}/${kind}`,
        { method: 'POST', body: JSON.stringify({ schemaVersion: `place-import-${kind === 'cancel' ? 'cancel' : 'resume'}.v1` }) },
      ))
      setBatch(updated)
      if (kind === 'resume') await loadDetail(batch.batchId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '가져오기 상태를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function review(item: PlaceImportItem, action: ImportAction) {
    const key = `${item.itemId}:${JSON.stringify(action)}`
    const commandId = reviewCommands.current.get(key) ?? crypto.randomUUID()
    reviewCommands.current.set(key, commandId)
    setReviewingItemId(item.itemId)
    setError(undefined)
    try {
      placeImportReviewResultSchema.parse(await requestJson('/api/import-reviews', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 'place-import-review.v1', commandId, itemId: item.itemId, action,
        }),
      }))
      setReviewResults((current) => ({ ...current, [item.itemId]: action.kind === 'skip' ? '건너뜀' : '저장 완료' }))
      await loadDetail(item.batchId)
      reviewCommands.current.delete(key)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '검토 결과를 확인하지 못했습니다.')
    } finally {
      setReviewingItemId(undefined)
    }
  }

  const items = detail?.items ?? []
  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>연결 계정 Import</p>
          <h1>저장목록 가져오기</h1>
          <p>Provider 원본은 바로 확정하지 않고, 정규화·중복 검토 후 내 장소로 저장합니다.</p>
        </div>
      </header>

      {error !== undefined && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.layout}>
        <aside className={styles.controlPane}>
          <section aria-labelledby="connection-title" className={styles.controlSection}>
            <h2 id="connection-title">연결 계정</h2>
            {connections.length === 0 ? (
              <p className={styles.muted}>사용 가능한 연결 계정이 없습니다.</p>
            ) : connections.map((connection) => (
              <label className={styles.connection} key={connection.connectionId}>
                <input
                  checked={selectedConnectionId === connection.connectionId}
                  disabled={connection.status !== 'ready' || batch !== undefined}
                  name="provider-connection"
                  onChange={() => setSelectedConnectionId(connection.connectionId)}
                  type="radio"
                />
                <span><strong>{connection.label}</strong><small>{connection.providerKey.toUpperCase()} · {connection.status === 'ready' ? '준비됨' : '확인 필요'}</small></span>
              </label>
            ))}
            {batch === undefined && (
              <button className={styles.primaryButton} disabled={busy || selectedConnectionId === undefined} onClick={() => void startImport()} type="button">
                가져오기 시작
              </button>
            )}
          </section>

          {batch !== undefined && (
            <section aria-labelledby="progress-title" className={styles.controlSection}>
              <div className={styles.sectionHeading}>
                <h2 id="progress-title">진행 상황</h2>
                <span className={styles.state}>{batch.state}</span>
              </div>
              <p className={styles.stateMessage}>{stateMessages[batch.state]}</p>
              <ImportProgress batch={batch} />
              <div className={styles.batchActions}>
                {activeStates.has(batch.state) && (
                  <button disabled={busy} onClick={() => void transition('cancel')} type="button">가져오기 취소</button>
                )}
                {(batch.state === 'cancelled' || (batch.failure?.retryable ?? false)) && (
                  <button disabled={busy} onClick={() => void transition('resume')} type="button">가져오기 재개</button>
                )}
              </div>
            </section>
          )}
        </aside>

        <section aria-labelledby="review-title" className={styles.reviewPane}>
          <div className={styles.reviewHeader}>
            <div><p className={styles.eyebrow}>예외 검토</p><h2 id="review-title">가져온 장소</h2></div>
            <span>{items.length}개 항목</span>
          </div>
          {items.length === 0 ? (
            <div className={styles.empty}>
              <strong>{batch === undefined ? '가져오기를 시작해 주세요.' : '항목을 확인하고 있습니다.'}</strong>
              <p>중복 가능성과 부족한 정보가 있는 장소는 이곳에서 결정합니다.</p>
            </div>
          ) : (
            <ul aria-label="가져오기 검토 항목" className={styles.items}>
              {items.map((item) => (
                <ItemReview
                  busy={reviewingItemId === item.itemId}
                  item={item}
                  key={item.itemId}
                  onReview={(action) => review(item, action)}
                  result={reviewResults[item.itemId]}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
