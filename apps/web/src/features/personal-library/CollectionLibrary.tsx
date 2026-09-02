'use client'

import type { PlaceMapRenderer } from '@/platform/maps/place-map-interface'

import styles from './collection-library.module.css'
import { useCollectionLibraryWorkflow, type CollectionLibraryWorkflow } from './collection-library-workflow'
import { PersonalLibraryMap } from './PersonalLibraryMap'
import { PersonalPlaceDetail } from './PersonalPlaceDetail'
import { PlaceFilingEditor } from './PlaceFilingEditor'

function statusMessage(status: CollectionLibraryWorkflow['pageStatus']) {
  if (status === 'forbidden') return '현재 계정에는 내 곳곳간을 볼 권한이 없습니다.'
  if (status === 'not-found') return '선택한 카테고리가 삭제되었거나 더 이상 존재하지 않습니다.'
  if (status === 'unavailable') return '내 곳곳간을 잠시 불러올 수 없습니다.'
  return '내 곳곳간을 불러오지 못했습니다.'
}

function CollectionCreation({ workflow, compact = false }: Readonly<{
  workflow: CollectionLibraryWorkflow
  compact?: boolean
}>) {
  return (
    <form
      className={compact ? styles.compactCreation : styles.emptyCreation}
      onSubmit={(event) => {
        event.preventDefault()
        void workflow.createCollection()
      }}
    >
      {!compact && <><strong>첫 카테고리를 만들어 보세요.</strong><span>장소는 사용자가 만든 카테고리에 포함될 때 즐겨찾기가 됩니다.</span></>}
      <label htmlFor={compact ? 'new-collection-compact' : 'new-collection-empty'}>카테고리 이름</label>
      <div>
        <input
          id={compact ? 'new-collection-compact' : 'new-collection-empty'}
          maxLength={120}
          onChange={(event) => workflow.setNewCollectionName(event.target.value)}
          placeholder="예: 서울 라멘"
          value={workflow.newCollectionName}
        />
        <button
          disabled={workflow.collectionMutation !== 'idle' || workflow.newCollectionName.trim().length === 0}
          type="submit"
        >{workflow.collectionMutation === 'creating' ? '만드는 중…' : compact ? '추가' : '카테고리 만들기'}</button>
      </div>
    </form>
  )
}

