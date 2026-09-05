'use client'

import Link from 'next/link'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'

import type {
  CapabilityState,
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
  { key: 'connections', label: '외부 서비스 연결' },
  { key: 'import', label: '데이터 가져오기' },
  { key: 'export', label: '데이터 내보내기' },
  { key: 'history', label: '작업 내역' },
  { key: 'profile', label: '공개 프로필' },
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

const capabilityStateLabel: Record<CapabilityState, string> = {
  available: '사용 가능',
  'manual-file': '파일 방식',
  'integration-gated': '연동 준비 중',
  unavailable: '현재 미지원',
}

function Capability({ label, value }: Readonly<{
  label: string
  value: ProviderCapability['import']
}>) {
  return <div>
    <strong>{label}</strong>
    <span>{value.label || capabilityStateLabel[value.state]}</span>
  </div>
}

function ProviderCard({
  capability,
  connections,
  action,
  operation,
  onCommand,
}: Readonly<{
  capability: ProviderCapability
  connections: readonly ProviderConnection[]
  action: DataTransferSettingsWorkflow['providerActions'][TransferProviderKey]
  operation: DataTransferSettingsWorkflow['providerOperations'][TransferProviderKey]
  onCommand: DataTransferSettingsWorkflow['connectionCommand']
}>) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections.find((item) => item.state === 'ready')?.connectionId ?? connections[0]?.connectionId ?? '')
  const connection = connections.find((item) => item.connectionId === selectedConnectionId) ?? connections.find((item) => item.state === 'ready') ?? connections[0]
  const providerKey = capability.providerKey
  const isWorking = action?.kind === 'working'
  const canConnect = capability.connectionState === 'available' && capability.authMethods.length > 0 && connection === undefined
  const alternative = capability.import.alternative ?? capability.export.alternative

  return <article className={styles.providerCard} aria-labelledby={`provider-${providerKey}`}>
    <header className={styles.providerHeader}>
      <span className={`${styles.providerMark} ${styles[providerKey]}`} aria-hidden="true">
        {providerMark[providerKey]}
      </span>
      <strong id={`provider-${providerKey}`}>{capability.label}</strong>
      <span className={styles.state} data-state={connection?.state ?? 'disconnected'}>
        {connectionStateLabel[connection?.state ?? 'disconnected']}
      </span>
    </header>
    <p className={styles.account}>
      {connections.length === 0 ? '연결된 계정 없음' : connections.length === 1 ? (connection?.accountLabel ?? '이름 없는 계정') : <label>
        <span className={styles.visuallyHidden}>{capability.label} 관리할 연결 계정</span>
        <select onChange={(event) => setSelectedConnectionId(event.target.value)} value={connection?.connectionId ?? ''}>
          {connections.map((item) => <option key={item.connectionId} value={item.connectionId}>{item.accountLabel ?? '이름 없는 계정'}</option>)}
        </select>
      </label>}
      <small>{connections.length > 1 ? `${connections.length}개 계정이 독립적으로 연결됨` : '서비스별 연결 상태를 따로 관리합니다.'}</small>
    </p>
    <dl className={styles.facts}>
      <div><dt>인증 방식</dt><dd>{connection === undefined
        ? capability.authMethods.length === 0 ? '지원 인증 방식 없음' : capability.authMethods.map((item) => authMethodLabel[item]).join(' · ')
        : authMethodLabel[connection.authMethod]}</dd></div>
      <div><dt>최근 검증</dt><dd>{formatDate(connection?.lastVerifiedAt ?? null)}</dd></div>
    </dl>
    <div className={styles.capability}>
      <Capability label="즐겨찾기 가져오기" value={capability.import} />
      <Capability label="컬렉션 내보내기" value={capability.export} />
    </div>
    {(capability.import.reason !== undefined || capability.export.reason !== undefined || alternative !== undefined) &&
      <p className={styles.alternative}>
        {[capability.import.reason, capability.export.reason, alternative].filter(Boolean).join(' · ')}
      </p>}
    {capability.connectionState !== 'available' && <p className={styles.blocked}>
      {capability.connectionState === 'integration-gated'
        ? '계정 연결은 운영 연동이 활성화된 뒤 사용할 수 있습니다.'
        : '이 서비스의 계정 연결은 현재 지원하지 않습니다.'}
    </p>}
    <div className={styles.cardActions}>
      {connection === undefined
        ? <button disabled={!canConnect || isWorking} onClick={() => void onCommand(providerKey, 'connect')} type="button">계정 연결</button>
        : <>
          <button disabled={isWorking || capability.connectionState !== 'available'} onClick={() => void onCommand(providerKey, 'reconnect', connection)} type="button">
            {connection.state === 'ready' ? '재인증' : '인증 계속'}
          </button>
          <button disabled={isWorking || connection.state === 'revoked'} onClick={() => void onCommand(providerKey, 'disconnect', connection)} type="button">연결 해제</button>
        </>}
    </div>
    <ActionFeedback state={action} />
    {operation !== undefined && <p className={styles.operation} role="status">
      {operation.kind === 'import' ? '가져오기' : '내보내기'} 작업: {{
        applying: '적용 중 · 작업 내역에서 이어서 확인',
        completed: '완료',
        approved: '범위 승인 기록됨 · 외부 실행 완료 아님',
        'action-required': '확인 필요',
        blocked: '차단됨',
      }[operation.receipt.state]}
    </p>}
  </article>
}

function ConnectionsTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  return <>
    <SectionHeading title="외부 서비스 연결" description="NAVER·Google·Kakao 계정과 기능 지원 상태를 각각 확인합니다." />
    <div className={styles.providerGrid}>
      {workflow.overview?.providers.map(({ capability, connections }) => <ProviderCard
        action={workflow.providerActions[capability.providerKey]}
        capability={capability}
        connections={connections}
        key={capability.providerKey}
        onCommand={workflow.connectionCommand}
        operation={workflow.providerOperations[capability.providerKey]}
      />)}
    </div>
    <p className={styles.notice} role="note">
      외부 연결은 이미 저장된 즐겨찾기를 곳곳간으로 가져오거나, 명시적으로 승인한 컬렉션을
      내보낼 때만 사용합니다. 가져오기는 외부 서비스의 원본 목록을 수정하지 않습니다.
    </p>
  </>
}

function ExportTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  const provider = workflow.overview?.providers.find((item) => item.capability.providerKey === workflow.exportProvider)
  const available = provider?.capability.export.state === 'available'
  const collection = workflow.selectedExportCollection
  const currentStep = workflow.exportPreview === undefined ? 1 : workflow.exportApproval.kind === 'done' ? 5 : 4
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
    account: { title: '계정', description: '로그인과 기본 계정 정보는 기존 계정 화면에서 관리합니다.', link: '/profile', action: '계정 정보 보기' },
    profile: { title: '공개 프로필', description: '공개 목록의 작성자 이름, 소개와 공개 범위는 프로필 화면에서 관리합니다.', link: '/profile', action: '공개 프로필 관리' },
  }[tab]
  return <><SectionHeading title={content.title} description={content.description} /><div className={styles.accountGrid}>
    <section className={styles.panel}><h3>{content.title}</h3><p>{content.description}</p><Link href={content.link}>{content.action}</Link></section>
    {tab === 'account' && <section className={styles.panel}><h3>로그인 보안</h3><p>외부 서비스 연결과 곳곳간 로그인은 별도입니다. 계정 연결을 해제해도 곳곳간 계정은 삭제되지 않습니다.</p><Link href="/api/auth/logout">로그아웃</Link></section>}
  </div></>
}

function LoadState({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  if (workflow.loadState === 'loading') return <section className={styles.statePanel} aria-live="polite"><strong>설정 정보를 불러오는 중입니다.</strong></section>
  if (workflow.loadState === 'authentication-required') return <section className={styles.statePanel}><strong>로그인이 필요합니다.</strong><p>연결 계정과 개인 컬렉션은 로그인한 사용자만 확인할 수 있습니다.</p><Link href="/api/auth/oidc/start">로그인</Link></section>
  if (workflow.loadState === 'forbidden') return <section className={styles.statePanel}><strong>이 설정을 볼 권한이 없습니다.</strong><p>현재 계정의 접근 권한을 확인해 주세요.</p></section>
  return <section className={styles.statePanel}><strong>설정 서비스를 사용할 수 없습니다.</strong><p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p><button onClick={() => void workflow.retry()} type="button">다시 시도</button></section>
}

export function DataTransferSettingsView({ historyPanel, importAcquisitionPanel, workflow }: Readonly<{
  historyPanel: ReactNode
  importAcquisitionPanel: ReactNode
  workflow: DataTransferSettingsWorkflow
}>) {
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([])
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = tabs[nextIndex]
    if (next === undefined) return
    workflow.setTab(next.key)
    tabButtons.current[nextIndex]?.focus()
    tabButtons.current[nextIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <section className={styles.workspace} aria-labelledby="settings-title">
    <header className={styles.header}><p className={styles.eyebrow}>SETTINGS</p><h1 id="settings-title">설정</h1><p>계정과 데이터, 외부 서비스 연동을 관리합니다.</p></header>
    <nav className={styles.tabs} aria-label="설정 항목" role="tablist">
      {tabs.map((item, index) => <button
        aria-controls={`settings-panel-${item.key}`}
        aria-selected={workflow.tab === item.key}
        className={workflow.tab === item.key ? styles.activeTab : undefined}
        id={`settings-tab-${item.key}`}
        key={item.key}
        onClick={() => workflow.setTab(item.key)}
        onKeyDown={(event) => moveTabFocus(event, index)}
        ref={(element) => { tabButtons.current[index] = element }}
        role="tab"
        tabIndex={workflow.tab === item.key ? 0 : -1}
        type="button"
      >{item.label}</button>)}
    </nav>
    <div aria-labelledby={`settings-tab-${workflow.tab}`} className={styles.content} id={`settings-panel-${workflow.tab}`} role="tabpanel">
      {workflow.tab === 'history' ? historyPanel : workflow.loadState !== 'ready' ? <LoadState workflow={workflow} /> : workflow.tab === 'connections'
        ? <ConnectionsTab workflow={workflow} /> : workflow.tab === 'import'
          ? <ImportTab acquisitionPanel={importAcquisitionPanel} workflow={workflow} /> : workflow.tab === 'export'
            ? <ExportTab workflow={workflow} /> : <SimpleTab tab={workflow.tab} />}
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
