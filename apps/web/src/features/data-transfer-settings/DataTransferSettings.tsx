'use client'

import Link from 'next/link'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'

import type {
  DataTransferSettingsGateway,
  ProviderCapability,
  ProviderConnection,
  SettingsTab,
  TransferProviderKey,
} from './data-transfer-settings-model'
import styles from './data-transfer-settings.module.css'
import {
  ActionFeedback,
  FlowRail,
  formatDate,
  PrivacyNotice,
  ProviderFields,
  SectionHeading,
  summaryValue,
} from './data-transfer-settings-view-parts'
import {
  type DataTransferSettingsWorkflow,
  useDataTransferSettings,
} from './data-transfer-settings-workflow'
import { ImportAcquisition } from './import-acquisition/ImportAcquisition'
import { importAcquisitionGateway } from './import-acquisition/import-acquisition-client'
import { ImportTab } from './import-review/ImportReview'

const tabs: readonly Readonly<{ key: SettingsTab; label: string }>[] = [
  { key: 'account', label: '계정' },
  { key: 'connections', label: '연결된 계정' },
  { key: 'import', label: '데이터 이동' },
  { key: 'profile', label: '공개 프로필' },
]

const dataTabs: typeof tabs = [
  { key: 'import', label: '데이터 가져오기' },
  { key: 'export', label: '데이터 내보내기' },
  { key: 'history', label: '작업 내역' },
]

const providerMark: Record<TransferProviderKey, string> = {
  naver: 'N', google: 'G', kakao: 'K',
}

const connectionStateLabel: Record<ProviderConnection['state'], string> = {
  ready: '연결됨',
  'action-required': '확인 필요',
  revoked: '연결 해제됨',
  disconnected: '연결 안 됨',
  unavailable: '연결 미지원',
}

const authMethodLabel: Record<ProviderConnection['authMethod'], string> = {
  'browser-session': '브라우저 세션',
  'managed-profile': '관리형 브라우저 프로필',
  oauth: 'OAuth',
  'account-export': '계정 내보내기 파일',
  'manual-file': '파일 업로드',
}

function ProviderCard({
  capability,
  connections,
  action,
  onCommand,
}: Readonly<{
  capability: ProviderCapability
  connections: readonly ProviderConnection[]
  action: DataTransferSettingsWorkflow['providerActions'][TransferProviderKey]
  onCommand: DataTransferSettingsWorkflow['connectionCommand']
}>) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections.find((item) => item.state === 'ready')?.connectionId ?? connections[0]?.connectionId ?? '')
  const connection = connections.find((item) => item.connectionId === selectedConnectionId) ?? connections.find((item) => item.state === 'ready') ?? connections[0]
  const providerKey = capability.providerKey
  const isWorking = action?.kind === 'working'
  const canConnect = capability.connectionState === 'available' && capability.authMethods.length > 0 && connection === undefined
  const connectionEnabled = capability.connectionState === 'available'

  return <article className={styles.providerCard} aria-labelledby={`provider-${providerKey}`}>
    <header className={styles.providerHeader}>
      <span className={`${styles.providerMark} ${styles[providerKey]}`} aria-hidden="true">
        {providerMark[providerKey]}
      </span>
      <strong id={`provider-${providerKey}`}>{capability.label}</strong>
      <span className={styles.state} data-state={connectionEnabled ? connection?.state ?? 'disconnected' : 'unavailable'}>
        {connectionEnabled ? connectionStateLabel[connection?.state ?? 'disconnected']
          : capability.connectionState === 'integration-gated' ? '연결 기능 꺼짐' : '연결 미지원'}
      </span>
    </header>
    <p className={styles.account}>
      {connections.length === 0 ? '연결된 계정 없음' : connections.length === 1 ? (connection?.accountLabel ?? '이름 없는 계정') : <label>
        <span className={styles.visuallyHidden}>{capability.label} 관리할 연결 계정</span>
        <select onChange={(event) => setSelectedConnectionId(event.target.value)} value={connection?.connectionId ?? ''}>
          {connections.map((item) => <option key={item.connectionId} value={item.connectionId}>{item.accountLabel ?? '이름 없는 계정'}</option>)}
        </select>
      </label>}
      {connections.length > 1 && <small>{connections.length}개 계정의 연결 기록</small>}
    </p>
    <dl className={styles.facts}>
      <div><dt>인증 방식</dt><dd>{connection === undefined
        ? capability.authMethods.length === 0 ? '지원 인증 방식 없음' : capability.authMethods.map((item) => authMethodLabel[item]).join(' · ')
        : authMethodLabel[connection.authMethod]}</dd></div>
      <div><dt>최근 검증</dt><dd>{formatDate(connection?.lastVerifiedAt ?? null)}</dd></div>
    </dl>
    {capability.connectionState !== 'available' && <p className={styles.blocked}>
      {capability.connectionState === 'integration-gated'
        ? '계정 연결은 운영 연동이 활성화된 뒤 사용할 수 있습니다.'
        : '이 서비스의 계정 연결은 현재 지원하지 않습니다.'}
    </p>}
    {connectionEnabled && <div className={styles.cardActions}>
      {connection === undefined
        ? <button disabled={!canConnect || isWorking} onClick={() => void onCommand(providerKey, 'connect')} type="button">계정 연결</button>
        : <>
          <button disabled={isWorking || capability.connectionState !== 'available'} onClick={() => void onCommand(providerKey, 'reconnect', connection)} type="button">
            {connection.state === 'ready' ? '재인증' : '인증 계속'}
          </button>
          <button disabled={isWorking || connection.state === 'revoked'} onClick={() => void onCommand(providerKey, 'disconnect', connection)} type="button">연결 해제</button>
        </>}
    </div>}
    <ActionFeedback state={action} />
  </article>
}

function ConnectionsTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  return <>
    <SectionHeading title="연결된 계정" description="계정 소유를 확인한 연결과 최근 검증 기록을 관리합니다." />
    {workflow.overview?.providers.length === 0 && <p className={styles.notice} role="status">현재 연결 정보를 제공하는 서비스가 없습니다.</p>}
    <div className={styles.providerGrid}>
      {workflow.overview?.providers.map(({ capability, connections }) => <ProviderCard
        action={workflow.providerActions[capability.providerKey]}
        capability={capability}
        connections={connections}
        key={capability.providerKey}
        onCommand={workflow.connectionCommand}
      />)}
    </div>
    <p className={styles.notice} role="note">
      공유 링크로 가져온 목록은 연결 계정으로 등록되지 않습니다. 계정 연결 기록이 있어도
      자동 동기화가 켜졌다는 뜻은 아닙니다. <button className={styles.textButton} onClick={() => workflow.setTab('import')} type="button">일회성 가져오기는 데이터 이동에서</button>
    </p>
  </>
}

function ExportTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  const provider = workflow.overview?.providers.find((item) => item.capability.providerKey === workflow.exportProvider)
  const available = provider?.capability.export.state === 'available'
  const collection = workflow.selectedExportCollection
  const currentStep = workflow.exportPreview === undefined ? 1 : workflow.exportApproval.kind === 'done' ? 5 : 4
  if (workflow.exportPreview === undefined && !workflow.overview?.providers.some((item) => item.capability.export.state === 'available')) {
    return <><SectionHeading title="데이터 내보내기" description="현재 지원되는 내보내기 방식만 사용할 수 있습니다." />
      <section className={styles.panel} role="status"><h3>현재 사용할 수 있는 내보내기 방식이 없습니다.</h3>
        <p>목록을 선택하거나 계정을 연결해도 비활성인 내보내기를 실행할 수는 없습니다.</p>
        <ul className={styles.supportList}>{workflow.overview?.providers.map(({ capability }) => <li key={capability.providerKey}>
          <strong>{capability.label}</strong><span>{capability.export.label}{capability.export.reason && ` — ${capability.export.reason}`}</span>
        </li>)}</ul><button className={styles.secondaryButton} onClick={() => workflow.setTab('history')} type="button">기존 작업 내역 확인</button>
      </section></>
  }
  if (workflow.exportPreview === undefined && workflow.overview?.collections.length === 0) {
    return <section className={styles.statePanel}><strong>내보낼 컬렉션이 없습니다.</strong>
      <p>내 곳곳간에서 장소를 컬렉션에 저장한 뒤 다시 확인해 주세요.</p><Link href="/library">내 곳곳간으로 이동</Link></section>
  }
  return <>
    <SectionHeading title="데이터 내보내기" description="내 컬렉션과 장소 범위를 고른 뒤 대상 서비스의 변경 미리보기를 승인합니다." />
    <div className={styles.flow}>
      <FlowRail current={currentStep} labels={['컬렉션·장소', '서비스·계정', '대상 목록', '변경 검토', '승인']} />
      <section className={styles.flowMain} aria-labelledby="export-flow-title">
        <h3 id="export-flow-title">컬렉션 내보내기</h3>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>내 컬렉션
            <select value={workflow.exportCollectionId} onChange={(event) => workflow.setExportCollectionId(event.target.value)}>
              {(workflow.overview?.collections.length ?? 0) === 0 && <option value="">내 컬렉션 없음</option>}
              {workflow.overview?.collections.map((item) => <option key={item.collectionId} value={item.collectionId}>{item.name} ({item.placeCount})</option>)}
            </select>
          </label>
          <label className={styles.field}>장소 범위
            <select value={workflow.exportSelectionKind} onChange={(event) => workflow.setExportSelectionKind(event.target.value as 'all' | 'places')}>
              <option value="all">컬렉션 전체</option>
              <option value="places">장소 직접 선택</option>
            </select>
          </label>
        </div>
        {workflow.exportSelectionKind === 'places' && <fieldset className={styles.subsection}>
          <legend>내보낼 장소</legend>
          {workflow.exportCollectionState === 'loading' && <p className={styles.notice}>컬렉션 장소를 불러오는 중입니다.</p>}
          {workflow.exportCollectionState === 'error' && <p className={styles.blocked}>컬렉션 장소를 불러오지 못했습니다. 컬렉션 전체 내보내기를 선택하거나 다시 시도해 주세요.</p>}
          <ul className={styles.placeChoices}>{collection?.places.map((place) => <li key={place.placeId}><label><input checked={workflow.exportPlaceIds.has(place.placeId)} onChange={() => workflow.toggleExportPlace(place.placeId)} type="checkbox" />{place.name}</label></li>)}</ul>
          {collection !== undefined && collection.placeCount > collection.places.length && <p className={styles.notice}>화면에는 먼저 불러온 {collection.places.length}개 장소만 표시합니다. 선택한 장소만 명시적으로 내보냅니다.</p>}
        </fieldset>}
        <div className={styles.fieldGrid}><ProviderFields
          connectionId={workflow.exportConnectionId}
          onConnection={workflow.setExportConnectionId}
          onProvider={workflow.changeExportProvider}
          operation="export"
          providerKey={workflow.exportProvider}
          workflow={workflow}
        /></div>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>대상 목록 방식
            <select value={workflow.targetKind} onChange={(event) => workflow.setTargetKind(event.target.value as 'new' | 'existing')}>
              <option value="new">새 목록 만들기</option>
              <option disabled={workflow.targetLists?.state !== 'available' || workflow.targetLists.items.length === 0} value="existing">기존 목록 선택</option>
            </select>
          </label>
          {workflow.targetKind === 'new' ? <label className={styles.field}>새 목록 이름
            <input maxLength={120} onChange={(event) => workflow.setTargetListName(event.target.value)} value={workflow.targetListName} />
          </label> : <label className={styles.field}>기존 대상 목록
            <select value={workflow.targetListId} onChange={(event) => workflow.setTargetListId(event.target.value)}>
              <option value="">목록 선택</option>
              {workflow.targetLists?.items.map((item) => <option key={item.targetListId} value={item.targetListId}>{item.name}{item.itemCount === null ? '' : ` (${item.itemCount})`}</option>)}
            </select>
          </label>}
        </div>
        {workflow.targetListState === 'loading' && <p className={styles.notice}>대상 서비스의 목록을 확인하는 중입니다.</p>}
        {workflow.targetListState === 'error' && <p className={styles.blocked}>대상 목록을 불러오지 못했습니다. 새 목록 내보내기만 선택할 수 있습니다.</p>}
        {workflow.targetLists?.state === 'unavailable' && <p className={styles.blocked}>기존 대상 목록 조회를 지원하지 않습니다. 새 목록을 선택해 주세요.</p>}
        <div className={styles.buttonRow}><button className={styles.primaryButton} disabled={!available || workflow.exportConnectionId === '' || collection === undefined || workflow.exportState.kind === 'working'} onClick={() => void workflow.previewExport()} type="button">변경 미리보기</button></div>
        <ActionFeedback state={workflow.exportState} />

        {workflow.exportPreview !== undefined && <section className={styles.subsection} aria-labelledby="export-preview-title">
          <header className={styles.subsectionHeader}><h4 id="export-preview-title">대상 서비스 변경 검토</h4><span>{workflow.exportPreview.state === 'blocked' ? '실행 불가' : '승인 대기'}</span></header>
          <dl className={styles.summary}>
            <div><dt>추가 예정</dt><dd>{summaryValue(workflow.exportPreview.summary.add)}</dd></div>
            <div><dt>이미 존재</dt><dd>{summaryValue(workflow.exportPreview.summary.alreadyPresent)}</dd></div>
            <div><dt>미해결</dt><dd>{summaryValue(workflow.exportPreview.summary.unresolved)}</dd></div>
            <div><dt>처리 불가</dt><dd>{summaryValue(workflow.exportPreview.summary.unsupported)}</dd></div>
          </dl>
          {workflow.exportPreview.state === 'blocked' && <p className={styles.blocked}>{workflow.exportPreview.blockedReason ?? '대상 서비스가 현재 내보내기를 지원하지 않습니다.'}</p>}
          <div className={styles.buttonRow}><button className={styles.primaryButton} disabled={!workflow.exportPreview.approvalEligible || workflow.exportPreview.state === 'blocked' || workflow.exportApproval.kind === 'working'} onClick={() => void workflow.approveExport()} type="button">이 변경으로 내보내기 승인</button></div>
          <ActionFeedback state={workflow.exportApproval} />
          {workflow.exportApproval.kind === 'done' && <p className={styles.success}>내보내기 범위 승인을 기록했습니다. 외부 서비스 실행 완료가 아닙니다. <Link href="/settings?tab=history">작업 내역에서 상태 확인</Link></p>}
        </section>}
        <PrivacyNotice />
      </section>
    </div>
  </>
}

