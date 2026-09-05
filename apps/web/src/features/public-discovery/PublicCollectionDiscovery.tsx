'use client'

import { useRef, type FormEvent, type RefObject } from 'react'

import type { PlaceMapBounds, PlaceMapRenderer } from '@/platform/maps/public'

import type {
  DiscoveryCollection,
  DiscoveryCollectionDetail,
  DiscoveryGateway,
  DiscoveryPlace,
  DiscoveryReportReason,
} from './public-collection-discovery-model'
import {
  type PublicCollectionDiscoveryWorkflow,
  usePublicCollectionDiscovery,
} from './public-collection-discovery-workflow'
import styles from './public-collection-discovery.module.css'

const reportReasons: readonly Readonly<{ value: DiscoveryReportReason; label: string }>[] = [
  { value: 'spam', label: '스팸 또는 홍보성 콘텐츠' },
  { value: 'unsafe-content', label: '유해하거나 위험한 콘텐츠' },
  { value: 'privacy', label: '개인정보 침해' },
  { value: 'harassment', label: '괴롭힘 또는 혐오 표현' },
  { value: 'impersonation', label: '다른 사람 사칭' },
]

function displayDate(value: string): string {
  const [date] = value.split('T')
  return date?.replaceAll('-', '.') ?? value
}

function Preview({ collection }: Readonly<{ collection: DiscoveryCollection }>) {
  const places = collection.previewPlaces.slice(0, 4)
  return <span aria-hidden="true" className={styles.preview}>
    {places.length === 0 ? <span className={styles.emptyPreview}>장소 미리보기 준비 중</span> : places.map((item) => (
      <span className={styles.previewTile} key={item.placeId}>
        {item.place?.name.trim().slice(0, 1) ?? '·'}
      </span>
    ))}
  </span>
}

function CollectionCard({
  collection,
  selected,
  onSelect,
  buttonRef,
}: Readonly<{
  collection: DiscoveryCollection
  selected: boolean
  onSelect: () => void
  buttonRef?: RefObject<HTMLButtonElement | null>
}>) {
  return <button
    aria-pressed={selected}
    className={selected ? `${styles.collectionCard} ${styles.selectedCard}` : styles.collectionCard}
    onClick={onSelect}
    ref={buttonRef}
    type="button"
  >
    <Preview collection={collection} />
    <span className={styles.cardBody}>
      <h2>{collection.name}</h2>
      <span className={styles.description}>{collection.description ?? '작성자가 설명을 추가하지 않았습니다.'}</span>
      <span className={styles.ownerLine}>
        <span aria-hidden="true" className={styles.ownerAvatar}>{collection.owner.displayName.slice(0, 1)}</span>
        <span>{collection.owner.displayName}</span>
      </span>
      <span className={styles.metaLine}>
        <span>장소 {collection.placeCount}곳</span>
        <span>· {displayDate(collection.updatedAt)} 업데이트</span>
        {collection.topics.slice(0, 2).map((topic) => <span className={styles.topic} key={topic.key}>{topic.label}</span>)}
      </span>
    </span>
    <span aria-hidden="true" className={styles.selectMark}>✓</span>
  </button>
}

