'use client'

import { useState } from 'react'

import type {
  PlaceImportBatch,
  PlaceImportItem,
} from '@place/contracts/imports'

import { buildProviderOpenLinks } from '@/platform/maps/provider-open-links'

import styles from './connected-place-imports.module.css'
import type {
  ConnectedPlaceImportsWorkflow,
  ImportAction,
} from './connected-place-imports-workflow'

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
const reviewReasonLabels: Readonly<Record<string, string>> = {
  'possible-duplicate': '중복 가능성',
  'missing-address': '주소 없음',
  'provider-place-id-unavailable': 'Provider 장소 ID 없음',
  'provider-place-id-missing': 'Provider 장소 ID 없음',
  'address-missing': '주소 없음',
  'location-missing': '좌표 없음',
}
const stateMessages: Readonly<Record<PlaceImportBatch['state'], string>> = {
  queued: '가져오기를 기다리고 있습니다.',
  running: '저장 목록을 가져오는 중입니다.',
  partial: '일부 목록을 가져온 뒤 다음 묶음을 기다리고 있습니다.',
  enriching: '가져온 장소를 개인 컬렉션에 저장하고 있습니다.',
  'needs-user-action': 'Provider 계정에서 추가 확인이 필요합니다.',
  'needs-review': '직접 확인할 장소가 있습니다.',
  completed: '가져오기가 완료되었습니다.',
  failed: '가져오기를 완료하지 못했습니다.',
  cancelled: '가져오기가 취소되었습니다.',
}
function ImportProgress({ batch }: Readonly<{ batch: PlaceImportBatch }>) {
  const progress = batch.progress
  return (
    <dl aria-label="가져오기 진행 상황" className={styles.progress}>
      <div><dt>발견</dt><dd>{progress.discovered}</dd></div>
      <div><dt>자동 확인</dt><dd>{progress.ready}</dd></div>
      <div><dt>저장 준비</dt><dd>{progress.enriching}</dd></div>
      <div><dt>검토 필요</dt><dd>{progress.reviewRequired}</dd></div>
      <div><dt>저장</dt><dd>{progress.applied}</dd></div>
      <div><dt>건너뜀</dt><dd>{progress.skipped}</dd></div>
      <div><dt>실패</dt><dd>{progress.failed}</dd></div>
    </dl>
  )
}

