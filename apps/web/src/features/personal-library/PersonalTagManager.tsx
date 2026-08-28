'use client'

import type { PersonalTagManagement } from './personal-library-management'
import styles from './personal-library.module.css'

export function PersonalTagManager({
  management,
  metadataLoading,
  mutationKey,
}: Readonly<{
  management: PersonalTagManagement
  metadataLoading: boolean
  mutationKey?: string
}>) {
  const busy = mutationKey !== undefined
  const selected = management.tags.find((item) => item.tagId === management.selectedTagId)

  return (
    <section aria-labelledby="tag-management-title" className={styles.managementPanel}>
      <div className={styles.managementPanelHeading}>
        <div>
          <h2 id="tag-management-title">태그</h2>
          <p>장소 하나에 여러 개 붙일 수 있는 내 분류입니다.</p>
        </div>
        <span>{management.tags.length}개</span>
      </div>

      <form
        className={styles.managementCreate}
        onSubmit={(event) => {
          event.preventDefault()
          void management.createTag()
        }}
      >
        <label htmlFor="new-tag-name">새 태그 이름</label>
        <div>
          <input
            disabled={busy}
            id="new-tag-name"
            maxLength={64}
            onChange={(event) => management.setNewTagName(event.target.value)}
            placeholder="예: 혼밥"
            value={management.newTagName}
          />
          <button disabled={busy || !management.newTagValid} type="submit">만들기</button>
        </div>
      </form>

      <div className={styles.tagManagementBody}>
        <div aria-label="관리할 태그" className={styles.managementList}>
          {management.tags.map((item) => (
            <button
              aria-current={item.tagId === management.selectedTagId ? 'page' : undefined}
              disabled={busy}
              key={item.tagId}
              onClick={() => management.selectTag(item.tagId)}
              type="button"
            >
              <span>{item.name}</span>
              <small>{item.placeCount}</small>
            </button>
          ))}
          {!metadataLoading && management.tags.length === 0 && <p>아직 태그가 없습니다.</p>}
          {management.tagCursor !== undefined && (
            <button
              className={styles.managementMore}
              disabled={busy}
              onClick={() => void management.loadMoreTags()}
              type="button"
            >
              태그 더 보기
            </button>
          )}
        </div>

        <div className={styles.tagEditor}>
          {selected === undefined ? (
            <div className={styles.managementEmpty}>만들거나 관리할 태그를 선택하세요.</div>
          ) : (
            <>
              <form
                className={styles.renameForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  void management.renameTag()
                }}
              >
                <label htmlFor="tag-name">태그 이름</label>
                <div>
                  <input
                    disabled={busy}
                    id="tag-name"
                    maxLength={64}
                    onChange={(event) => management.setTagNameDraft(event.target.value)}
                    value={management.tagNameDraft}
                  />
                  <button disabled={busy || !management.tagNameValid} type="submit">이름 변경</button>
                </div>
              </form>
              <p className={styles.tagUsage}>현재 {selected.placeCount}개 장소에서 사용 중입니다.</p>
              <div className={styles.managementDanger}>
                {management.tagDeleteArmed ? (
                  <>
                    <span>태그와 모든 장소의 태그 연결을 삭제합니다. 장소 자체는 남습니다.</span>
                    <div>
                      <button
                        className={styles.dangerButton}
                        disabled={busy}
                        onClick={() => void management.deleteTag()}
                        type="button"
                      >
                        삭제 확인
                      </button>
                      <button disabled={busy} onClick={management.cancelTagDelete} type="button">취소</button>
                    </div>
                  </>
                ) : (
                  <button disabled={busy} onClick={management.armTagDelete} type="button">태그 삭제</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
