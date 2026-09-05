'use client'

import type { SourceSnapshot } from '../data-transfer-settings-model'
import type { ImportAcquisition, ImportAcquisitionItem } from './import-acquisition-model'
import type { ImportAcquisitionGateway } from './import-acquisition-model'
import { useImportAcquisition } from './import-acquisition-workflow'
import styles from './import-acquisition.module.css'

const itemStateLabel: Record<ImportAcquisitionItem['state'], string> = {
  pending: '확인 대기',
  fetching: '목록 확인 중',
  ready: '가져올 수 있음',
  duplicate: '중복 링크',
  invalid: '올바르지 않은 링크',
  unavailable: '공유 해제 또는 찾을 수 없음',
  'rate-limited': '잠시 요청 제한됨',
  failed: '확인 실패',
}

const acquisitionStateLabel: Record<ImportAcquisition['state'], string> = {
  processing: '확인 중',
  ready: '준비됨',
  partial: '일부 준비됨',
  failed: '확인 실패',
  cancelled: '취소됨',
  expired: '만료됨',
}

function resultSummary(acquisition: ImportAcquisition): string {
  const { failed, ready, total } = acquisition.progress
  return `${total}개 중 ${ready}개 준비${failed > 0 ? ` · ${failed}개 확인 필요` : ''}`
}

function LinkResultRow({
  item,
  selected,
  onToggle,
  onDismiss,
}: Readonly<{
  item: ImportAcquisitionItem
  selected: boolean
  onToggle: () => void
  onDismiss: () => void
}>) {
  const ready = item.state === 'ready'
  const dismissible = !['pending', 'fetching', 'ready'].includes(item.state)
  return <li className={styles.resultRow} data-state={item.state}>
    <label className={styles.resultSelection}>
      <input
        checked={selected}
        disabled={!ready}
        onChange={onToggle}
        type="checkbox"
      />
      <span className={styles.srOnly}>{item.name ?? item.inputLabel} 가져오기 선택</span>
    </label>
    <span className={styles.resultStatus}>{itemStateLabel[item.state]}</span>
    <span className={styles.resultIdentity}>
      <strong>{item.name ?? '목록 이름 확인 전'}</strong>
      <small title={item.inputLabel}>{item.inputLabel}</small>
    </span>
    <span className={styles.itemCount}>{item.itemCount === undefined ? '—' : `${item.itemCount.toLocaleString('ko-KR')}곳`}</span>
    {dismissible && <button className={styles.dismissButton} onClick={onDismiss} type="button">목록에서 제거</button>}
  </li>
}

function AcquisitionResults({
  acquisition,
  items,
  selected,
  busy,
  onToggle,
  onDismiss,
  onRefresh,
  onCancel,
  onPrepare,
}: Readonly<{
  acquisition: ImportAcquisition
  items: readonly ImportAcquisitionItem[]
  selected: ReadonlySet<string>
  busy: boolean
  onToggle: (entryId: string) => void
  onDismiss: (entryId: string) => void
  onRefresh: () => void
  onCancel: () => void
  onPrepare: () => void
}>) {
  const selectedReady = items.filter((item) => item.state === 'ready' && selected.has(item.entryId)).length
  const cancellable = acquisition.state === 'processing' && acquisition.items.length > 0 &&
    acquisition.items.every((item) => item.state === 'pending')
  return <section aria-labelledby={`acquisition-${acquisition.acquisitionId}`} className={styles.results}>
    <header className={styles.resultsHeader}>
      <div>
        <h4 id={`acquisition-${acquisition.acquisitionId}`}>확인한 공유 목록</h4>
        <p aria-live="polite" role="status">{resultSummary(acquisition)}</p>
      </div>
      <span className={styles.batchState} data-state={acquisition.state}>{acquisitionStateLabel[acquisition.state]}</span>
    </header>
    {items.length === 0 ? <p className={styles.emptyResult}>표시할 링크가 없습니다. 링크를 수정해 다시 확인해 주세요.</p> : (
      <ul aria-label="공유 링크 확인 결과" className={styles.resultList}>
        {items.map((item) => <LinkResultRow
          item={item}
          key={item.entryId}
          onDismiss={() => onDismiss(item.entryId)}
          onToggle={() => onToggle(item.entryId)}
          selected={selected.has(item.entryId)}
        />)}
      </ul>
    )}
    <div className={styles.resultActions}>
      {(acquisition.state === 'processing' || acquisition.state === 'failed') && (
        <button disabled={busy} onClick={onRefresh} type="button">상태 새로고침</button>
      )}
      {cancellable && (
        <button disabled={busy} onClick={onCancel} type="button">가져오기 취소</button>
      )}
      <button className={styles.primaryButton} disabled={busy || selectedReady === 0} onClick={onPrepare} type="button">
        선택한 {selectedReady}개 목록 검토
      </button>
    </div>
  </section>
}

