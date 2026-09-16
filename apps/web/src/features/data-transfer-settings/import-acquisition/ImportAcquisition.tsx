'use client'

import type { SourceSnapshot } from '../data-transfer-settings-model'
import type { ImportAcquisition, ImportAcquisitionItem } from './import-acquisition-model'
import type { ImportAcquisitionGateway } from './import-acquisition-model'
import { useImportAcquisition } from './import-acquisition-workflow'
import styles from './import-acquisition.module.css'

const providerLabels = { naver: 'NAVER 지도', google: 'Google Maps', kakao: 'KakaoMap' } as const

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
        <h4 id={`acquisition-${acquisition.acquisitionId}`}>{providerLabels[acquisition.providerKey]} · 확인한 공유 목록</h4>
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
  const available = previewEnabled && workflow.remoteAvailability?.status === 'available'
  return <section aria-labelledby="remote-import-title" className={styles.remotePanel}>
    <header className={styles.optionHeading}>
      <div>
        <p className={styles.optionLabel}>별도 로그인 방식</p>
        <h3 id="remote-import-title">일회성 원격 로그인</h3>
      </div>
      <span className={styles.betaBadge}>{available ? '별도 동의 필요' : '현재 준비 중'}</span>
    </header>
    <p className={styles.optionDescription}>
      사용자 PC의 기존 로그인을 재사용하는 방식이 아닙니다. 별도 서버 로그인 세션의
      격리·보관·자동 폐기 검증이 필요하며, 현재 로그인 화면은 제공하지 않습니다.
    </p>
    <ul className={styles.boundaries}>
      <li>서비스별 비공개 목록 수집 가능 여부를 별도로 검증해야 합니다.</li>
      <li>제공 전 별도 동의 절차와 보안 확인·CAPTCHA 대응을 안내합니다.</li>
    </ul>
    {acquisition === undefined ? (
      <button className={styles.secondaryButton} disabled={!available || workflow.busy !== undefined} onClick={() => void workflow.startRemote()} type="button">
        {available ? '원격 로그인 안내 확인' : '원격 로그인 준비 중'}
      </button>
    ) : <div className={styles.remoteStatus}>
      <div className={styles.remoteStatusHeading}>
        <strong>{integrationGated ? '운영 연동 준비 중' : acquisitionStateLabel[acquisition.state]}</strong>
        {interaction?.expiresAt !== undefined && <span>만료 {new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(interaction.expiresAt))}</span>}
      </div>
      {integrationGated ? <p aria-live="polite" role="status">격리 세션과 자동 폐기 운영 검증이 끝난 뒤 베타를 열 예정입니다. 현재는 로그인 화면을 만들지 않습니다.</p>
        : <p aria-live="polite" role="status">목록 {acquisition.progress.processed.toLocaleString('ko-KR')} / {acquisition.progress.total.toLocaleString('ko-KR')}개 확인 · {acquisition.progress.ready.toLocaleString('ko-KR')}개 준비</p>}
      <div className={styles.remoteActions}>
        {available && interaction?.launchUrl !== undefined && interaction.state !== 'integration-gated' && acquisition.state === 'processing' && (
          <a href={interaction.launchUrl} rel="noopener" target="_blank">{providerLabels[acquisition.providerKey]} 로그인 화면 열기</a>
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
  const sharedAvailable = sharedRuntimeEnabled && workflow.sharedAvailability?.status === 'available'
  const providerLabel = providerLabels[workflow.providerKey]
  const unsupported = workflow.sharedAvailability?.status === 'not-implemented'
  return <section aria-labelledby="import-acquisition-title" className={styles.acquisition}>
    <header className={styles.optionHeading}>
      <div>
        <p className={styles.optionLabel}>필요한 목록만 내 곳곳간에</p>
        <h3 id="import-acquisition-title">다른 지도에서 가져오기</h3>
      </div>
      <span className={styles.recommendedBadge}>설치 없음</span>
    </header>
    <fieldset className={styles.providerPicker}>
      <legend>가져올 서비스</legend>
      {(Object.entries(providerLabels) as [keyof typeof providerLabels, string][]).map(([providerKey, label]) => {
        const status = workflow.providers?.find((provider) => provider.providerKey === providerKey)
          ?.methods.find((method) => method.method === 'shared-links')?.availability.status
        const availabilityLabel = status === 'not-implemented' ? '현재 준비 중'
          : status === undefined ? '지원 상태 확인 중'
            : status === 'configuration-required' || !sharedRuntimeEnabled ? '운영 준비 중' : '공유 링크 가능'
        return <button aria-pressed={workflow.providerKey === providerKey} disabled={workflow.busy !== undefined} key={providerKey}
          onClick={() => workflow.setProviderKey(providerKey)} type="button">
          <strong>{label}</strong><small>{availabilityLabel}</small>
        </button>
      })}
    </fieldset>
    <h4 className={styles.methodTitle}>공유 링크로 가져오기</h4>
    <p className={styles.optionDescription}>
      {providerLabel}의 지원되는 목록 링크를 한 줄에 하나씩 붙여넣으세요. 링크별 목록만 읽으며,
      로그인 정보는 보내지 않습니다. 내 계정의 모든 저장 목록을 자동으로 가져오는 기능과는 다릅니다.
    </p>
    {workflow.capabilityError ? <div className={styles.capabilityNotice} role="status">
      지원 상태를 불러오지 못했습니다. <button onClick={workflow.retryCapabilities} type="button">다시 확인</button>
    </div> : !sharedAvailable && <p className={styles.capabilityNotice} role="status">
      {unsupported ? `${providerLabel}은 현재 준비 중입니다. 목록 공유 링크를 서버에서 검증해 읽는 수집 경로가 아직 구현되지 않아 입력을 받지 않습니다.`
        : workflow.sharedAvailability === undefined ? '서비스별 지원 상태를 확인하고 있습니다.'
          : 'NAVER 공유 링크 수집 경로는 구현되어 있지만 운영 수집 worker와 요청 제한 설정이 아직 활성화되지 않았습니다.'}
    </p>}
    <label className={styles.linkField} htmlFor="provider-shared-links">
      <span>{workflow.providerKey === 'naver' ? 'NAVER' : providerLabel} 공유 링크</span>
      <textarea
        aria-describedby="provider-shared-links-help"
        disabled={!sharedAvailable}
        id="provider-shared-links"
        onChange={(event) => workflow.setDraft(event.target.value)}
        placeholder={workflow.providerKey === 'naver' ? 'https://naver.me/…\nhttps://naver.me/…' : '현재 준비 중인 가져오기 방식입니다.'}
        rows={4}
        value={workflow.draft}
      />
    </label>
    <div className={styles.linkFooter}>
      <p id="provider-shared-links-help">같은 서비스의 목록 링크 최대 {workflow.maximumLinkCount}개 · 계정 소유는 인증하지 않음<br />입력 링크는 서버에서 최대 15분 암호화 임시 보관 후 폐기</p>
      <button className={styles.primaryButton} disabled={!sharedAvailable || workflow.busy !== undefined || sharedProcessing || workflow.links.length === 0} onClick={() => void workflow.startShared()} type="button">
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
