'use client'

import { useCallback, useRef, useState, type Ref } from 'react'
import { ExternalDirectionActions } from '../../../platform/maps/public'

import { PersonalNotes } from './notes/PersonalNotes'
import { PersonalOrganizationEditor } from './organization/PersonalOrganizationEditor'
import { PersonalRatingEditor } from './rating/PersonalRatingEditor'
import { PersonalVisits } from './visits/PersonalVisits'
import styles from './personal-place-detail.module.css'
import { usePersonalPlaceDetailWorkflow } from './personal-place-detail-workflow'
import { BrowserLibraryProblem } from './personal-place-client'
import { PlaceFilingEditor, usePlaceFilingWorkflow } from '../place-filing/public'
import { DraftNavigation, type PersonalPlaceNavigation, type PlaceDraft } from '../draft-navigation/DraftNavigation'

export type PersonalPlaceSummary = Readonly<{
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  primaryTaxonomy: Readonly<{ key?: string; label: string }> | null
  evidenceStatus?: 'verified' | 'unverified' | 'conflicted' | 'stale' | 'unknown'
  sourceLabel?: string
}>

const noChange = () => Promise.resolve()

export function PersonalPlaceDetail({
  placeId,
  summary,
  onChanged = noChange,
  filingEditor,
  filingDraft,
  navigationRef,
}: Readonly<{
  placeId: string
  summary?: PersonalPlaceSummary
  onChanged?: () => Promise<unknown>
  filingEditor?: React.ReactNode
  filingDraft?: PlaceDraft
  navigationRef?: Ref<PersonalPlaceNavigation>
}>) {
  const [tab, setTab] = useState<'overview' | 'records'>('overview')
  const [record, setRecord] = useState<'tags' | 'visits' | 'notes'>()
  const detailTabs = useRef<HTMLElement>(null)
  const recordPanel = useRef<HTMLElement>(null)
  const workflow = usePersonalPlaceDetailWorkflow({ placeId, onChanged })
  const publicDetail = workflow.detail?.status === 'pending' ? undefined : workflow.detail
  const source = workflow.detail?.personalState?.sourceObservedPlace
  const selectedPlace = publicDetail ?? summary ?? (source === undefined ? undefined : {
    name: source.name, areaLabel: source.address, location: source.location, primaryTaxonomy: null,
  })
  const personalState = workflow.authenticationRequired || workflow.accessDenied ? undefined : workflow.detail?.personalState
  const handleFilingFailure = useCallback((status: number) => workflow.handleAccessFailure(new BrowserLibraryProblem(status)), [workflow.handleAccessFailure])
  const defaultFiling = usePlaceFilingWorkflow(filingEditor === undefined && personalState ? placeId : undefined, onChanged, handleFilingFailure)
  const activeFilingDraft = filingDraft ?? (filingEditor === undefined ? {
    label: '목록 선택', dirty: defaultFiling.dirtyCount > 0, saving: defaultFiling.saving, valid: true,
    save: defaultFiling.save, discard: defaultFiling.discard,
  } : undefined)
  const openRecord = (next: 'tags' | 'notes') => {
    setTab('records'); setRecord(next)
    requestAnimationFrame(() => {
      const target = recordPanel.current?.querySelector<HTMLElement>(`[data-record="${next}"] summary`)
      target?.focus({ preventScroll: true })
      const scroller = recordPanel.current?.closest<HTMLElement>('[data-detail-scroll]')
      const tabs = detailTabs.current
      if (scroller && target && tabs) {
        const stickyTop = Number.parseFloat(getComputedStyle(tabs).top) || 0
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top -
          stickyTop - tabs.offsetHeight - 8
      }
    })
  }
  const loginRequired = !workflow.accessDenied && (workflow.authenticationRequired || (
    workflow.detail !== undefined && personalState === undefined
  ))

  return (
    <div className={styles.detailContent}>
      <DraftNavigation navigationRef={navigationRef} drafts={[
        { label: '내 별점', dirty: workflow.ratingDirty, saving: workflow.ratingSaving, valid: workflow.ratingValid,
          save: workflow.saveRating, discard: workflow.discardRating },
        { label: '메모', dirty: workflow.notes.dirty, saving: workflow.notes.saving,
          valid: workflow.notes.bodyValid && !workflow.notes.versionConflict, save: workflow.notes.save, discard: workflow.notes.discardChanges },
        { label: '새 태그', dirty: workflow.tagDraft.trim().length > 0, saving: workflow.organizationMutationKey !== undefined,
          valid: workflow.tagDraft.trim().length > 0 && workflow.tagDraft.trim().length <= 64,
          save: workflow.createTag, discard: workflow.discardTagDraft },
        ...(activeFilingDraft ? [activeFilingDraft] : []),
      ]} />
      {selectedPlace === undefined ? (
        workflow.detail?.status === 'pending' ? (
          <div className={styles.detailHeading}>
            <h2>저장한 장소</h2>
          </div>
        ) : (
          <div className={styles.detailEmpty} role={workflow.loading ? 'status' : undefined}>
            {workflow.loading ? '상세 정보를 불러오는 중…' : '상세 정보를 지금 확인할 수 없습니다.'}
          </div>
        )
      ) : (
        <>
          <div className={styles.detailHeading}>
            {selectedPlace.primaryTaxonomy?.label ? <p>{selectedPlace.primaryTaxonomy.label}</p>
              : source?.categoryLabel && <p>가져온 분류 · {source.categoryLabel}</p>}
            <h2>{selectedPlace.name}</h2>
            {summary?.sourceLabel && <small>{summary.sourceLabel}</small>}
            {!publicDetail && source && <small>가져온 정보</small>}
          </div>
          <div className={styles.detailActions}>
            <ExternalDirectionActions destination={selectedPlace} />
            {personalState !== undefined && <>
              <button type="button" onClick={() => openRecord('tags')}>태그 추가</button>
              <button type="button" onClick={() => openRecord('notes')}>메모 작성</button>
            </>}
          </div>
        </>
      )}
      {personalState !== undefined && (filingEditor ?? <PlaceFilingEditor workflow={defaultFiling} />)}
      {personalState !== undefined && <PersonalRatingEditor workflow={workflow} />}
      <nav aria-label="장소 상세 항목" className={styles.detailTabs} ref={detailTabs} role="tablist">
        {(['overview', 'records'] as const).map((value, index) => <button key={value} type="button" role="tab"
          id={`place-tab-${value}`} aria-controls={`place-panel-${value}`} aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'records' : index ? 'overview' : 'records'
            setTab(next); document.getElementById(`place-tab-${next}`)?.focus()
          }}>{value === 'overview' ? '개요' : '내 기록'}</button>)}
      </nav>
      <section id="place-panel-overview" role="tabpanel" aria-labelledby="place-tab-overview" hidden={tab !== 'overview'}>
        {selectedPlace && (
          <dl className={styles.placeFacts}>
            <div>
              <dt>지역·주소</dt>
              <dd>{publicDetail?.areaLabel ?? source?.address ?? selectedPlace.areaLabel ?? '등록된 주소가 없습니다.'}</dd>
            </div>
          </dl>
        )}

      {workflow.loading && selectedPlace !== undefined && (
        <p className={styles.detailStatus} role="status">내 장소 기능을 불러오는 중…</p>
      )}
      {loginRequired && (
        <section className={styles.accessNotice}>
          <span>로그인하면 이 장소를 저장하고 나만의 기록을 남길 수 있어요.</span>
          <a href="/api/auth/oidc/start">로그인하고 계속</a>
        </section>
      )}
      {workflow.accessDenied && (
        <p className={styles.detailStatus}>현재 계정에서는 개인 기록을 변경할 수 없습니다.</p>
      )}
      {workflow.error !== undefined && (
        <div className={styles.detailError} role="alert">
          <span>{workflow.error}</span>
          <button onClick={() => void workflow.retry()} type="button">다시 시도</button>
        </div>
      )}
      </section>

      <section id="place-panel-records" role="tabpanel" ref={recordPanel} aria-labelledby="place-tab-records" hidden={tab !== 'records'}>
      {personalState !== undefined ? (
        <>
          <details className={styles.recordSection} data-record="tags" open={record === 'tags'}
            onToggle={(event) => { const open = event.currentTarget.open; setRecord((current) => open ? 'tags' : current === 'tags' ? undefined : current) }}><summary>개인 태그</summary>
            <PersonalOrganizationEditor showCollections={false} workflow={workflow} />
          </details>
          <details className={styles.recordSection} open={record === 'visits'}
            onToggle={(event) => { const open = event.currentTarget.open; setRecord((current) => open ? 'visits' : current === 'visits' ? undefined : current) }}><summary>방문 기록</summary><PersonalVisits visits={workflow.visits} /></details>
          <details className={styles.recordSection} data-record="notes" open={record === 'notes'}
            onToggle={(event) => { const open = event.currentTarget.open; setRecord((current) => open ? 'notes' : current === 'notes' ? undefined : current) }}><summary>메모{workflow.notes.dirty ? ' · 저장 전' : ''}</summary><PersonalNotes notes={workflow.notes} /></details>
        </>
      ) : <p className={styles.detailStatus}>{workflow.accessDenied ? '현재 계정에서는 개인 기록을 변경할 수 없습니다.' : '내 기록은 로그인 후 사용할 수 있습니다.'}</p>}
      </section>
    </div>
  )
}