function StatePanel({
  state,
  context,
  retry,
}: Readonly<{
  state: PublicCollectionDiscoveryWorkflow['directoryState']
  context: 'directory' | 'detail'
  retry: () => void
}>) {
  if (state === 'loading') return <div aria-label="공개 목록 불러오는 중" className={styles.statePanel} role="status">
    <strong>공개 목록을 불러오고 있어요</strong><p>공개 범위와 작성자 상태를 확인하는 중입니다.</p>
  </div>
  if (state === 'authentication-required') return <div className={styles.statePanel} role="status">
    <strong>로그인이 필요합니다</strong><p>이 작업을 계속하려면 곳곳간 계정으로 로그인해 주세요.</p>
    <a href="/api/auth/oidc/start">로그인하고 계속</a>
  </div>
  if (state === 'forbidden') return <div className={styles.statePanel} role="alert">
    <strong>이 목록을 볼 권한이 없습니다</strong><p>공개 상태가 바뀌었거나 계정에서 접근할 수 없는 목록입니다.</p>
  </div>
  if (state === 'not-found') return <div className={styles.statePanel} role="status">
    <strong>{context === 'detail' ? '목록이 더 이상 공개되어 있지 않습니다' : '공개 목록을 찾지 못했습니다'}</strong>
    <p>작성자가 삭제하거나 공개 범위를 변경했을 수 있습니다.</p><button onClick={retry} type="button">목록 새로고침</button>
  </div>
  return <div className={styles.statePanel} role="alert">
    <strong>지금은 공개 목록을 불러올 수 없습니다</strong><p>일시적인 연결 문제입니다. 잠시 후 같은 조건으로 다시 시도해 주세요.</p>
    <button onClick={retry} type="button">다시 시도</button>
  </div>
}

function boundsFor(places: readonly DiscoveryPlace[]): PlaceMapBounds | undefined {
  const locations = places.flatMap((item) => item.place?.location === null || item.place?.location === undefined
    ? [] : [item.place.location])
  if (locations.length === 0) return undefined
  const longitudes = locations.map((location) => location.longitude)
  const latitudes = locations.map((location) => location.latitude)
  const west = Math.min(...longitudes)
  const east = Math.max(...longitudes)
  const south = Math.min(...latitudes)
  const north = Math.max(...latitudes)
  const longitudePadding = Math.max((east - west) * .18, .015)
  const latitudePadding = Math.max((north - south) * .18, .015)
  return {
    west: Math.max(-180, west - longitudePadding), east: Math.min(180, east + longitudePadding),
    south: Math.max(-90, south - latitudePadding), north: Math.min(90, north + latitudePadding),
  }
}

function CopyStatus({ state }: Readonly<{ state: PublicCollectionDiscoveryWorkflow['copyState'] }>) {
  if (state.kind === 'idle' || state.kind === 'copying' || state.kind === 'copied') return null
  const message = state.kind === 'authentication-required' ? <>복사하려면 <a href="/api/auth/oidc/start">로그인</a>이 필요합니다.</>
    : state.kind === 'forbidden' ? <>이 목록을 내 곳곳간으로 복사할 권한이 없습니다.</>
      : state.kind === 'not-found' ? <>원본 목록이 삭제되었거나 더 이상 공개되어 있지 않습니다.</>
        : state.kind === 'conflict' ? <>복사 전에 원본이 변경되었습니다. 최신 내용을 확인한 뒤 다시 선택해 주세요.</>
          : state.kind === 'invalid-selection' ? <>일부 복사할 장소를 한 곳 이상 선택해 주세요.</>
            : <>일시적인 문제로 복사하지 못했습니다. 다시 누르면 같은 요청으로 안전하게 재시도합니다.</>
  return <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">{message}</p>
}

function ReportForm({ workflow }: Readonly<{ workflow: PublicCollectionDiscoveryWorkflow }>) {
  if (!workflow.reportOpen) return null
  return <form className={styles.reportForm} onSubmit={(event) => { event.preventDefault(); void workflow.report() }}>
    <fieldset disabled={workflow.reportState === 'reporting'}>
      <legend>이 작성자를 신고하는 이유</legend>
      {reportReasons.map((reason) => <label key={reason.value}>
        <input checked={workflow.reportReason === reason.value} name="report-reason" onChange={() => workflow.setReportReason(reason.value)} type="radio" />
        {reason.label}
      </label>)}
    </fieldset>
    <div className={styles.reportButtons}>
      <button onClick={() => workflow.setReportOpen(false)} type="button">취소</button>
      <button disabled={workflow.reportState === 'reporting'} type="submit">{workflow.reportState === 'reporting' ? '접수 중…' : '신고 접수'}</button>
    </div>
  </form>
}