export function CollectionLibraryView({
  mapRenderer: MapRenderer,
  workflow,
}: Readonly<{ mapRenderer: PlaceMapRenderer; workflow: CollectionLibraryWorkflow }>) {
  if (workflow.pageStatus === 'authentication-required') {
    return (
      <section className={styles.gate}>
        <p>내 곳곳간</p>
        <h1>내 카테고리를 보려면 로그인이 필요합니다.</h1>
        <span>카테고리와 개인 기록은 로그인한 본인에게만 표시됩니다.</span>
        <a href="/api/auth/oidc/start">로그인하고 계속</a>
      </section>
    )
  }

  if (workflow.pageStatus !== 'loading' && workflow.pageStatus !== 'ready') {
    return (
      <section className={styles.gate} role="alert">
        <p>내 곳곳간</p>
        <h1>{statusMessage(workflow.pageStatus)}</h1>
        <span>로그인 문제, 권한 문제, 삭제된 카테고리와 일시적인 장애를 구분해 안내합니다.</span>
        {workflow.pageStatus !== 'forbidden' && (
          <button
            onClick={workflow.pageStatus === 'not-found'
              ? workflow.recoverMissingCollection
              : workflow.retry}
            type="button"
          >{workflow.pageStatus === 'not-found' ? '전체 카테고리 보기' : '다시 시도'}</button>
        )}
      </section>
    )
  }

  const places = workflow.workspace?.places ?? []
  const selected = workflow.selectedPlace?.place

  return (
    <section aria-labelledby="collection-library-title" className={styles.library}>
      <div className={styles.mobileSwitcher} aria-label="내 곳곳간 화면">
        <button aria-pressed={workflow.mobileSurface === 'collections'} onClick={() => workflow.showMobileSurface('collections')} type="button">카테고리</button>
        <button aria-pressed={workflow.mobileSurface === 'list'} onClick={() => workflow.showMobileSurface('list')} type="button">목록</button>
        <button aria-pressed={workflow.mobileSurface === 'map'} onClick={() => workflow.showMobileSurface('map')} type="button">지도</button>
      </div>

      <div className={`${styles.workspace} ${styles[`mobile_${workflow.mobileSurface}`]}`}>
        <aside aria-label="내 카테고리" className={styles.collectionRail}>
          <div className={styles.railHeading}>
            <div>
              <span>MY COLLECTIONS</span>
              <h1 id="collection-library-title">내 카테고리</h1>
            </div>
            <small>{workflow.collections.length}</small>
          </div>
          <CollectionCreation compact workflow={workflow} />
          <nav aria-label="카테고리 목록" className={styles.collectionList}>
            {workflow.collections.map((collection) => (
              <button
                aria-current={workflow.selectedCollectionId === collection.collectionId ? 'page' : undefined}
                key={collection.collectionId}
                onClick={() => workflow.selectCollection(collection.collectionId)}
                type="button"
              >
                <span aria-hidden="true">{collection.name.slice(0, 1)}</span>
                <strong>{collection.name}</strong>
                <small>{collection.placeCount}</small>
              </button>
            ))}
            {workflow.workspace?.collectionNextCursor !== undefined && (
              <button
                className={styles.collectionMore}
                disabled={workflow.loadingMoreCollections}
                onClick={() => void workflow.loadMoreCollections()}
                type="button"
              >
                <span aria-hidden="true">+</span>
                <strong>{workflow.loadingMoreCollections ? '불러오는 중…' : '카테고리 더 보기'}</strong>
              </button>
            )}
          </nav>
          <div className={styles.privateNotice}>
            <strong>나만의 카테고리</strong>
            <span>메모·평점·방문 기록은 공개 목록에 포함되지 않습니다.</span>
          </div>
        </aside>

        {workflow.pageStatus === 'loading' ? (
          <div className={styles.loading} role="status">내 카테고리를 불러오는 중…</div>
        ) : workflow.collections.length === 0 ? (
          <div className={styles.emptyWorkspace}><CollectionCreation workflow={workflow} /></div>
        ) : (
          <>
            <main className={styles.collectionMain}>
              <header className={styles.collectionHeader}>
                <div className={styles.cover} aria-hidden="true">{workflow.selectedCollection?.name.slice(0, 1)}</div>
                <div className={styles.collectionIdentity}>
                  <span>{workflow.selectedCollection?.visibility === 'private' ? '비공개 카테고리' : '공개 설정됨'}</span>
                  <h2>{workflow.selectedCollection?.name ?? '카테고리 선택'}</h2>
                  <p>{workflow.selectedCollection?.description ?? '이 카테고리에 담은 장소를 목록과 지도에서 관리합니다.'}</p>
                  <small>장소 {workflow.selectedCollection?.placeCount ?? 0}개</small>
                </div>
                {workflow.selectedCollection !== undefined && (
                  <div className={styles.collectionEdit}>
                    <form onSubmit={(event) => { event.preventDefault(); void workflow.renameCollection() }}>
                      <label htmlFor="collection-rename">카테고리 이름 수정</label>
                      <input id="collection-rename" maxLength={120} onChange={(event) => workflow.setRenameDraft(event.target.value)} value={workflow.renameDraft} />
                      <button disabled={workflow.collectionMutation !== 'idle' || workflow.renameDraft.trim() === workflow.selectedCollection.name} type="submit">수정</button>
                    </form>
                    {workflow.deleteArmed ? (
                      <div className={styles.deleteConfirm}>
                        <span>카테고리만 삭제하며 장소의 다른 카테고리와 개인 기록은 유지됩니다.</span>
                        <button onClick={() => void workflow.deleteCollection()} type="button">삭제 확인</button>
                        <button onClick={workflow.cancelDelete} type="button">취소</button>
                      </div>
                    ) : (
                      <button className={styles.textDanger} onClick={workflow.armDelete} type="button">카테고리 삭제</button>
                    )}
                  </div>
                )}
              </header>

              {workflow.collectionMessage !== undefined && <div className={styles.inlineError} role="alert">{workflow.collectionMessage}</div>}

              <div className={styles.filters} aria-label="장소 필터">
                <label>
                  <span>평점</span>
                  <select onChange={(event) => workflow.setRatingFilter(event.target.value as typeof workflow.ratingFilter)} value={workflow.ratingFilter}>
                    <option value="any">전체</option>
                    <option value="rated">평점 있음</option>
                    <option value="unrated">평점 없음</option>
                  </select>
                </label>
                <div className={styles.filterGroup}>
                  <span>지역</span>
                  {(workflow.availableFilters?.areas.length ?? 0) === 0 ? <small>지역 없음</small> : workflow.availableFilters?.areas.map((area) => (
                    <button aria-pressed={workflow.areaKeys.includes(area.key)} key={area.key} onClick={() => workflow.toggleArea(area.key)} type="button">{area.label}</button>
                  ))}
                </div>
                <div className={styles.filterGroup}>
                  <span>장소 유형</span>
                  {workflow.taxonomyOptions.length === 0 ? <small>현재 목록에 분류 없음</small> : workflow.taxonomyOptions.map((option) => (
                    <button aria-pressed={workflow.taxonomyKeys.includes(option.key)} key={option.key} onClick={() => workflow.toggleTaxonomy(option.key)} type="button">{option.label}</button>
                  ))}
                </div>
                <div className={styles.filterGroup}>
                  <span>태그</span>
                  {workflow.tagError ? <small role="alert">태그를 불러오지 못함</small> : workflow.tags.length === 0 ? <small>태그 없음</small> : workflow.tags.map((tag) => (
                    <button aria-pressed={workflow.tagIds.includes(tag.tagId)} key={tag.tagId} onClick={() => workflow.toggleTag(tag.tagId)} type="button">{tag.name}</button>
                  ))}
                </div>
              </div>

              <div className={styles.listHeading}>
                <strong>{workflow.selectedCollection?.name}</strong>
                <span aria-live="polite">{places.length}개 표시</span>
              </div>
              {places.length === 0 ? (
                <div className={styles.emptyList}>
                  <strong>이 조건에 맞는 장소가 없습니다.</strong>
                  <span>홈에서 장소를 찾은 뒤 원하는 카테고리에 추가해 보세요.</span>
                  <a href="/">홈에서 장소 찾기</a>
                </div>
              ) : (
                <ol className={styles.placeList}>
                  {places.map((row, index) => (
                    <li key={row.placeId}>
                      <button aria-pressed={workflow.selectedPlaceId === row.placeId} onClick={() => workflow.selectPlace(row.placeId)} type="button">
                        <span className={styles.placeThumb}>{index + 1}</span>
                        <span className={styles.placeCopy}>
                          <strong>{row.place?.name ?? '장소 정보 준비 중'}</strong>
                          <span>{row.place?.primaryTaxonomy?.label ?? '분류 미확인'} · {row.place?.areaLabel ?? '지역 정보 없음'}</span>
                          <small>카테고리 {row.overlay.collectionCount}곳 · {row.overlay.personalRating === null ? '평점 없음' : `내 평점 ${row.overlay.personalRating.toFixed(1)}`}</small>
                        </span>
                        <span className={styles.multiBadge}>{row.overlay.collectionCount > 1 ? `+${row.overlay.collectionCount - 1}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {workflow.workspace?.placeNextCursor !== undefined && (
                <button className={styles.loadMore} disabled={workflow.loadingMore} onClick={() => void workflow.loadMore()} type="button">{workflow.loadingMore ? '불러오는 중…' : '장소 더 보기'}</button>
              )}
            </main>

            <div className={styles.mapPane}>
              <PersonalLibraryMap
                error={workflow.mapStatus === 'error' ? '지도를 불러올 수 없습니다. 목록 기능은 계속 사용할 수 있습니다.' : undefined}
                loading={workflow.mapStatus === 'loading'}
                mapRenderer={MapRenderer}
                onRetry={workflow.retryMap}
                onSelect={workflow.selectPlace}
                onViewportChange={workflow.setMapViewport}
                projection={workflow.mapProjection}
                selectedPlaceId={workflow.selectedPlaceId}
                viewport={workflow.mapViewport}
              />
            </div>
          </>
        )}

        {workflow.selectedPlaceId !== undefined && (
          <aside aria-label="선택한 장소 상세" className={styles.detailDrawer}>
            <button className={styles.detailClose} onClick={workflow.closeDetail} type="button">← 목록으로</button>
            <PersonalPlaceDetail
              filingEditor={<PlaceFilingEditor workflow={workflow.filing} />}
              onChanged={workflow.refresh}
              placeId={workflow.selectedPlaceId}
              summary={selected === null || selected === undefined ? undefined : {
                name: selected.name,
                areaLabel: selected.areaLabel,
                location: selected.location,
                primaryTaxonomy: selected.primaryTaxonomy,
                evidenceStatus: selected.evidence.status,
              }}
            />
          </aside>
        )}
      </div>
    </section>
  )
}

export function CollectionLibrary({ mapRenderer }: Readonly<{ mapRenderer: PlaceMapRenderer }>) {
  return <CollectionLibraryView mapRenderer={mapRenderer} workflow={useCollectionLibraryWorkflow()} />
}
