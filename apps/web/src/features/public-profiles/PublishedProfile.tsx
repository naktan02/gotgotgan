'use client'

import type { PublicProfileProjection } from '@place/contracts/profiles'
import { useState } from 'react'

import { publicProfileHttp } from '@/platform/profiles/public-profile-http'

import styles from './public-profiles.module.css'

export function PublishedProfile({ initial }: Readonly<{ initial: PublicProfileProjection }>) {
  const [collections, setCollections] = useState(initial.collections)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function loadMore() {
    if (nextCursor === undefined || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const page = await publicProfileHttp.published(initial.handle, { limit: 20, cursor: nextCursor })
      const known = new Set(collections.map((collection) => collection.publicationId))
      setCollections([...collections, ...page.collections.filter((collection) => !known.has(collection.publicationId))])
      setNextCursor(page.nextCursor)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return <section aria-labelledby="published-profile-title" className={styles.published}>
    <header>
      <p>@{initial.handle}</p>
      <h1 id="published-profile-title">{initial.displayName}</h1>
      <span>전체 공개 컬렉션</span>
    </header>
    {collections.length === 0 ? <p className={styles.empty}>공개된 컬렉션이 아직 없습니다.</p> : (
      <ul aria-label="공개 컬렉션">
        {collections.map((collection) => <li key={collection.publicationId}>
          <a href={`/share/collections/${collection.publicationId}`}>
            <strong>{collection.name}</strong>
            <span>{collection.description ?? '설명 없음'}</span>
            <small>장소 {collection.placeCount}개</small>
          </a>
        </li>)}
      </ul>
    )}
    {failed && <p className={styles.loadError} role="alert">다음 공개 컬렉션을 불러오지 못했습니다.</p>}
    {nextCursor !== undefined && (
      <button disabled={loading} onClick={() => void loadMore()} type="button">
        {loading ? '불러오는 중…' : '컬렉션 더 보기'}
      </button>
    )}
    <footer>이 페이지는 외부 검색엔진의 색인을 허용하지 않습니다.</footer>
  </section>
}
