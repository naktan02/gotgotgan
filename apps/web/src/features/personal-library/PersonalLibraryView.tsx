'use client'

import type { LibraryPlaceState } from '@place/contracts/library'

import styles from './personal-library.module.css'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'
import { PersonalLibraryOrganizationEditor } from './PersonalLibraryOrganizationEditor'

const stateTabs: ReadonlyArray<Readonly<{ state: LibraryPlaceState; label: string }>> = [
  { state: 'saved', label: '저장됨' },
  { state: 'wanted', label: '가고 싶음' },
  { state: 'rated', label: '평가함' },
]

function evidenceLabel(status: 'verified' | 'unverified' | 'conflicted' | 'stale') {
  if (status === 'verified') return '검증됨'
  if (status === 'conflicted') return '정보 충돌'
  if (status === 'stale') return '갱신 필요'
  return '확인 필요'
}

export function PersonalLibraryView({
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow }>) {
  const {
    surface,
    selectedTagIds,
    tagMatch,
    selectedAreaKeys,
    selectedTaxonomyKeys,
    facets,
    tags,
    tagCursor,
    collections,
    collectionCursor,
    rows,
    nextCursor,
    selectedPlaceId,
    selectedRow,
    selectedDetail,
    collectionName,
    loading,
    loadingMore,
    metadataLoading,
    detailLoading,
    authenticationRequired,
    error,
    chooseState,
    chooseCollection,
    toggleTag,
    toggleArea,
    toggleTaxonomy,
    setTagMatch,
    selectPlace,
    loadMore,
    retry,
    loadMoreTags,
    loadMoreCollections,
  } = workflow

  if (authenticationRequired) {
    return (
      <section aria-labelledby="personal-library-title" className={styles.gate}>
        <p>개인 라이브러리</p>
        <h1 id="personal-library-title">내 장소를 보려면 로그인이 필요합니다.</h1>
        <span>저장한 장소, 태그와 컬렉션은 브라우저에 토큰을 노출하지 않고 불러옵니다.</span>
        <a href="/api/auth/oidc/start">로그인하고 계속</a>
      </section>
    )
  }

  const activeState = surface.kind === 'state' ? surface.state : undefined
  const selectedPlace = selectedDetail ?? selectedRow?.place
  const personalState = selectedDetail?.personalState

  return (
    <section aria-labelledby="personal-library-title" className={styles.library}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Personal Library</p>
          <h1 id="personal-library-title">내 장소</h1>
        </div>
        <p>상태, 태그, 컬렉션을 겹쳐 보며 장소를 다시 찾습니다.</p>
      </header>

      <div className={styles.filters}>
        <div aria-label="장소 상태" className={styles.tabs} role="tablist">
          {stateTabs.map((tab) => (
            <button
              aria-selected={activeState === tab.state}
              key={tab.state}
              onClick={() => chooseState(tab.state)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.facetControls}>
          <span className={styles.filterLabel}>지역</span>
          <div aria-label="저장 장소 지역 필터" className={styles.facetOptions}>
            {facets?.areas.map((facet) => (
              <button
                aria-pressed={selectedAreaKeys.includes(facet.key)}
                disabled={!selectedAreaKeys.includes(facet.key) && selectedAreaKeys.length >= 10}
                key={facet.key}
                onClick={() => toggleArea(facet.key)}
                type="button"
              >
                {facet.label}<span>{facet.count}</span>
              </button>
            ))}
            {!metadataLoading && facets?.areas.length === 0 && <span className={styles.noTags}>표시할 지역이 없습니다.</span>}
          </div>
        </div>
        <div className={styles.facetControls}>
          <span className={styles.filterLabel}>분류</span>
          <div aria-label="저장 장소 분류 필터" className={styles.facetOptions}>
            {facets?.taxonomies.map((facet) => (
              <button
                aria-pressed={selectedTaxonomyKeys.includes(facet.key)}
                disabled={!selectedTaxonomyKeys.includes(facet.key) && selectedTaxonomyKeys.length >= 10}
                key={facet.key}
                onClick={() => toggleTaxonomy(facet.key)}
                type="button"
              >
                {facet.label}<span>{facet.count}</span>
              </button>
            ))}
            {!metadataLoading && facets?.taxonomies.length === 0 && <span className={styles.noTags}>표시할 분류가 없습니다.</span>}
          </div>
          {facets !== undefined && (
            <small className={styles.facetCoverage}>
              저장 장소 {facets.coverage.savedPlaceCount}개 기준
              {facets.coverage.projectedPlaceCount < facets.coverage.sampledPlaceCount
                ? ` · 기본 정보 ${facets.coverage.projectedPlaceCount}개 반영`
                : ''}
              {!facets.coverage.complete
                ? facets.coverage.sampledPlaceCount < facets.coverage.savedPlaceCount
                  ? ` · 최근 ${facets.coverage.sampledPlaceCount}개 표본의 상위 선택지만 표시`
                  : ' · 상위 선택지만 표시'
                : ''}
            </small>
          )}
        </div>
        <div className={styles.tagControls}>
          <span className={styles.filterLabel}>태그</span>
          <div aria-label="태그 필터" className={styles.tags}>
            {tags.map((tag) => (
              <button
                aria-pressed={selectedTagIds.includes(tag.tagId)}
                key={tag.tagId}
                onClick={() => toggleTag(tag.tagId)}
                type="button"
              >
                {tag.name}<span>{tag.placeCount}</span>
              </button>
            ))}
            {!metadataLoading && tags.length === 0 && <span className={styles.noTags}>아직 태그가 없습니다.</span>}
            {tagCursor !== undefined && (
              <button className={styles.inlineMore} onClick={() => void loadMoreTags()} type="button">태그 더 보기</button>
            )}
          </div>
          {selectedTagIds.length > 1 && (
            <div aria-label="태그 일치 방식" className={styles.matchMode}>
              <button aria-pressed={tagMatch === 'all'} onClick={() => setTagMatch('all')} type="button">모두 포함</button>
              <button aria-pressed={tagMatch === 'any'} onClick={() => setTagMatch('any')} type="button">하나 이상</button>
            </div>
          )}
        </div>
      </div>

      {error !== undefined && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button onClick={() => void retry()} type="button">다시 시도</button>
        </div>
      )}

      <div className={styles.workspace}>
        <aside aria-label="내 컬렉션" className={styles.collections}>
          <div className={styles.paneHeading}>
            <strong>컬렉션</strong>
            <span>{collections.length}</span>
          </div>
          <ul>
            {collections.map((collection) => (
              <li key={collection.collectionId}>
                <button
                  aria-current={surface.kind === 'collection' && surface.collectionId === collection.collectionId ? 'page' : undefined}
                  onClick={() => chooseCollection(collection.collectionId)}
                  type="button"
                >
                  <span>{collection.name}</span>
                  <small>{collection.placeCount}</small>
                </button>
              </li>
            ))}
          </ul>
          {!metadataLoading && collections.length === 0 && <p className={styles.sidebarEmpty}>아직 컬렉션이 없습니다.</p>}
          {collectionCursor !== undefined && (
            <button className={styles.sidebarMore} onClick={() => void loadMoreCollections()} type="button">더 보기</button>
          )}
        </aside>

        <section aria-label="장소 목록" className={styles.places}>
          <div className={styles.paneHeading}>
            <strong>{collectionName ?? stateTabs.find((tab) => tab.state === activeState)?.label ?? '내 장소'}</strong>
            <span>{loading ? '불러오는 중…' : `${rows.length}개`}</span>
          </div>
          {!loading && error === undefined && rows.length === 0 && (
            <div className={styles.empty}>
              <strong>이 조건에 맞는 장소가 없습니다.</strong>
              <span>다른 상태나 태그, 컬렉션을 선택해 보세요.</span>
            </div>
          )}
          <ol>
            {rows.map((row) => (
              <li key={row.placeId}>
                <button
                  aria-pressed={selectedPlaceId === row.placeId}
                  onClick={() => selectPlace(row.placeId)}
                  type="button"
                >
                  <span className={styles.placeName}>{row.place?.name ?? '장소 정보 동기화 중'}</span>
                  <span>{row.place?.primaryTaxonomy?.label ?? '분류 미확인'} · {row.place?.areaLabel ?? '지역 정보 없음'}</span>
                  <small>
                    {row.personalRating === undefined || row.personalRating === null ? '' : `내 평점 ${row.personalRating.toFixed(1)} · `}
                    {row.place === null ? '기본 정보 대기' : evidenceLabel(row.place.evidence.status)}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {nextCursor !== undefined && (
            <button className={styles.more} disabled={loadingMore} onClick={loadMore} type="button">
              {loadingMore ? '불러오는 중…' : '장소 더 보기'}
            </button>
          )}
        </section>

        <aside aria-label="선택한 장소 상세" className={styles.detail}>
          {selectedPlaceId === undefined ? (
            <div className={styles.detailEmpty}>목록에서 장소를 선택하세요.</div>
          ) : detailLoading ? (
            <div className={styles.detailEmpty}>상세 정보를 불러오는 중…</div>
          ) : selectedPlace == null ? (
            <div className={styles.detailEmpty}>상세 정보를 지금 확인할 수 없습니다.</div>
          ) : (
            <>
              <div className={styles.detailHeading}>
                <p>{selectedPlace.primaryTaxonomy?.label ?? '분류 미확인'}</p>
                <h2>{selectedPlace.name}</h2>
                <span>{selectedPlace.areaLabel ?? '지역 정보 없음'}</span>
              </div>
              {personalState !== undefined && (
                <dl className={styles.personalState}>
                  <div><dt>저장</dt><dd>{personalState.saved ? '저장됨' : '저장 안 함'}</dd></div>
                  <div><dt>가고 싶음</dt><dd>{personalState.wanted ? '표시됨' : '표시 안 함'}</dd></div>
                  <div><dt>내 평점</dt><dd>{personalState.personalRating?.toFixed(1) ?? '없음'}</dd></div>
                  <div><dt>방문</dt><dd>{personalState.visits.count}회</dd></div>
                </dl>
              )}
              <dl className={styles.placeFacts}>
                <div><dt>정보 상태</dt><dd>{evidenceLabel(selectedPlace.evidence.status)}</dd></div>
                <div><dt>위치</dt><dd>{selectedPlace.location.latitude.toFixed(5)}, {selectedPlace.location.longitude.toFixed(5)}</dd></div>
              </dl>
              <PersonalLibraryOrganizationEditor workflow={workflow} />
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
