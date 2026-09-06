'use client'

import { taxonomyProjectionSchema, type TaxonomyNode } from '@place/contracts/search'
import { useEffect, useId, useRef, useState } from 'react'
import { taxonomyCandidates, taxonomyTrail } from './taxonomy-navigation'
import styles from './taxonomy-picker.module.css'

export type TaxonomyPickerProps = Readonly<{
  selectedLabel?: string
  onSelect: (label: string, key: string) => void
  onClose: () => void
}>

type LoadState = 'loading' | 'ready' | 'error'
const pageSize = 12

export function TaxonomyPickerView({ nodes, status, onRetry, ...props }: TaxonomyPickerProps & Readonly<{
  nodes: readonly TaxonomyNode[]; status: LoadState; onRetry: () => void
}>) {
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [parentKey, setParentKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const trail = taxonomyTrail(nodes, parentKey)
  const current = trail.at(-1)
  const matching = taxonomyCandidates(nodes, parentKey, query)
  const branches = new Set(nodes.map((node) => node.parentKey))
  const browse = (key: string | null) => {
    setParentKey(key); setQuery(''); setLimit(pageSize)
    requestAnimationFrame(() => heading.current?.focus())
  }
  const select = (node: TaxonomyNode) => { props.onSelect(node.label, node.key); props.onClose() }

  return <section className={styles.picker} aria-labelledby={titleId}>
    <header>
      <h2 id={titleId} ref={heading} tabIndex={-1}>장소·음식 분류</h2>
      <p>분류 이름을 누르면 전체 선택, 화살표를 누르면 하위 분류를 봅니다.</p>
      {props.selectedLabel && <p>선택한 분류 · <strong>{props.selectedLabel}</strong></p>}
      <nav aria-label="분류 경로" className={styles.trail}>
        <button type="button" aria-current={parentKey === null ? 'location' : undefined} onClick={() => browse(null)}>전체 분류</button>
        {trail.map((node) => <span key={node.key}><span aria-hidden="true">›</span><button type="button"
          aria-current={node.key === parentKey ? 'location' : undefined} onClick={() => browse(node.key)}>{node.label}</button></span>)}
      </nav>
      <details className={styles.searchDisclosure} key={parentKey ?? 'root'}>
      <summary>분류 이름으로 찾기</summary>
      <label className={styles.search}>
        <span>{current ? `${current.label} 안에서 찾기` : '분류 이름으로 찾기'}</span>
        <input type="search" value={query} maxLength={160} placeholder="예: 라멘, 쇼유라멘"
          onChange={(event) => { setQuery(event.target.value); setLimit(pageSize) }} />
      </label>
      </details>
      {current && <button className={styles.selectCurrent} type="button" onClick={() => select(current)}>{current.label} 전체 선택</button>}
    </header>
    <div className={styles.body}>
      {status === 'loading' ? <p role="status">분류를 불러오는 중…</p> : status === 'error' ? <div role="alert">
        <p>분류를 불러오지 못했습니다. 검색어로 장소를 찾을 수 있습니다.</p><button type="button" onClick={onRetry}>다시 시도</button>
      </div> : nodes.length === 0 ? <div className={styles.empty}>
        <strong>세부 분류 준비 중</strong><p>아직 확인된 분류가 없습니다. 검색어로 찾기를 이용해 주세요.</p>
        <button type="button" onClick={props.onClose}>검색어로 찾기</button>
      </div> : <>
        <ul className={styles.options}>
          {matching.slice(0, limit).map((node) => {
            const hasChildren = branches.has(node.key)
            const path = query.trim() ? taxonomyTrail(nodes, node.key).slice(0, -1).map((parent) => parent.label).join(' › ') : ''
            return <li key={node.key}><button type="button" aria-label={hasChildren ? `${node.label} 전체 선택` : `${node.label} 선택`}
              onClick={() => select(node)}>
              <span><strong>{node.label}</strong>{path && <small>{path}</small>}</span>
              <small>{hasChildren ? '전체 선택' : '선택'}</small>
            </button>{hasChildren && <button className={styles.drill} type="button"
              aria-label={`${node.label} 하위 분류 보기`} onClick={() => browse(node.key)}>
              <span>하위 분류</span><span aria-hidden="true">›</span>
            </button>}</li>
          })}
        </ul>
        {matching.length === 0 && <p>일치하는 하위 분류가 없습니다. 검색어를 바꾸거나 상위 분류로 돌아가세요.</p>}
        {matching.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(limit + pageSize)}>분류 더 보기 ({Math.min(limit, matching.length)}/{matching.length})</button>}
      </>}
    </div>
    <footer>장소 분류는 내 즐겨찾기 카테고리·개인 태그와 다릅니다. 분류가 없다는 뜻이 판매하지 않는다는 뜻은 아닙니다.</footer>
  </section>
}

export function TaxonomyPicker(props: TaxonomyPickerProps) {
  const [nodes, setNodes] = useState<readonly TaxonomyNode[]>([])
  const [status, setStatus] = useState<LoadState>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    void fetch('/api/search/taxonomy', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('taxonomy-unavailable')
        return taxonomyProjectionSchema.parse(await response.json())
      }).then((projection) => {
        if (!controller.signal.aborted) { setNodes(projection.nodes); setStatus('ready') }
      }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [revision])
  return <TaxonomyPickerView {...props} nodes={nodes} status={status} onRetry={() => setRevision((value) => value + 1)} />
}
