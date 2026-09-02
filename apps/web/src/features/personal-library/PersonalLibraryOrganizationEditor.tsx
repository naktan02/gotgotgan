'use client'

import styles from './personal-place-detail.module.css'
import type { PersonalPlaceDetailWorkflow } from './personal-place-detail-workflow'

type OrganizationEditorProps = Readonly<{
  workflow: Pick<
    PersonalPlaceDetailWorkflow,
    | 'organizationItems'
    | 'organizationCursor'
    | 'organizationLoading'
    | 'organizationLoadingMore'
    | 'organizationMutationKey'
    | 'organizationError'
    | 'loadMoreOrganization'
    | 'retryOrganization'
    | 'toggleCollectionMembership'
    | 'toggleTagMembership'
  >
}>

export function PersonalLibraryOrganizationEditor({
  workflow,
  showCollections = true,
}: OrganizationEditorProps & Readonly<{ showCollections?: boolean }>) {
  const collections = workflow.organizationItems.filter((item) => item.kind === 'collection')
  const tags = workflow.organizationItems.filter((item) => item.kind === 'tag')
  const visibleItemCount = tags.length + (showCollections ? collections.length : 0)

  return (
    <section aria-labelledby="personal-organization-title" className={styles.organization}>
      <div className={styles.organizationHeading}>
        <div>
          <h3 id="personal-organization-title">{showCollections ? '내 분류' : '개인 태그'}</h3>
          <p>{showCollections ? '내 카테고리와 태그를 관리합니다.' : '이 장소의 개인 태그를 관리합니다.'}</p>
        </div>
        {workflow.organizationLoading && <span>불러오는 중…</span>}
      </div>

      {workflow.organizationError !== undefined && (
        <div className={styles.organizationError} role="alert">
          <span>{workflow.organizationError}</span>
          <button onClick={() => void workflow.retryOrganization()} type="button">다시 시도</button>
        </div>
      )}

      {!workflow.organizationLoading && visibleItemCount === 0 ? (
        <p className={styles.organizationEmpty}>{showCollections ? '아직 사용할 카테고리나 태그가 없습니다.' : '아직 사용할 태그가 없습니다.'}</p>
      ) : (
        <>
          {showCollections && collections.length > 0 && (
            <div className={styles.organizationGroup}>
              <strong>컬렉션</strong>
              <div>
                {collections.map((collection) => {
                  const mutationKey = `collection:${collection.collectionId}`
                  return (
                    <button
                      aria-pressed={collection.selected}
                      disabled={workflow.organizationMutationKey !== undefined}
                      key={collection.collectionId}
                      onClick={() => void workflow.toggleCollectionMembership(
                        collection.collectionId,
                        collection.selected,
                      )}
                      type="button"
                    >
                      <span>{collection.name}</span>
                      <small>
                        {workflow.organizationMutationKey === mutationKey
                          ? '저장 중…'
                          : collection.selected ? '포함됨' : '추가'}
                      </small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div className={styles.organizationGroup}>
              <strong>태그</strong>
              <div>
                {tags.map((tag) => {
                  const mutationKey = `tag:${tag.tagId}`
                  return (
                    <button
                      aria-pressed={tag.selected}
                      disabled={workflow.organizationMutationKey !== undefined}
                      key={tag.tagId}
                      onClick={() => void workflow.toggleTagMembership(tag.tagId, tag.selected)}
                      type="button"
                    >
                      <span>{tag.name}</span>
                      <small>
                        {workflow.organizationMutationKey === mutationKey
                          ? '저장 중…'
                          : tag.selected ? '포함됨' : '추가'}
                      </small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {workflow.organizationCursor !== undefined && (
        <button
          className={styles.organizationMore}
          disabled={workflow.organizationLoadingMore}
          onClick={() => void workflow.loadMoreOrganization()}
          type="button"
        >
          {workflow.organizationLoadingMore ? '불러오는 중…' : '내 분류 더 보기'}
        </button>
      )}
    </section>
  )
}
