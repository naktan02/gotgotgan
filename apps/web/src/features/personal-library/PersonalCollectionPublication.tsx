'use client'

import { useEffect, useState } from 'react'

import type { PersonalCollectionManagement } from './personal-library-management'
import styles from './personal-collection-publication.module.css'

type CollectionPublication = NonNullable<PersonalCollectionManagement['publication']>

export function PersonalCollectionPublication({
  busy,
  publication,
}: Readonly<{
  busy: boolean
  publication: CollectionPublication
}>) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => setCopyState('idle'), [publication.sharePath])

  const copyShareLink = async () => {
    if (publication.sharePath === undefined || navigator.clipboard === undefined) {
      setCopyState('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publication.sharePath}`)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <section aria-label="컬렉션 공유" className={styles.panel}>
      <div className={styles.heading}>
        <strong>공유</strong>
        <span>
          {publication.visibility === 'private'
            ? '나만 보기'
            : publication.visibility === 'unlisted'
              ? '링크를 아는 사람'
              : '전체 공개'}
        </span>
      </div>
      <small className={styles.hint}>
        개인 평점·태그·방문·메모는 포함하지 않고 장소 순서만 공개합니다.
      </small>
      {publication.sharePath !== undefined && (
        <div className={styles.link}>
          <a href={publication.sharePath} rel="noreferrer" target="_blank">공유 화면 열기</a>
          <button disabled={busy} onClick={() => void copyShareLink()} type="button">
            {copyState === 'copied' ? '복사됨' : '링크 복사'}
          </button>
          {copyState === 'failed' && <span role="alert">주소를 복사하지 못했습니다.</span>}
        </div>
      )}
      <div className={styles.actions}>
        {publication.visibility !== 'unlisted' && (
          <button
            disabled={busy}
            onClick={() => void publication.setVisibility('unlisted')}
            type="button"
          >
            링크로 공유
          </button>
        )}
        {publication.visibility !== 'public' && (
          <button
            disabled={busy}
            onClick={() => void publication.setVisibility('public')}
            type="button"
          >
            전체 공개
          </button>
        )}
        {publication.visibility !== 'private' && (
          <button
            className={styles.danger}
            disabled={busy}
            onClick={() => void publication.setVisibility('private')}
            type="button"
          >
            공유 해제
          </button>
        )}
      </div>
    </section>
  )
}
