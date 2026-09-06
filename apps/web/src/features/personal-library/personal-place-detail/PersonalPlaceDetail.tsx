'use client'

import { useState, type Ref } from 'react'
import { ExternalDirectionActions } from '../../../platform/maps/public'

import { PersonalNotes } from './notes/PersonalNotes'
import { PersonalOrganizationEditor } from './organization/PersonalOrganizationEditor'
import { PersonalRatingEditor } from './rating/PersonalRatingEditor'
import { PersonalVisits } from './visits/PersonalVisits'
import styles from './personal-place-detail.module.css'
import { usePersonalPlaceDetailWorkflow } from './personal-place-detail-workflow'
import { libraryEvidenceLabel } from './place-presentation'
import { DraftNavigation, type PersonalPlaceNavigation, type PlaceDraft } from '../draft-navigation/DraftNavigation'

export type PersonalPlaceSummary = Readonly<{
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
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
  const workflow = usePersonalPlaceDetailWorkflow({ placeId, onChanged })
  const publicDetail = workflow.detail?.status === 'pending' ? undefined : workflow.detail
  const source = workflow.detail?.personalState?.sourceObservedPlace
  const selectedPlace = publicDetail ?? summary ?? (source === undefined ? undefined : {
    name: source.name, areaLabel: source.address, location: source.location, primaryTaxonomy: null,
  })
  const evidenceStatus = publicDetail?.evidence.status ?? summary?.evidenceStatus
  const personalState = workflow.detail?.personalState
  const loginRequired = workflow.authenticationRequired || (
    workflow.detail !== undefined && personalState === undefined
  )

  return (
    <div className={styles.detailContent}>
      <DraftNavigation navigationRef={navigationRef} drafts={[
        { label: '내 별점', dirty: workflow.ratingDirty, saving: workflow.ratingSaving, valid: workflow.ratingValid,
          save: workflow.saveRating, discard: workflow.discardRating },
        { label: '메모', dirty: workflow.notes.dirty, saving: workflow.notes.saving,
          valid: workflow.notes.bodyValid && !workflow.notes.versionConflict, save: workflow.notes.save, discard: workflow.notes.discardChanges },
        ...(filingDraft ? [filingDraft] : []),
      ]} />
      {selectedPlace === undefined ? (
        workflow.detail?.status === 'pending' ? (
          <div className={styles.detailHeading}>
            <p>분류 미확인</p>
            <h2>저장한 장소</h2>
            <span>기본 정보가 아직 연결되지 않았어요.</span>
          </div>
        ) : (
          <div className={styles.detailEmpty} role={workflow.loading ? 'status' : undefined}>
            {workflow.loading ? '상세 정보를 불러오는 중…' : '상세 정보를 지금 확인할 수 없습니다.'}
          </div>
        )
      ) : (
        <>
          <div className={styles.detailHeading}>
            <p>{publicDetail || summary ? selectedPlace.primaryTaxonomy?.label ?? '분류 미확인' : '가져온 정보'}</p>
            <h2>{selectedPlace.name}</h2>
            <span>
              {summary?.sourceLabel === undefined ? '' : `${summary.sourceLabel} · `}
              {selectedPlace.areaLabel ?? '지역 정보 없음'}
            </span>
            {!publicDetail && !summary && source?.categoryLabel && <small>가져온 분류 · {source.categoryLabel}</small>}
          </div>
          <ExternalDirectionActions destination={selectedPlace} />
        </>
      )}
      {personalState !== undefined && <PersonalRatingEditor workflow={workflow} />}
      <nav aria-label="장소 상세 항목" className={styles.detailTabs} role="tablist">
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
        {selectedPlace && <>
          <dl className={styles.placeFacts}>
            <div>
              <dt>정보 상태</dt>
              <dd>{evidenceStatus === undefined ? source ? '가져온 기본 정보' : '확인 필요' : libraryEvidenceLabel(evidenceStatus)}</dd>
            </div>
            <div>
              <dt>위치</dt>
              <dd>{selectedPlace.location === null
                ? '위치 정보 준비 중'
                : `${selectedPlace.location.latitude.toFixed(5)}, ${selectedPlace.location.longitude.toFixed(5)}`}</dd>
            </div>
          </dl>
        </>}
        {personalState !== undefined && filingEditor}

      {workflow.loading && selectedPlace !== undefined && (
        <p className={styles.detailStatus} role="status">내 장소 기능을 불러오는 중…</p>
      )}
      {workflow.detail?.status === 'pending' && (
        <section className={styles.accessNotice} role="status">
          <strong>추가 정보가 아직 연결되지 않았어요</strong>
          <span>가져온 기본 정보와 개인 기록은 사용할 수 있습니다. 상세 보강은 현재 실행 중이 아닙니다.</span>
        </section>
      )}
      {loginRequired && (
        <section className={styles.accessNotice}>
          <strong>내 기록을 사용하려면 로그인이 필요합니다.</strong>
          <span>내 평점, 카테고리·태그, 방문과 메모는 로그인 후 표시됩니다.</span>
          <a href="/api/auth/oidc/start">로그인하고 계속</a>
        </section>
      )}
      {workflow.accessDenied && (
        <p className={styles.detailError} role="alert">현재 등급에서는 이 장소의 개인 기능을 사용할 수 없습니다.</p>
      )}
      {workflow.error !== undefined && (
        <div className={styles.detailError} role="alert">
          <span>{workflow.error}</span>
          <button onClick={() => void workflow.retry()} type="button">다시 시도</button>
        </div>
      )}
      </section>

      <section id="place-panel-records" role="tabpanel" aria-labelledby="place-tab-records" hidden={tab !== 'records'}>
      {personalState !== undefined ? (
        <>
          <details className={styles.recordSection}><summary>개인 태그</summary>
            <PersonalOrganizationEditor showCollections={filingEditor === undefined} workflow={workflow} />
          </details>
          <details className={styles.recordSection}><summary>방문 기록</summary><PersonalVisits visits={workflow.visits} /></details>
          <details className={styles.recordSection}><summary>메모{workflow.notes.dirty ? ' · 저장 전' : ''}</summary><PersonalNotes notes={workflow.notes} /></details>
        </>
      ) : <p className={styles.detailStatus}>내 기록은 로그인 후 사용할 수 있습니다.</p>}
      </section>
    </div>
  )
}
