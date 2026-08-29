'use client'

import { PersonalCollectionPublication } from './PersonalCollectionPublication'
import type { PersonalCollectionManagement } from './personal-library-management'
import styles from './personal-library.module.css'

export function PersonalCollectionManager({
  management,
  metadataLoading,
  mutationKey,
}: Readonly<{
  management: PersonalCollectionManagement
  metadataLoading: boolean
  mutationKey?: string
}>) {
  const busy = mutationKey !== undefined
  const selected = management.collections.find((item) => (
    item.collectionId === management.selectedCollectionId
  ))

  return (
    <section aria-labelledby="collection-management-title" className={styles.managementPanel}>
      <div className={styles.managementPanelHeading}>
        <div>
          <h2 id="collection-management-title">컬렉션</h2>
          <p>장소를 담는 순서 있는 목록입니다.</p>
        </div>
        <span>{management.collections.length}개</span>
      </div>

      <form
        className={styles.managementCreate}
        onSubmit={(event) => {
          event.preventDefault()
          void management.createCollection()
        }}
      >
        <label htmlFor="new-collection-name">새 컬렉션 이름</label>
        <div>
          <input
            disabled={busy}
            id="new-collection-name"
            maxLength={120}
            onChange={(event) => management.setNewCollectionName(event.target.value)}
            placeholder="예: 성수 라멘"
            value={management.newCollectionName}
          />
          <button disabled={busy || !management.newCollectionValid} type="submit">만들기</button>
        </div>
        <small className={styles.managementHint}>새 컬렉션은 Place에서 비공개로 생성됩니다.</small>
      </form>

      <div className={styles.collectionManagementBody}>
        <nav aria-label="관리할 컬렉션" className={styles.managementList}>
          {management.collections.map((item) => (
            <button
              aria-current={item.collectionId === management.selectedCollectionId ? 'page' : undefined}
              disabled={busy}
              key={item.collectionId}
              onClick={() => management.selectCollection(item.collectionId)}
              type="button"
            >
              <span>{item.name}</span>
              <small>{item.placeCount}</small>
            </button>
          ))}
          {!metadataLoading && management.collections.length === 0 && (
            <p>아직 컬렉션이 없습니다.</p>
          )}
          {management.collectionCursor !== undefined && (
            <button
              className={styles.managementMore}
              disabled={busy}
              onClick={() => void management.loadMoreCollections()}
              type="button"
            >
              컬렉션 더 보기
            </button>
          )}
        </nav>

        <div className={styles.collectionEditor}>
          {selected === undefined ? (
            <div className={styles.managementEmpty}>만들거나 관리할 컬렉션을 선택하세요.</div>
          ) : (
            <>
              <form
                className={styles.renameForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  void management.renameCollection()
                }}
              >
                <label htmlFor="collection-name">컬렉션 이름</label>
                <div>
                  <input
                    disabled={busy}
                    id="collection-name"
                    maxLength={120}
                    onChange={(event) => management.setCollectionNameDraft(event.target.value)}
                    value={management.collectionNameDraft}
                  />
                  <button disabled={busy || !management.collectionNameValid} type="submit">이름 변경</button>
                </div>
              </form>

              {management.publication !== undefined && (
                <PersonalCollectionPublication
                  busy={busy}
                  key={selected.collectionId}
                  publication={management.publication}
                />
              )}

              <div className={styles.managementDanger}>
                {management.collectionDeleteArmed ? (
                  <>
                    <span>Place에서 이 컬렉션과 목록 구성을 삭제합니다.</span>
                    <div>
                      <button
                        className={styles.dangerButton}
                        disabled={busy}
                        onClick={() => void management.deleteCollection()}
                        type="button"
                      >
                        삭제 확인
                      </button>
                      <button disabled={busy} onClick={management.cancelCollectionDelete} type="button">취소</button>
                    </div>
                  </>
                ) : (
                  <button disabled={busy} onClick={management.armCollectionDelete} type="button">컬렉션 삭제</button>
                )}
              </div>

              <div className={styles.managedPlaces}>
                <div>
                  <strong>장소 순서</strong>
                  <span>{management.collection?.placeCount ?? selected.placeCount}개</span>
                </div>
                <small className={styles.managementHint}>
                  여기서 제거해도 저장 상태와 Provider 원본 즐겨찾기는 남습니다.
                </small>
                {management.collectionLoading ? (
                  <p>장소를 불러오는 중…</p>
                ) : management.collectionPlaces.length === 0 ? (
                  <p>이 컬렉션에는 아직 장소가 없습니다.</p>
                ) : (
                  <ol>
                    {management.collectionPlaces.map((item, index) => {
                      const name = item.place?.name ?? '장소 정보 동기화 중'
                      const rowBusy = busy && mutationKey?.includes(item.placeId)
                      return (
                        <li key={item.placeId}>
                          <span className={styles.placeOrder}>{index + 1}</span>
                          <div>
                            <strong>{name}</strong>
                            <small>{item.place?.areaLabel ?? '지역 정보 없음'}</small>
                          </div>
                          <div className={styles.placeOrderActions}>
                            <button
                              aria-label={`${name} 위로 이동`}
                              disabled={busy || index === 0}
                              onClick={() => void management.moveCollectionPlace(item.placeId, -1)}
                              type="button"
                            >
                              위
                            </button>
                            <button
                              aria-label={`${name} 아래로 이동`}
                              disabled={busy || index === management.collectionPlaces.length - 1}
                              onClick={() => void management.moveCollectionPlace(item.placeId, 1)}
                              type="button"
                            >
                              아래
                            </button>
                            <button
                              aria-label={`${name} 컬렉션에서 제거`}
                              className={styles.textDanger}
                              disabled={busy}
                              onClick={() => void management.removeCollectionPlace(item.placeId)}
                              type="button"
                            >
                              제거
                            </button>
                          </div>
                          {rowBusy && <span className={styles.savingLabel}>저장 중…</span>}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {management.collectionPlacesCursor !== undefined && (
                  <button
                    className={styles.managementMore}
                    disabled={busy || management.collectionLoadingMore}
                    onClick={() => void management.loadMoreCollectionPlaces()}
                    type="button"
                  >
                    {management.collectionLoadingMore ? '불러오는 중…' : '장소 더 보기'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
