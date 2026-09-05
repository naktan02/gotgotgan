import Link from 'next/link'

import type { ImportMapping, ImportPlanPreview } from '../data-transfer-settings-model'
import styles from '../data-transfer-settings.module.css'
import {
  ActionFeedback,
  FlowRail,
  formatDate,
  PrivacyNotice,
  ProviderFields,
  SectionHeading,
  summaryValue,
} from '../data-transfer-settings-view-parts'
import type { DataTransferSettingsWorkflow } from '../data-transfer-settings-workflow'

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

export function ImportTab({ workflow }: Readonly<{ workflow: DataTransferSettingsWorkflow }>) {
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
          <p className={styles.notice} role="status">목록에서 가져온 기본 장소 정보로 저장합니다. 메뉴 등 상세정보 보강은 현재 보류 중이며, 가져오기 완료와 별개입니다.</p>
          {workflow.importPreview.providerDetails.pending + workflow.importPreview.providerDetails.unavailable > 0 && <p className={styles.notice}>상세정보 미보유 {summaryValue(workflow.importPreview.providerDetails.pending + workflow.importPreview.providerDetails.unavailable)}개 항목 · 상세정보가 없어도 기본 정보가 유효한 장소는 저장할 수 있습니다.</p>}
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
    <p className={styles.blocked}>기본 장소 정보나 연결 상태를 확인해야 합니다. 임의 장소 연결은 막았으며, 현재는 건너뛴 뒤 재수집할 수 있습니다.</p>
    <ActionFeedback state={state} />
  </li>
}
