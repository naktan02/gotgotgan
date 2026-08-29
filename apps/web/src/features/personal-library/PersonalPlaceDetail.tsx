'use client'

import { PersonalLibraryNotes } from './PersonalLibraryNotes'
import { PersonalLibraryOrganizationEditor } from './PersonalLibraryOrganizationEditor'
import { PersonalLibraryPreferenceEditor } from './PersonalLibraryPreferenceEditor'
import { PersonalLibraryVisits } from './PersonalLibraryVisits'
import styles from './personal-place-detail.module.css'
import { usePersonalPlaceDetailWorkflow } from './personal-place-detail-workflow'
import { libraryEvidenceLabel } from './personal-library-presentation'

export type PersonalPlaceSummary = Readonly<{
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
  sourceLabel?: string
}>

const noChange = () => Promise.resolve()

export function PersonalPlaceDetail({
  placeId,
  summary,
  onChanged = noChange,
}: Readonly<{
  placeId: string
  summary?: PersonalPlaceSummary
  onChanged?: () => Promise<unknown>
}>) {
  const workflow = usePersonalPlaceDetailWorkflow({ placeId, onChanged })
  const selectedPlace = workflow.detail ?? summary
  const evidenceStatus = workflow.detail?.evidence.status ?? summary?.evidenceStatus
  const personalState = workflow.detail?.personalState
  const loginRequired = workflow.authenticationRequired || (
    workflow.detail !== undefined && personalState === undefined
  )

  return (
    <div className={styles.detailContent}>
      {selectedPlace === undefined ? (
        <div className={styles.detailEmpty} role={workflow.loading ? 'status' : undefined}>
          {workflow.loading ? '상세 정보를 불러오는 중…' : '상세 정보를 지금 확인할 수 없습니다.'}
        </div>
      ) : (
        <>
          <div className={styles.detailHeading}>
            <p>{selectedPlace.primaryTaxonomy?.label ?? '분류 미확인'}</p>
            <h2>{selectedPlace.name}</h2>
            <span>
              {summary?.sourceLabel === undefined ? '' : `${summary.sourceLabel} · `}
              {selectedPlace.areaLabel ?? '지역 정보 없음'}
            </span>
          </div>

          {personalState !== undefined && (
            <PersonalLibraryPreferenceEditor workflow={workflow} />
          )}
          {personalState !== undefined && (
            <nav aria-label="장소 상세 항목" className={styles.detailTabs}>
              <a href="#place-facts">정보</a>
              <a href="#place-organization">내 분류</a>
              <a href="#place-visits">방문</a>
              <a href="#place-notes">메모</a>
            </nav>
          )}
          <dl className={styles.placeFacts} id="place-facts">
            <div>
              <dt>정보 상태</dt>
              <dd>{evidenceStatus === undefined ? '확인 필요' : libraryEvidenceLabel(evidenceStatus)}</dd>
            </div>
            <div>
              <dt>위치</dt>
              <dd>{selectedPlace.location.latitude.toFixed(5)}, {selectedPlace.location.longitude.toFixed(5)}</dd>
            </div>
          </dl>
        </>
      )}

      {workflow.loading && selectedPlace !== undefined && (
        <p className={styles.detailStatus} role="status">내 장소 기능을 불러오는 중…</p>
      )}
      {loginRequired && (
        <section className={styles.accessNotice}>
          <strong>내 기록을 사용하려면 로그인이 필요합니다.</strong>
          <span>저장, 내 평점, 컬렉션·태그, 방문과 메모는 로그인 후 표시됩니다.</span>
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

      {personalState !== undefined && (
        <>
          <div id="place-organization">
            <PersonalLibraryOrganizationEditor workflow={workflow} />
          </div>
          <div id="place-visits"><PersonalLibraryVisits visits={workflow.visits} /></div>
          <div id="place-notes"><PersonalLibraryNotes notes={workflow.notes} /></div>
        </>
      )}
    </div>
  )
}