function SimpleTab({ tab }: Readonly<{ tab: Extract<SettingsTab, 'account' | 'profile'> }>) {
  const content = {
    account: { title: '계정', description: '로그인 계정은 공통 상단에서, 공개 닉네임과 주소는 공개 프로필에서 관리합니다.', link: '/profile', action: '공개 닉네임과 주소 관리' },
    profile: { title: '공개 프로필', description: '공개 목록의 작성자 이름과 공개 범위는 프로필 화면에서 관리합니다.', link: '/profile', action: '공개 프로필 관리' },
  }[tab]
  return <><SectionHeading title={content.title} description={content.description} /><div className={styles.accountGrid}>
    <section className={styles.panel}><h3>{content.title}</h3><p>{content.description}</p><Link href={content.link}>{content.action}</Link></section>
    {tab === 'account' && <section className={styles.panel}><h3>로그인 보안</h3><p>외부 서비스 연결과 곳곳간 로그인은 별도입니다. 계정 연결을 해제해도 곳곳간 계정은 삭제되지 않습니다. 로그인과 로그아웃은 상단 계정 영역에서 진행합니다.</p></section>}
  </div></>
}

function LoadState({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  if (workflow.loadState === 'loading') return <section className={styles.statePanel} aria-live="polite"><strong>설정 정보를 불러오는 중입니다.</strong></section>
  if (workflow.loadState === 'authentication-required') return <section className={styles.statePanel}><strong>로그인이 필요합니다.</strong><p>연결 계정과 개인 컬렉션은 로그인한 사용자만 확인할 수 있습니다.</p><Link href="/api/auth/oidc/start">로그인</Link></section>
  if (workflow.loadState === 'forbidden') return <section className={styles.statePanel}><strong>이 설정을 볼 권한이 없습니다.</strong><p>현재 계정의 접근 권한을 확인해 주세요.</p></section>
  return <section className={styles.statePanel} role="alert"><strong>데이터 설정 정보를 불러오지 못했습니다.</strong><p>저장된 데이터가 없다는 뜻은 아닙니다. 잠시 후 다시 시도해 주세요.</p><button onClick={() => void workflow.retry()} type="button">다시 시도</button></section>
}

function SettingsTabs({ items, selected, onSelect, label, idPrefix, secondary = false }: Readonly<{
  items: typeof tabs
  selected: SettingsTab
  onSelect: (tab: SettingsTab) => void
  label: string
  idPrefix: string
  secondary?: boolean
}>) {
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([])
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = items[nextIndex]
    if (next === undefined) return
    onSelect(next.key)
    tabButtons.current[nextIndex]?.focus()
    tabButtons.current[nextIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <nav className={secondary ? styles.dataTabs : styles.tabs} aria-label={label} role="tablist">
      {items.map((item, index) => <button
        aria-controls={`${idPrefix}-panel-${item.key}`}
        aria-selected={selected === item.key}
        className={selected === item.key ? styles.activeTab : undefined}
        id={`${idPrefix}-tab-${item.key}`}
        key={item.key}
        onClick={() => onSelect(item.key)}
        onKeyDown={(event) => moveTabFocus(event, index)}
        ref={(element) => { tabButtons.current[index] = element }}
        role="tab"
        tabIndex={selected === item.key ? 0 : -1}
        type="button"
      >{item.label}</button>)}
    </nav>
}

export function DataTransferSettingsView({ historyPanel, importAcquisitionPanel, workflow }: Readonly<{
  historyPanel: ReactNode
  importAcquisitionPanel: ReactNode
  workflow: DataTransferSettingsWorkflow
}>) {
  const isDataTab = dataTabs.some((item) => item.key === workflow.tab)
  const selectedTab = isDataTab ? 'import' : workflow.tab
  const lastDataTab = useRef<SettingsTab>('import')
  if (isDataTab) lastDataTab.current = workflow.tab
  const panel = workflow.tab === 'history' ? historyPanel
    : workflow.tab === 'account' || workflow.tab === 'profile' ? <SimpleTab tab={workflow.tab} />
      : workflow.loadState !== 'ready' ? <LoadState workflow={workflow} />
        : workflow.tab === 'connections' ? <ConnectionsTab workflow={workflow} />
          : workflow.tab === 'import' ? <ImportTab acquisitionPanel={importAcquisitionPanel} workflow={workflow} />
            : <ExportTab workflow={workflow} />
  return <section className={styles.workspace} aria-labelledby="settings-title">
    <header className={styles.header}><h1 id="settings-title">계정과 데이터 관리</h1><p>계정 연결과 일회성 데이터 이동을 나누어 관리합니다.</p></header>
    <SettingsTabs items={tabs} selected={selectedTab} onSelect={(tab) => workflow.setTab(tab === 'import' ? lastDataTab.current : tab)} label="설정 항목" idPrefix="settings" />
    <div aria-labelledby={`settings-tab-${selectedTab}`} className={styles.content} id={`settings-panel-${selectedTab}`} role="tabpanel">
      {isDataTab ? <>
        <SettingsTabs items={dataTabs} selected={workflow.tab} onSelect={workflow.setTab} label="데이터 이동 작업" idPrefix="settings-data" secondary />
        <div aria-labelledby={`settings-data-tab-${workflow.tab}`} id={`settings-data-panel-${workflow.tab}`} role="tabpanel">{panel}</div>
      </> : panel}
    </div>
  </section>
}

export function DataTransferSettings({ gateway, historyPanel, remoteImportPreviewEnabled = true, sharedImportRuntimeEnabled = true, initialTab }: Readonly<{
  gateway: DataTransferSettingsGateway
  historyPanel: ReactNode
  remoteImportPreviewEnabled?: boolean
  sharedImportRuntimeEnabled?: boolean
  initialTab?: SettingsTab
}>) {
  const workflow = useDataTransferSettings(gateway, initialTab)
  return <DataTransferSettingsView
    historyPanel={historyPanel}
    importAcquisitionPanel={<ImportAcquisition
      gateway={importAcquisitionGateway}
      onSnapshot={workflow.acceptAcquiredSnapshot}
      remotePreviewEnabled={remoteImportPreviewEnabled}
      sharedRuntimeEnabled={sharedImportRuntimeEnabled}
    />}
    workflow={workflow}
  />
}
