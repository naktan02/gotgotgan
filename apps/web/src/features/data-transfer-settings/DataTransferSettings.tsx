'use client'

import Link from 'next/link'
import { type ReactNode, useState } from 'react'

import type {
  CapabilityState,
  DataTransferSettingsGateway,
  ImportMapping,
  ImportPlanPreview,
  ProviderCapability,
  ProviderConnection,
  SettingsTab,
  TransferProviderKey,
} from './data-transfer-settings-model'
import styles from './data-transfer-settings.module.css'
import {
  type DataTransferSettingsWorkflow,
  useDataTransferSettings,
} from './data-transfer-settings-workflow'

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

function formatDate(value: string | null): string {
  if (value === null) return '검증 기록 없음'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '검증 시각 확인 불가' : new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

function summaryValue(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ko-KR')
}

function PrivacyNotice() {
  return <p className={styles.notice} role="note">
    장소와 컬렉션 구성만 이동합니다. 개인 메모·방문 기록·개인 사진·개인 평점은 가져오거나
    내보내지 않습니다. 실행 전 미리보기에서 처리 범위를 다시 확인하세요.
  </p>
}

function SectionHeading({ title, description }: Readonly<{ title: string; description: string }>) {
  return <header className={styles.sectionHeading}>
    <div><h2>{title}</h2><p>{description}</p></div>
  </header>
}

function ActionFeedback({ state }: Readonly<{
  state: Readonly<{ kind: 'idle' | 'working' | 'done' }> | Readonly<{ kind: 'error'; message: string }> | undefined
}>) {
  if (state?.kind === 'working') return <p className={styles.actionMessage} role="status">처리 중…</p>
  if (state?.kind === 'done') return <p className={styles.success} role="status">요청을 반영했습니다.</p>
  if (state?.kind === 'error') return <p className={styles.error} role="alert">{state.message}</p>
  return null
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

function FlowRail({ current, labels }: Readonly<{ current: number; labels: readonly string[] }>) {
  return <aside className={styles.flowRail} aria-label="작업 단계">
    <h3>진행 순서</h3>
    <ol className={styles.steps}>{labels.map((label, index) => <li
      aria-current={index + 1 === current ? 'step' : undefined}
      className={index + 1 === current ? styles.currentStep : undefined}
      key={label}
    ><span>{index + 1}</span>{label}</li>)}</ol>
  </aside>
}

function ProviderFields({
  providerKey,
  connectionId,
  workflow,
  onProvider,
  onConnection,
  operation,
}: Readonly<{
  providerKey: TransferProviderKey
  connectionId: string
  workflow: DataTransferSettingsWorkflow
  onProvider: (key: TransferProviderKey) => void
  onConnection: (value: string) => void
  operation: 'import' | 'export'
}>) {
  const provider = workflow.overview?.providers.find((item) => item.capability.providerKey === providerKey)
  const connections = provider?.connections.filter((item) => item.state === 'ready') ?? []
  const capability = operation === 'import' ? provider?.capability.import : provider?.capability.export
  return <>
    <label className={styles.field}>서비스
      <select value={providerKey} onChange={(event) => onProvider(event.target.value as TransferProviderKey)}>
        {workflow.overview?.providers.map((item) => <option key={item.capability.providerKey} value={item.capability.providerKey}>{item.capability.label}</option>)}
      </select>
    </label>
    <label className={styles.field}>연결 계정
      <select disabled={connections.length === 0} value={connectionId} onChange={(event) => onConnection(event.target.value)}>
        {connections.length === 0 && <option value="">사용 가능한 연결 없음</option>}
        {connections.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.accountLabel ?? '이름 없는 계정'}</option>)}
      </select>
    </label>
    {capability?.state !== 'available' && <p className={styles.blocked} role="note">
      {capability?.label ?? '현재 이 작업을 사용할 수 없습니다.'}
      {capability?.reason && ` — ${capability.reason}`}
      {capability?.alternative && ` ${capability.alternative}`}
    </p>}
  </>
}

function updateMappingKind(
  mapping: ImportMapping,
  kind: 'new' | 'existing',
  workflow: DataTransferSettingsWorkflow,
): ImportMapping {
  if (kind === 'new') {
    const source = workflow.snapshot?.lists.find((item) => item.sourceListId === mapping.sourceListId)
    return { ...mapping, target: { kind: 'new', collectionId: crypto.randomUUID(), name: source?.name ?? '새 컬렉션' } }
  }
  const collection = workflow.overview?.collections[0]
  if (collection === undefined) return mapping
  return { ...mapping, target: {
    kind: 'existing', collectionId: collection.collectionId,
    expectedCollectionRevision: collection.collectionRevision,
  } }
}

function ImportTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
  const provider = workflow.overview?.providers.find((item) => item.capability.providerKey === workflow.importProvider)
  const available = provider?.capability.import.state === 'available'
  const currentStep = workflow.importPreview === undefined ? workflow.snapshot === undefined ? 1 : 3 : workflow.importApproval.kind === 'done' ? 5 : 4
  const operation = workflow.providerOperations[workflow.importProvider]
  return <>
    <SectionHeading title="데이터 가져오기" description="외부 서비스에서 관찰된 목록을 선택해 내 컬렉션으로 매핑합니다." />
    <div className={styles.flow}>
      <FlowRail current={currentStep} labels={['서비스·계정', '스냅샷·목록', '컬렉션 연결', '매칭 검토', '승인']} />
      <section className={styles.flowMain} aria-labelledby="import-flow-title">
        <h3 id="import-flow-title">즐겨찾기 가져오기</h3>
        <div className={styles.fieldGrid}><ProviderFields
          connectionId={workflow.importConnectionId}
          onConnection={workflow.setImportConnectionId}
          onProvider={workflow.changeImportProvider}
          operation="import"
          providerKey={workflow.importProvider}
          workflow={workflow}
        /></div>
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} disabled={!available || workflow.importConnectionId === '' || workflow.importState.kind === 'working'} onClick={() => void workflow.acquireSnapshot()} type="button">
            저장된 스냅샷 불러오기
          </button>
          <button aria-describedby="capture-start-help" className={styles.secondaryButton} disabled type="button">
            새 수집 시작
          </button>
        </div>
        <p className={styles.notice} id="capture-start-help">새 수집은 검증된 Connector가 manifest를 만든 뒤 시작합니다. Web에서는 수집 작업을 가장하지 않고, 생성된 작업과 저장된 스냅샷만 확인합니다.</p>
        <ActionFeedback state={workflow.importState} />

        {workflow.snapshot !== undefined && <section className={styles.subsection} aria-labelledby="source-lists-title">
          <header className={styles.subsectionHeader}><h4 id="source-lists-title">외부 목록과 목적지</h4><span>{workflow.snapshot.lists.length.toLocaleString('ko-KR')} / {(workflow.snapshot.totalListCount ?? workflow.snapshot.lists.length).toLocaleString('ko-KR')}개 목록 · {formatDate(workflow.snapshot.capturedAt)} 관찰</span></header>
          {workflow.snapshot.hasUnloadedLists === true && <p className={styles.blocked} role="alert">이 스냅샷에는 현재 화면에서 불러오지 못한 목록이 있습니다. 목록 페이지 조회 계약이 연결되기 전에는 일부 목록만으로 가져오기를 승인할 수 없습니다.</p>}
          <ul className={styles.mappingList}>{workflow.snapshot.lists.map((list) => {
            const mapping = workflow.mappings.find((item) => item.sourceListId === list.sourceListId)
            if (mapping === undefined) return null
            return <li className={styles.mappingRow} key={list.sourceListId}>
              <label className={styles.mappingSource}>
                <input checked={mapping.selected} onChange={() => workflow.updateMapping(list.sourceListId, (current) => ({ ...current, selected: !current.selected }))} type="checkbox" />
                <span><strong>{list.name}</strong><small>{list.itemCount}개 · 확인 필요 {list.unresolvedItemCount}개</small></span>
              </label>
              <label><span className={styles.visuallyHidden}>{list.name} 목적지 유형</span><select
                disabled={!mapping.selected}
                onChange={(event) => workflow.updateMapping(list.sourceListId, (current) => updateMappingKind(current, event.target.value as 'new' | 'existing', workflow))}
                value={mapping.target.kind}
              ><option value="new">새 컬렉션</option><option disabled={(workflow.overview?.collections.length ?? 0) === 0} value="existing">기존 컬렉션</option></select></label>
              {mapping.target.kind === 'new'
                ? <label><span className={styles.visuallyHidden}>{list.name} 새 컬렉션 이름</span><input disabled={!mapping.selected} onChange={(event) => workflow.updateMapping(list.sourceListId, (current) => current.target.kind === 'new' ? { ...current, target: { ...current.target, name: event.target.value } } : current)} value={mapping.target.name} /></label>
                : <label><span className={styles.visuallyHidden}>{list.name} 기존 컬렉션</span><select disabled={!mapping.selected} onChange={(event) => workflow.updateMapping(list.sourceListId, (current) => {
                  const collection = workflow.overview?.collections.find((item) => item.collectionId === event.target.value)
                  return collection === undefined ? current : { ...current, target: { kind: 'existing', collectionId: collection.collectionId, expectedCollectionRevision: collection.collectionRevision } }
                })} value={mapping.target.collectionId}>{workflow.overview?.collections.map((collection) => <option key={collection.collectionId} value={collection.collectionId}>{collection.name}</option>)}</select></label>}
            </li>
          })}</ul>
          <div className={styles.buttonRow}><button className={styles.primaryButton} disabled={workflow.importState.kind === 'working' || workflow.snapshot.hasUnloadedLists === true} onClick={() => void workflow.previewImport()} type="button">매칭 미리보기</button></div>
        </section>}

        {workflow.importPreview !== undefined && <section className={styles.subsection} aria-labelledby="import-preview-title">
          <header className={styles.subsectionHeader}><h4 id="import-preview-title">매칭 검토</h4><span>승인 전 데이터</span></header>
          <dl className={styles.summary}>
            <div><dt>추가 예정</dt><dd>{summaryValue(workflow.importPreview.summary.add)}</dd></div>
            <div><dt>이미 존재</dt><dd>{summaryValue(workflow.importPreview.summary.alreadyPresent)}</dd></div>
            <div><dt>확인 필요</dt><dd>{summaryValue(workflow.importPreview.summary.reviewRequired)}</dd></div>
            <div><dt>처리 불가</dt><dd>{summaryValue(workflow.importPreview.summary.unsupported)}</dd></div>
          </dl>
          {(workflow.importPreview.summary.alreadyPresent === null || workflow.importPreview.summary.unsupported === null) && <p className={styles.notice}>대상 컬렉션의 중복·처리 불가 세부 수량은 현재 백엔드가 제공하지 않아 ‘—’로 표시합니다.</p>}
          {workflow.importPreview.matches.some((item) => item.status === 'review-required') && <ul className={styles.previewItems} aria-label="매칭 확인이 필요한 장소">
            {workflow.importPreview.matches.filter((item) => item.status === 'review-required').map((item) => <ImportMatchDecision item={item} key={`${item.sourceListId}:${item.sourceItemId}`} workflow={workflow} />)}
          </ul>}
          {!workflow.importPreview.approvalEligible && <p className={styles.blocked}>{workflow.importPreview.approvalReason ?? '확인이 필요한 장소를 먼저 해결해 주세요.'}</p>}
          <div className={styles.buttonRow}><button className={styles.primaryButton} disabled={!workflow.importPreview.approvalEligible || workflow.importApproval.kind === 'working'} onClick={() => void workflow.approveImport()} type="button">이 범위로 가져오기 승인</button></div>
          <ActionFeedback state={workflow.importApproval} />
          {workflow.importApproval.kind === 'done' && <p className={operation?.receipt.state === 'completed' ? styles.success : styles.blocked}>{operation?.receipt.state === 'completed'
            ? '가져오기를 완료했습니다.'
            : operation?.receipt.state === 'applying'
              ? '가져오기를 적용 중입니다. 같은 요청을 새로 만들지 말고 작업 내역에서 이어서 확인하세요.'
              : '가져오기가 차단되었거나 추가 확인이 필요합니다.'} <Link href="/settings?tab=history">작업 내역에서 상태 확인</Link></p>}
        </section>}
        <PrivacyNotice />
      </section>
    </div>
  </>
}

