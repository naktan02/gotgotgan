'use client'

import styles from './collection-management.module.css'
import {
  useCollectionManagementWorkflow,
  type CollectionManagementWorkflow,
  type ManagedCollection,
} from './collection-management-workflow'

type PanelProperties = Readonly<{
  collection: ManagedCollection
  onAccessFailure: (status: number) => void
  onChanged: () => Promise<unknown>
}>

const visibilityDescription = {
  private: '나만 이 카테고리를 볼 수 있습니다.',
  unlisted: '링크를 받은 사람만 공개 장소 목록을 볼 수 있습니다.',
  public: '둘러보기와 공유 링크에서 공개 장소 목록을 볼 수 있습니다.',
} as const

export function CollectionManagementView({
  collectionName,
  workflow,
}: Readonly<{ collectionName: string; workflow: CollectionManagementWorkflow }>) {
  const busy = workflow.mutationKey !== undefined
  const shareAvailable = workflow.visibility !== 'private' && workflow.sharePath !== undefined

  return (
    <details className={styles.panel}>
      <summary>공개·장소 관리</summary>
      <div aria-busy={busy} className={styles.content}>
        <section aria-labelledby="collection-visibility-title" className={styles.section}>
          <div className={styles.heading}>
            <div>
              <h3 id="collection-visibility-title">공개 범위</h3>
              <p>{visibilityDescription[workflow.visibility]}</p>
            </div>
            <label>
              <span>공개 범위 선택</span>
              <select
                disabled={busy}
                onChange={(event) => void workflow.setVisibility(
                  event.target.value as typeof workflow.visibility,
                )}
                value={workflow.visibility}
              >
                <option value="private">나만 보기</option>
                <option value="unlisted">링크 공개</option>
                <option value="public">전체 공개</option>
              </select>
            </label>
          </div>
          {workflow.mutationKey === 'visibility' && <p role="status">공개 범위를 저장하는 중…</p>}
          {shareAvailable && (
            <div className={styles.shareRow}>
              <a href={workflow.sharePath} rel="noreferrer" target="_blank">공유 화면 미리보기</a>
              <button disabled={busy} onClick={() => void workflow.copyShareLink()} type="button">
                링크 복사
              </button>
            </div>
          )}
          <small>개인 메모·평점·방문 기록·개인 태그는 공개되지 않습니다.</small>
          {workflow.copyMessage !== undefined && <p aria-live="polite">{workflow.copyMessage}</p>}
        </section>

        <section aria-labelledby="collection-order-title" className={styles.section}>
          <div className={styles.heading}>
            <div>
              <h3 id="collection-order-title">장소 순서</h3>
              <p>{collectionName} 안의 표시 순서를 조정하거나 장소를 제외합니다.</p>
            </div>
          </div>
          {workflow.loading ? (
            <p role="status">장소 순서를 불러오는 중…</p>
          ) : workflow.places.length === 0 ? (
            <p>이 카테고리에 정리할 장소가 없습니다.</p>
          ) : (
            <ol className={styles.placeList}>
              {workflow.places.map((row, index) => {
                const name = row.place?.name ?? '장소 정보 준비 중'
                const removing = workflow.removeArmedPlaceId === row.placeId
                const mutating = workflow.mutationKey?.endsWith(row.placeId) ?? false
                return (
                  <li key={row.placeId}>
                    <span aria-hidden="true">{index + 1}</span>
                    <strong>{name}</strong>
                    <div className={styles.actions}>
                      <button
                        aria-label={`${name} 위로 이동`}
                        disabled={busy || index === 0}
                        onClick={() => void workflow.movePlace(row.placeId, 'up')}
                        type="button"
                      >↑</button>
                      <button
                        aria-label={`${name} 아래로 이동`}
                        disabled={busy || index === workflow.places.length - 1}
                        onClick={() => void workflow.movePlace(row.placeId, 'down')}
                        type="button"
                      >↓</button>
                      {removing ? (
                        <>
                          <button
                            className={styles.danger}
                            disabled={busy}
                            onClick={() => void workflow.removePlace(row.placeId)}
                            type="button"
                          >제외 확인</button>
                          <button disabled={busy} onClick={workflow.cancelRemove} type="button">취소</button>
                        </>
                      ) : (
                        <button
                          aria-label={`${name} 카테고리에서 제외`}
                          className={styles.danger}
                          disabled={busy}
                          onClick={() => workflow.armRemove(row.placeId)}
                          type="button"
                        >제외</button>
                      )}
                    </div>
                    {mutating && <small role="status">적용 중…</small>}
                  </li>
                )
              })}
            </ol>
          )}
          {workflow.nextCursor !== undefined && (
            <button
              className={styles.more}
              disabled={busy || workflow.loadingMore}
              onClick={() => void workflow.loadMore()}
              type="button"
            >{workflow.loadingMore ? '불러오는 중…' : '장소 더 보기'}</button>
          )}
        </section>

        {workflow.error !== undefined && (
          <div className={styles.error} role="alert">
            <span>{workflow.error}</span>
            <button disabled={busy} onClick={() => void workflow.retry()} type="button">다시 시도</button>
          </div>
        )}
      </div>
    </details>
  )
}

export function CollectionManagementPanel(properties: PanelProperties) {
  const workflow = useCollectionManagementWorkflow(properties)
  return <CollectionManagementView collectionName={properties.collection.name} workflow={workflow} />
}
