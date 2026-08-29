'use client'

import type { PublicPlaceDetailResponse } from '@place/contracts/places'
import { useEffect, useState } from 'react'

import {
  PublishedCollectionHttpProblem,
  publishedCollectionHttp,
} from '@/platform/publications/published-collection-http'

import styles from './publication.module.css'

type DetailState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'available'; detail: PublicPlaceDetailResponse }>
  | Readonly<{ kind: 'not-found' | 'retired' | 'unavailable' }>

const evidenceLabels: Readonly<Record<PublicPlaceDetailResponse['evidence']['status'], string>> = {
  verified: '확인됨',
  unverified: '확인 필요',
  conflicted: '정보 충돌',
  stale: '업데이트 필요',
}

export function PublishedPlaceDetail({
  placeId,
  onClose,
}: Readonly<{
  placeId: string
  onClose: () => void
}>) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<DetailState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ kind: 'loading' })
    void publishedCollectionHttp.place(placeId, controller.signal).then((detail) => {
      if (active) setState({ kind: 'available', detail })
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof PublishedCollectionHttpProblem && error.status === 404) {
        setState({ kind: 'not-found' })
      } else if (error instanceof PublishedCollectionHttpProblem && error.status === 410) {
        setState({ kind: 'retired' })
      } else {
        setState({ kind: 'unavailable' })
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [placeId, revision])

  return (
    <section aria-label="공개 장소 상세" className={styles.placeDetail}>
      <div className={styles.placeDetailBar}>
        <strong>장소 상세</strong>
        <button onClick={onClose} type="button">닫기</button>
      </div>
      {state.kind === 'loading' && <p role="status">장소 상세를 불러오는 중…</p>}
      {state.kind === 'not-found' && <p role="alert">이 장소를 찾을 수 없습니다.</p>}
      {state.kind === 'retired' && <p role="status">통합 또는 종료되어 더 이상 제공하지 않는 장소입니다.</p>}
      {state.kind === 'unavailable' && (
        <div className={styles.placeDetailError} role="alert">
          <span>장소 상세를 지금 불러올 수 없습니다.</span>
          <button onClick={() => setRevision((value) => value + 1)} type="button">다시 시도</button>
        </div>
      )}
      {state.kind === 'available' && (
        <div className={styles.placeDetailContent}>
          <p>{state.detail.primaryTaxonomy?.label ?? '분류 미확인'}</p>
          <h2>{state.detail.name}</h2>
          <span>{state.detail.areaLabel ?? '지역 정보 없음'}</span>
          <dl>
            <div>
              <dt>정보 상태</dt>
              <dd>{evidenceLabels[state.detail.evidence.status]}</dd>
            </div>
            <div>
              <dt>위치</dt>
              <dd>
                {state.detail.location.latitude.toFixed(5)}, {' '}
                {state.detail.location.longitude.toFixed(5)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}
