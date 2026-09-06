'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CatalogExplorationResponseV2 as CatalogExplorationResponse, CatalogSearchIntent } from '@place/contracts/search'
import type { CatalogHomeWorkflow } from '../catalog-home-workflow'
import { catalogHomeClient } from '../catalog-home-client'
import { catalogSearchNear } from './search-location'
import styles from './search-input.module.css'

export function CatalogSearchInput({ workflow, onSearch, requestNavigation }: Readonly<{
  workflow: CatalogHomeWorkflow; onSearch?: () => void; requestNavigation?: (action: () => void) => void
}>) {
  const [result, setResult] = useState<CatalogExplorationResponse>()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState('')
  const request = useRef(0)
  const listId = useId()
  useEffect(() => {
    const query = workflow.draftQuery.trim()
    setResult(undefined); setActive(-1)
    const sequence = ++request.current
    if (query.length < 2) { setStatus(''); return }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setStatus('후보를 찾는 중')
      void catalogHomeClient.explore(query, controller.signal, catalogSearchNear(workflow.viewport)).then((response) => {
        if (sequence !== request.current) return
        setResult(response); setStatus('')
      }).catch(() => { if (!controller.signal.aborted) setStatus('자동완성을 불러오지 못했습니다. 검색은 계속할 수 있어요.') })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [workflow.draftQuery])
  const navigate = (action: () => void) => requestNavigation ? requestNavigation(action) : action()
  const search = (intent: CatalogSearchIntent) => navigate(() => {
    setOpen(false); onSearch?.(); workflow.submitSearch(intent)
  })
  const choices = [
    ...(result?.destinations ?? []).map((destination) => ({
      key: destination.key, label: destination.name, detail: [destination.contextLabel,
        { country: '국가', city: '도시', 'administrative-area': '시도', locality: '시군구', neighborhood: '동네' }[destination.kind], '지도에서 보기'].filter(Boolean).join(' · '),
      action: () => navigate(() => { workflow.chooseDestination(destination); onSearch?.(); setOpen(false) }),
    })),
    ...(result?.places ?? []).map((place) => ({
      key: place.placeId, label: place.name, detail: [place.area?.label, place.primaryTaxonomy?.label].filter(Boolean).join(' · ') || '등록된 장소',
      action: () => navigate(() => { workflow.chooseCandidate(place); onSearch?.(); setOpen(false) }),
    })),
    ...(workflow.draftQuery.trim() ? [
      { key: 'name', label: `“${workflow.draftQuery.trim()}” 이름으로 찾기`, detail: '장소명·지역 검색', action: () => search('name') },
      ...(result?.conditions.length ? [{ key: 'conditions', label: result.conditions.map((token) => token.label).join(' · '), detail: '이 조건에 맞는 장소 찾기', action: () => search('conditions') }] : []),
    ] : []),
  ]
  const submit = () => {
    if (open && active >= 0 && choices[active]) { choices[active].action(); return }
    search('auto')
  }
  return <div className={styles.root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <nav aria-label="검색 대상" className={styles.scope}>
      <span aria-current="page">전체 장소</span>
      <a href={`/library?scope=favorites${workflow.draftQuery ? `&q=${encodeURIComponent(workflow.draftQuery)}` : ''}`}>즐겨찾기</a>
    </nav>
    <form role="search" className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <span aria-hidden="true">⌕</span>
      <input role="combobox" aria-label="곳곳간 카탈로그 검색" aria-expanded={open} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off" placeholder="장소명, 지역 또는 원하는 조건" maxLength={200}
        value={workflow.draftQuery} onChange={(event) => { workflow.changeDraftQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) { if (event.key === 'Enter') event.preventDefault(); return }
          if (event.key === 'Escape') { setOpen(false); setActive(-1) }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true)
            setActive((index) => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
          }
        }} />
      <button aria-label="카탈로그 검색 실행" type="submit">검색</button>
    </form>
    {open && workflow.draftQuery.trim() && <div className={styles.dropdown}>
      <ul id={listId} role="listbox" aria-label="검색 후보">
        {choices.map((choice, index) => <li id={`${listId}-${index}`} key={choice.key} role="option" aria-selected={active === index}>
          <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={choice.action}>
            <strong>{choice.label}</strong><small>{choice.detail}</small>
          </button>
        </li>)}
      </ul>
      {status && <p role="status">{status}</p>}
      <small className={styles.hint}>등록된 장소와 지리 참조를 찾습니다. 동네 좌표는 대표점이며 주소 전체를 제공하지 않습니다.
        {' '}지리 자료: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>
        {' '}(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>), Natural Earth.</small>
    </div>}
  </div>
}