function DetailPanel({
  detail,
  MapRenderer,
  workflow,
}: Readonly<{
  detail: DiscoveryCollectionDetail
  MapRenderer: PlaceMapRenderer
  workflow: PublicCollectionDiscoveryWorkflow
}>) {
  const bounds = boundsFor(detail.places)
  const markers = detail.places.flatMap((item) => item.place?.location === null || item.place?.location === undefined
    ? [] : [{ id: item.placeId, label: item.place.name, location: item.place.location }])
  return <article aria-labelledby="selected-collection-title" className={styles.detailPanel}>
    <header className={styles.detailHeader}>
      <h2 id="selected-collection-title">{detail.name}</h2>
      <p>{detail.description ?? '작성자가 설명을 추가하지 않았습니다.'}</p>
      <div className={styles.detailOwner}>
        <span aria-hidden="true" className={styles.ownerAvatar}>{detail.owner.displayName.slice(0, 1)}</span>
        <a href={`/people/${encodeURIComponent(detail.owner.handle)}`}>{detail.owner.displayName} · @{detail.owner.handle}</a>
        <span>{displayDate(detail.updatedAt)} 업데이트</span>
      </div>
    </header>
    <div className={styles.mapWrap}>
      {bounds === undefined ? <div className={styles.mapEmpty}>위치가 확인된 장소가 없어 목록으로 보여드려요.</div> : <MapRenderer
        ariaLabel={`${detail.name} 지도 미리보기`}
        bounds={bounds}
        description={`공개된 장소 ${markers.length}곳을 지도에 표시했습니다.`}
        markers={markers}
        onSelect={workflow.setMapSelectedPlaceId}
        selectedMarkerId={workflow.selectedMapPlaceId}
        title={`${detail.placeCount}곳 지도 미리보기`}
        zoom={11}
      />}
    </div>
    <section className={styles.places}>
      <div className={styles.placesHeader}><h3>이 목록에 포함된 장소</h3><span>{detail.places.length}/{detail.placeCount}곳 · 일부 복사할 장소를 선택하세요</span></div>
      <ol aria-label="공개 목록 장소" className={styles.placeList}>
        {detail.places.map((item) => <li className={styles.placeItem} key={item.placeId}>
          <label>
            <input aria-label={`${item.place?.name ?? '정보 준비 중인 장소'} 일부 복사 선택`} checked={workflow.selectedPlaceIds.has(item.placeId)} onChange={() => workflow.togglePlace(item.placeId)} type="checkbox" />
            {item.place === null ? <span className={styles.pendingPlace}>장소 정보 준비 중</span> : <>
              <strong>{item.place.name}</strong>
              <span>{[item.place.taxonomyLabel, item.place.areaLabel].filter(Boolean).join(' · ') || '분류 준비 중'}</span>
            </>}
          </label>
        </li>)}
      </ol>
      {detail.nextCursor !== undefined && <button className={styles.loadMore} disabled={workflow.detailLoadingMore} onClick={() => void workflow.loadMoreDetail()} type="button">{workflow.detailLoadingMore ? '불러오는 중…' : '장소 더 보기'}</button>}
      {workflow.detailPageError && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">다음 장소를 불러오지 못했습니다. 다시 시도해 주세요.</p>}
    </section>
    <div className={styles.actions}>
      {workflow.copyState.kind === 'copied' ? <a className={styles.successLink} href={`/library?collection=${encodeURIComponent(workflow.copyState.targetCollectionId)}`}>복사한 목록 보기</a> : <button className={styles.primaryAction} disabled={workflow.copyState.kind === 'copying'} onClick={() => void workflow.copy('all')} type="button">{workflow.copyState.kind === 'copying' ? '복사하는 중…' : '전체 복사'}</button>}
      <button disabled={workflow.selectedPlaceIds.size === 0 || workflow.copyState.kind === 'copying' || workflow.copyState.kind === 'copied'} onClick={() => void workflow.copy('places')} type="button">일부 복사 ({workflow.selectedPlaceIds.size})</button>
      <button onClick={() => void workflow.share()} type="button">공유 링크</button>
    </div>
    <CopyStatus state={workflow.copyState} />
    {workflow.shareStatus === 'copied' && <p className={styles.actionStatus} role="status">공유 링크를 복사했습니다.</p>}
    {workflow.shareStatus === 'unavailable' && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">브라우저에서 링크를 복사하지 못했습니다.</p>}
    {workflow.reportState === 'reported' && <p className={styles.actionStatus} role="status">신고가 접수되었습니다.</p>}
    {workflow.reportState === 'authentication-required' && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">신고하려면 <a href="/api/auth/oidc/start">로그인</a>이 필요합니다.</p>}
    {workflow.reportState === 'forbidden' && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">이 작성자를 신고할 수 없습니다.</p>}
    {workflow.reportState === 'conflict' && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">이미 처리되었거나 본인 프로필은 신고할 수 없습니다.</p>}
    {workflow.reportState === 'unavailable' && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
    <p className={styles.privacyNotice}>개인 메모, 방문 기록, 개인 사진과 평점은 공개되거나 복사되지 않습니다. 공개된 장소와 순서만 내 비공개 컬렉션으로 복사됩니다.</p>
    <div className={styles.secondaryActions}>
      <button aria-expanded={workflow.reportOpen} onClick={() => workflow.setReportOpen(!workflow.reportOpen)} type="button">작성자 신고</button>
    </div>
    <ReportForm workflow={workflow} />
  </article>
}

export function PublicCollectionDiscoveryView({
  MapRenderer,
  workflow,
}: Readonly<{ MapRenderer: PlaceMapRenderer; workflow: PublicCollectionDiscoveryWorkflow }>) {
  const detailPanel = useRef<HTMLElement>(null)
  const selectedCollectionButton = useRef<HTMLButtonElement>(null)
  const submit = (event: FormEvent) => { event.preventDefault(); workflow.submitSearch() }
  const openDetail = (publicationId: string) => {
    workflow.select(publicationId)
    if (window.matchMedia('(max-width: 820px)').matches) {
      window.requestAnimationFrame(() => detailPanel.current?.focus())
    }
  }
  const showDirectory = () => {
    workflow.showMobileDirectory()
    window.requestAnimationFrame(() => selectedCollectionButton.current?.focus())
  }
  return <section aria-labelledby="discovery-title" className={styles.workspace}>
    <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>PUBLIC COLLECTIONS</p><h1 id="discovery-title">둘러보기</h1><p>다른 사람이 공개한 장소 목록을 발견하고 내 곳곳간으로 가져오세요.</p></div>
      <form className={styles.search} onSubmit={submit} role="search">
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></svg>
        <input aria-label="공개 목록 검색" onChange={(event) => workflow.setDraftQuery(event.target.value)} placeholder="공개 목록 주제 검색" value={workflow.draftQuery} />
        <button type="submit">검색</button>
      </form>
    </header>
    <div aria-label="공개 목록 필터" className={styles.filterBar}>
      <label><span className={styles.visuallyHidden}>지역</span><select aria-label="지역 필터" onChange={(event) => workflow.changeFilter('areaKey', event.target.value)} value={workflow.filters.areaKey}><option value="">모든 지역</option>{workflow.directory?.availableFilters.areas.map((item) => <option key={item.key} value={item.key}>{item.label}{item.count === undefined ? '' : ` (${item.count})`}</option>)}</select></label>
      <label><span className={styles.visuallyHidden}>장소 유형</span><select aria-label="장소 유형 필터" onChange={(event) => workflow.changeFilter('taxonomyKey', event.target.value)} value={workflow.filters.taxonomyKey}><option value="">모든 장소 유형</option>{workflow.directory?.availableFilters.taxonomies.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label><span className={styles.visuallyHidden}>주제</span><select aria-label="주제 필터" onChange={(event) => workflow.changeFilter('topicKey', event.target.value)} value={workflow.filters.topicKey}><option value="">모든 주제</option>{workflow.directory?.availableFilters.topics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label><span className={styles.visuallyHidden}>공개 범위</span><select aria-label="공개 범위 필터" disabled value="public"><option value="public">전체 공개만</option></select></label>
      <label><span className={styles.visuallyHidden}>정렬</span><select aria-label="정렬" onChange={(event) => workflow.changeFilter('sort', event.target.value as 'recent' | 'largest' | 'name')} value={workflow.filters.sort}><option value="recent">최신순</option><option value="largest">장소 많은 순</option><option value="name">이름순</option></select></label>
      <button className={styles.resetButton} onClick={workflow.resetFilters} type="button">필터 초기화</button>
      <span className={styles.resultCount}>{workflow.directory?.items.length ?? 0}개 목록 표시</span>
    </div>
    <div className={styles.content} data-mobile-surface={workflow.mobileSurface}>
      <div className={styles.directory}>
        {workflow.directoryState !== 'ready' ? <StatePanel context="directory" retry={workflow.retryDirectory} state={workflow.directoryState} />
          : workflow.directory?.items.length === 0 ? <div className={styles.statePanel}><strong>조건에 맞는 공개 목록이 없습니다</strong><p>검색어나 필터를 줄여 다른 목록을 찾아보세요.</p><button onClick={workflow.resetFilters} type="button">모든 목록 보기</button></div>
            : <><ol aria-label="공개 컬렉션 검색 결과" className={styles.directoryList}>{workflow.directory?.items.map((collection) => <li key={collection.publicationId}><CollectionCard buttonRef={collection.publicationId === workflow.selectedPublicationId ? selectedCollectionButton : undefined} collection={collection} onSelect={() => openDetail(collection.publicationId)} selected={collection.publicationId === workflow.selectedPublicationId} /></li>)}</ol>{workflow.directory?.nextCursor !== undefined && <button className={styles.loadMore} disabled={workflow.directoryLoadingMore} onClick={() => void workflow.loadMoreDirectory()} type="button">{workflow.directoryLoadingMore ? '불러오는 중…' : '목록 더 보기'}</button>}{workflow.directoryPageError && <p className={`${styles.actionStatus} ${styles.errorStatus}`} role="alert">다음 공개 목록을 불러오지 못했습니다. 다시 시도해 주세요.</p>}</>}
      </div>
      <aside aria-label="선택한 공개 목록" className={styles.detail} ref={detailPanel} tabIndex={-1}>
        <button className={styles.mobileBack} onClick={showDirectory} type="button">← 공개 목록으로</button>
        {workflow.selectedPublicationId === undefined || workflow.selectedPublicationId === '' ? <div className={styles.statePanel}><strong>목록을 선택해 주세요</strong><p>선택한 공개 목록의 장소와 지도, 복사 옵션이 여기에 표시됩니다.</p></div>
          : workflow.detailState !== 'ready' ? <StatePanel context="detail" retry={workflow.retryDetail} state={workflow.detailState} />
            : workflow.detail === undefined ? <div className={styles.statePanel}><strong>목록 상세를 준비 중입니다</strong></div>
              : <DetailPanel MapRenderer={MapRenderer} detail={workflow.detail} workflow={workflow} />}
      </aside>
    </div>
  </section>
}

export function PublicCollectionDiscovery({ gateway, mapRenderer: MapRenderer }: Readonly<{
  gateway: DiscoveryGateway
  mapRenderer: PlaceMapRenderer
}>) {
  return <PublicCollectionDiscoveryView MapRenderer={MapRenderer} workflow={usePublicCollectionDiscovery(gateway)} />
}