function RemoteSession({ previewEnabled, workflow }: Readonly<{
  previewEnabled: boolean
  workflow: ReturnType<typeof useImportAcquisition>
}>) {
  const acquisition = workflow.remote
  const selectedReady = acquisition?.items.filter((item) => item.state === 'ready' && workflow.selected.has(item.entryId)).length ?? 0
  const interaction = acquisition?.interaction
  const integrationGated = interaction?.state === 'integration-gated'
  return <section aria-labelledby="remote-import-title" className={styles.remotePanel}>
    <header className={styles.optionHeading}>
      <div>
        <p className={styles.optionLabel}>비공개 전체 목록</p>
        <h3 id="remote-import-title">일회성 원격 로그인</h3>
      </div>
      <span className={styles.betaBadge}>베타</span>
    </header>
    <p className={styles.optionDescription}>
      현재 PC의 NAVER 로그인을 사용하지 않습니다. 격리된 임시 화면에서 다시 로그인하며,
      완료·취소·만료 시 그 세션을 폐기합니다.
    </p>
    <ul className={styles.boundaries}>
      <li>비밀번호와 쿠키는 곳곳간 데이터로 저장하지 않음</li>
      <li>백그라운드 동기화 없이 이번 한 번만 수집</li>
      <li>보안 확인·CAPTCHA로 중단될 수 있음</li>
    </ul>
    {acquisition === undefined ? (
      <button className={styles.secondaryButton} disabled={!previewEnabled || workflow.busy !== undefined} onClick={() => void workflow.startRemote()} type="button">
        {previewEnabled ? '원격 로그인 베타 확인' : '원격 로그인 준비 중'}
      </button>
    ) : <div className={styles.remoteStatus}>
      <div className={styles.remoteStatusHeading}>
        <strong>{integrationGated ? '운영 연동 준비 중' : acquisitionStateLabel[acquisition.state]}</strong>
        {interaction?.expiresAt !== undefined && <span>만료 {new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(interaction.expiresAt))}</span>}
      </div>
      {integrationGated ? <p aria-live="polite" role="status">격리 세션과 자동 폐기 운영 검증이 끝난 뒤 베타를 열 예정입니다. 현재는 로그인 화면을 만들지 않습니다.</p>
        : <p aria-live="polite" role="status">목록 {acquisition.progress.processed.toLocaleString('ko-KR')} / {acquisition.progress.total.toLocaleString('ko-KR')}개 확인 · {acquisition.progress.ready.toLocaleString('ko-KR')}개 준비</p>}
      <div className={styles.remoteActions}>
        {interaction?.launchUrl !== undefined && interaction.state !== 'integration-gated' && acquisition.state === 'processing' && (
          <a href={interaction.launchUrl} rel="noopener" target="_blank">NAVER 로그인 화면 열기</a>
        )}
        {acquisition.state === 'processing' && <button disabled={workflow.busy !== undefined} onClick={() => void workflow.refresh(acquisition)} type="button">상태 새로고침</button>}
        {(acquisition.state === 'processing' || acquisition.state === 'ready' || acquisition.state === 'partial') && (
          <button disabled={workflow.busy !== undefined} onClick={() => void workflow.cancel(acquisition)} type="button">세션 취소</button>
        )}
        {selectedReady > 0 && acquisition.snapshot !== undefined && <button className={styles.primaryButton} disabled={workflow.busy !== undefined} onClick={() => void workflow.reviewSnapshot(acquisition)} type="button">수집한 목록 검토</button>}
      </div>
    </div>}
  </section>
}

