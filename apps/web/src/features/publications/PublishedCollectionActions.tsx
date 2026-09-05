'use client'

import { useRef, useState } from 'react'

import {
  createPublishedCollectionCopyAttempt,
  PublishedCollectionCopyProblem,
} from '@/platform/library/published-collection-copy'

import styles from './publication.module.css'

export function PublishedCollectionActions({
  name,
  publicationId,
}: Readonly<{ name: string; publicationId: string }>) {
  const [state, setState] = useState<
    | Readonly<{ kind: 'idle' | 'saving' | 'authentication-required' | 'failed' }>
    | Readonly<{ kind: 'copied'; collectionId: string }>
  >({ kind: 'idle' })
  const attempt = useRef<ReturnType<typeof createPublishedCollectionCopyAttempt> | undefined>(undefined)

  const copy = async () => {
    if (state.kind === 'saving' || state.kind === 'copied') return
    setState({ kind: 'saving' })
    try {
      attempt.current ??= createPublishedCollectionCopyAttempt(publicationId, name)
      const collectionId = await attempt.current.execute()
      setState({ kind: 'copied', collectionId })
    } catch (error) {
      setState({
        kind: error instanceof PublishedCollectionCopyProblem && error.status === 401
          ? 'authentication-required'
          : 'failed',
      })
    }
  }

  return (
    <section aria-label="내 곳곳간으로 복사" className={styles.actions}>
      <p>장소와 순서만 내 비공개 컬렉션으로 복사합니다. 원본 소유권과 개인 기록은 따라오지 않습니다.</p>
      {state.kind === 'copied' ? (
        <a href="/library">내 곳곳간에서 보기</a>
      ) : (
        <button disabled={state.kind === 'saving'} onClick={() => void copy()} type="button">
          {state.kind === 'saving' ? '복사하는 중…' : '내 곳곳간으로 복사'}
        </button>
      )}
      {state.kind === 'authentication-required' && (
        <p role="alert">로그인이 필요합니다. <a href="/api/auth/oidc/start">로그인하고 계속</a></p>
      )}
      {state.kind === 'failed' && <p role="alert">지금은 복사할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>}
    </section>
  )
}