function ImportMatchDecision({ item, workflow }: Readonly<{
  item: ImportPlanPreview['matches'][number]
  workflow: DataTransferSettingsWorkflow
}>) {
  const stateKey = `${item.sourceListId}:${item.sourceItemId}`
  const state = workflow.importDecisions[stateKey]
  return <li>
    <div><strong>{item.sourceName}</strong><small>{item.sourceAddress ?? '주소 정보 없음'} · {item.sourceListName}</small></div>
    <div className={styles.decisionActions}>
      <button disabled={state?.kind === 'working'} onClick={() => void workflow.decideImportItem(item.sourceListId, item.sourceItemId, { kind: 'skip' })} type="button">건너뛰기</button>
    </div>
    <p className={styles.blocked}>외부 장소 식별자와 안전한 연결 가능 근거가 없어 임의 장소 연결은 막았습니다. 현재는 건너뛴 뒤 재수집할 수 있습니다.</p>
    <ActionFeedback state={state} />
  </li>
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

export function DataTransferSettingsView({ historyPanel, workflow }: Readonly<{
  historyPanel: ReactNode
  workflow: DataTransferSettingsWorkflow
}>) {
  return <section className={styles.workspace} aria-labelledby="settings-title">
    <header className={styles.header}><p className={styles.eyebrow}>SETTINGS</p><h1 id="settings-title">설정</h1><p>계정과 데이터, 외부 서비스 연동을 관리합니다.</p></header>
    <nav className={styles.tabs} aria-label="설정 항목" role="tablist">
      {tabs.map((item) => <button aria-controls={`settings-panel-${item.key}`} aria-selected={workflow.tab === item.key} className={workflow.tab === item.key ? styles.activeTab : undefined} id={`settings-tab-${item.key}`} key={item.key} onClick={() => workflow.setTab(item.key)} role="tab" type="button">{item.label}</button>)}
    </nav>
    <div aria-labelledby={`settings-tab-${workflow.tab}`} className={styles.content} id={`settings-panel-${workflow.tab}`} role="tabpanel">
      {workflow.tab === 'history' ? historyPanel : workflow.loadState !== 'ready' ? <LoadState workflow={workflow} /> : workflow.tab === 'connections'
        ? <ConnectionsTab workflow={workflow} /> : workflow.tab === 'import'
          ? <ImportTab workflow={workflow} /> : workflow.tab === 'export'
            ? <ExportTab workflow={workflow} /> : <SimpleTab tab={workflow.tab} />}
    </div>
  </section>
}

export function DataTransferSettings({ gateway, historyPanel, initialTab }: Readonly<{
  gateway: DataTransferSettingsGateway
  historyPanel: ReactNode
  initialTab?: SettingsTab
}>) {
  return <DataTransferSettingsView historyPanel={historyPanel} workflow={useDataTransferSettings(gateway, initialTab)} />
}