function itemStatusLabel(item: PlaceImportItem): string {
  if (item.status === 'applied' || item.status === 'skipped') {
    return item.detailStatus === 'pending' ? '저장됨 · 상세 대기' : '저장됨'
  }
  if (item.status === 'enriching') return '저장 준비 중'
  return '검토 필요'
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
  const enriching = item.status === 'enriching'
  const openLinks = buildProviderOpenLinks(item)
  return (
    <li className={styles.item}>
      <div className={styles.itemHeading}>
        <div><p className={styles.listName}>{item.listName}</p><h3>{item.name}</h3></div>
        <span className={styles.itemStatus}>{itemStatusLabel(item)}</span>
      </div>
      <p className={styles.itemFacts}>
        {item.address ?? '주소 정보 없음'}
        {item.categoryLabel === null ? '' : ` · ${item.categoryLabel}`}
      </p>
      <dl className={styles.sourceIdentity} aria-label="원본 장소 식별자">
        <div><dt>출처</dt><dd>{item.providerKey.toUpperCase()}</dd></div>
        <div><dt>목록 ID</dt><dd title={item.sourceListId}>{item.sourceListId}</dd></div>
        <div><dt>항목 ID</dt><dd title={item.sourceItemId}>{item.sourceItemId}</dd></div>
        <div><dt>장소 ID</dt><dd title={item.providerPlaceId}>{item.providerPlaceId ?? '없음'}</dd></div>
      </dl>
      <nav aria-label={`${item.name} 지도에서 열기`} className={styles.openLinks}>
        {openLinks.map((link) => (
          <a href={link.href} key={link.providerKey} rel="noopener noreferrer" target="_blank">
            {link.label}에서 열기
          </a>
        ))}
      </nav>
      {item.reviewReasons.length > 0 && (
        <ul aria-label="검토 사유" className={styles.reasons}>
          {item.reviewReasons.map((reason) => (
            <li key={reason}>{reviewReasonLabels[reason] ?? reason}</li>
          ))}
        </ul>
      )}
      {result !== undefined && <p className={styles.reviewResult}>{result}</p>}
      {!resolved && !enriching && result !== '저장 완료' && (
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

export function ConnectedPlaceImportsView({
  workflow,
}: Readonly<{ workflow: ConnectedPlaceImportsWorkflow }>) {
  const {
    connections,
    selectedConnectionId,
    batch,
    busy,
    error,
    reviewingItemId,
    reviewResults,
    connectorChecking,
    connectorReady,
    connectorProgress,
    connectorSupportsNaver,
    onboardingRequired,
    onboardingConsents,
    acceptedConsentKeys,
    onboardingBusy,
    items,
    batchActive,
    selectConnection,
    setConsentAccepted,
    completeOnboarding,
    probeConnector,
    startConnectorImport,
    startServerImport,
    transition,
    review,
  } = workflow

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>연결 계정 Import</p>
          <h1>저장 목록 가져오기</h1>
          <p>현재 브라우저의 로그인 상태를 사용하고, 원본 폴더는 내 비공개 컬렉션으로 보존합니다.</p>
        </div>
      </header>

      {error !== undefined && <div className={styles.error} role="alert">{error}</div>}

      {onboardingRequired && (
        <section aria-labelledby="place-onboarding-title" className={styles.onboarding}>
          <p className={styles.eyebrow}>첫 서비스 연결</p>
          <h2 id="place-onboarding-title">Place 이용 동의 후 Owner로 연결합니다</h2>
          <p>
            중앙 플랫폼 Owner 권한은 확인되었습니다. 아래 현재 문서에 동의하면 이 계정을
            Place의 유일한 Owner로 자동 연결합니다.
          </p>
          {onboardingConsents === undefined ? (
            <p className={styles.muted}>현재 동의 문서를 불러오는 중입니다.</p>
          ) : (
            <div className={styles.consentList}>
              {onboardingConsents.map((consent) => {
                const key = `${consent.document}:${consent.version}`
                const label = consent.document === 'terms-of-service'
                  ? '서비스 이용약관'
                  : consent.document === 'privacy-policy'
                    ? '개인정보 처리방침'
                    : consent.document
                return (
                  <label key={key}>
                    <input
                      checked={acceptedConsentKeys.has(key)}
                      disabled={onboardingBusy}
                      onChange={(event) => setConsentAccepted(key, event.target.checked)}
                      type="checkbox"
                    />
                    <span>{label} <small>{consent.version}</small></span>
                  </label>
                )
              })}
              <button
                className={styles.primaryButton}
                disabled={onboardingBusy || acceptedConsentKeys.size !== onboardingConsents.length}
                onClick={() => void completeOnboarding()}
                type="button"
              >
                동의하고 Owner 연결
              </button>
            </div>
          )}
        </section>
      )}

      <div className={styles.layout}>
        <aside className={styles.controlPane}>
          <section aria-labelledby="connector-title" className={styles.controlSection}>
            <div className={styles.sectionHeading}>
              <h2 id="connector-title">현재 브라우저</h2>
              <span className={styles.state}>
                {connectorChecking ? '확인 중' : connectorReady === undefined ? '미설치' : connectorReady.browserKey}
              </span>
            </div>
            {connectorReady === undefined ? (
              <p className={styles.muted}>
                Place Connector를 설치한 뒤 다시 확인하세요. 아이디·비밀번호는 Place로 전송하지 않습니다.
              </p>
            ) : (
              <p className={styles.muted}>
                확장 프로그램 연결됨 · NAVER {connectorSupportsNaver ? '사용 가능' : '미지원'}
              </p>
            )}
            <div className={styles.batchActions}>
              <button disabled={busy || connectorChecking} onClick={() => void probeConnector()} type="button">
                확장 다시 확인
              </button>
              <button
                className={styles.primaryButton}
                disabled={busy || !connectorSupportsNaver || batch !== undefined}
                onClick={() => void startConnectorImport()}
                type="button"
              >
                이 브라우저에서 NAVER 가져오기
              </button>
            </div>
            {connectorProgress !== undefined && (
              <p className={styles.stateMessage} aria-live="polite">
                {connectorProgress.phase} · {connectorProgress.submittedItems}/{connectorProgress.discoveredItems}개 전송
              </p>
            )}
          </section>

          {connections.length > 0 && (
            <section aria-labelledby="connection-title" className={styles.controlSection}>
              <h2 id="connection-title">서버 연결 계정</h2>
              <p className={styles.muted}>운영자가 별도로 활성화한 수집 경로입니다.</p>
              {connections.map((connection) => (
                <label className={styles.connection} key={connection.connectionId}>
                  <input
                    checked={selectedConnectionId === connection.connectionId}
                    disabled={connection.status !== 'ready' || batch !== undefined}
                    name="provider-connection"
                    onChange={() => selectConnection(connection.connectionId)}
                    type="radio"
                  />
                  <span><strong>{connection.label}</strong><small>{connection.providerKey.toUpperCase()} · {connection.status === 'ready' ? '준비됨' : '확인 필요'}</small></span>
                </label>
              ))}
              {batch === undefined && (
                <button className={styles.primaryButton} disabled={busy || selectedConnectionId === undefined} onClick={() => void startServerImport()} type="button">
                  서버 수집 시작
                </button>
              )}
            </section>
          )}

          {batch !== undefined && (
            <section aria-labelledby="progress-title" className={styles.controlSection}>
              <div className={styles.sectionHeading}>
                <h2 id="progress-title">진행 상황</h2><span className={styles.state}>{batch.state}</span>
              </div>
              <p className={styles.stateMessage}>{stateMessages[batch.state]}</p>
              <ImportProgress batch={batch} />
              <div className={styles.batchActions}>
                {batchActive && (
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
              <p>같은 장소는 한 번만 저장하고, 여러 원본 폴더에 속하면 각 컬렉션 관계를 모두 보존합니다.</p>
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