export function ImportAcquisition({
  gateway,
  onSnapshot,
  remotePreviewEnabled = true,
  sharedRuntimeEnabled = true,
}: Readonly<{
  gateway: ImportAcquisitionGateway
  onSnapshot: (snapshot: SourceSnapshot, selectedSourceListIds: ReadonlySet<string>) => void
  remotePreviewEnabled?: boolean
  sharedRuntimeEnabled?: boolean
}>) {
  const workflow = useImportAcquisition(gateway, onSnapshot)
  const sharedProcessing = workflow.shared?.state === 'processing'
  return <section aria-labelledby="import-acquisition-title" className={styles.acquisition}>
    <header className={styles.optionHeading}>
      <div>
        <p className={styles.optionLabel}>NAVER · 권장 방식</p>
        <h3 id="import-acquisition-title">공유 링크로 가져오기</h3>
      </div>
      <span className={styles.recommendedBadge}>설치 없음</span>
    </header>
    <p className={styles.optionDescription}>
      NAVER에서 공유한 목록 링크를 한 줄에 하나씩 붙여넣으세요. 해당 링크의 목록만 읽으며
      NAVER 로그인 정보는 곳곳간으로 보내지 않습니다.
    </p>
    {!sharedRuntimeEnabled && <p className={styles.error} role="status">공유 링크 가져오기는 운영 수집 worker와 요청 제한 정책을 활성화한 뒤 제공됩니다. 현재 화면에서는 입력할 수 없습니다.</p>}
    <label className={styles.linkField} htmlFor="naver-shared-links">
      <span>NAVER 공유 링크</span>
      <textarea
        aria-describedby="naver-shared-links-help"
        disabled={!sharedRuntimeEnabled}
        id="naver-shared-links"
        onChange={(event) => workflow.setDraft(event.target.value)}
        placeholder={'https://naver.me/…\nhttps://naver.me/…'}
        rows={4}
        value={workflow.draft}
      />
    </label>
    <div className={styles.linkFooter}>
      <p id="naver-shared-links-help">최대 {workflow.maximumLinkCount}개 · 공개 또는 일부공개 링크 · 링크 소유 계정은 인증하지 않음</p>
      <button className={styles.primaryButton} disabled={!sharedRuntimeEnabled || workflow.busy !== undefined || sharedProcessing || workflow.links.length === 0} onClick={() => void workflow.startShared()} type="button">
        {workflow.busy === 'shared' || sharedProcessing ? '목록 확인 중…' : workflow.links.length === 0 ? '링크 확인' : `링크 ${workflow.links.length}개 확인`}
      </button>
    </div>
    {workflow.shared !== undefined && <AcquisitionResults
      acquisition={workflow.shared}
      busy={workflow.busy !== undefined}
      items={workflow.visibleSharedItems}
      onCancel={() => void workflow.cancel(workflow.shared!)}
      onDismiss={workflow.dismiss}
      onPrepare={() => void workflow.reviewSnapshot(workflow.shared!)}
      onRefresh={() => void workflow.refresh(workflow.shared!)}
      onToggle={workflow.toggle}
      selected={workflow.selected}
    />}
    {workflow.error !== undefined && <p className={styles.error} role="alert">{workflow.error}</p>}
    <RemoteSession previewEnabled={remotePreviewEnabled} workflow={workflow} />
  </section>
}
