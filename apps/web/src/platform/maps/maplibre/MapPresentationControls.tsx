'use client'

import { useEffect, useRef } from 'react'
import type { PlaceMapCluster } from '../place-map-interface'
import type { MapMarkerMode } from './marker-presentation'
import styles from './maplibre-place-map.module.css'

export function MapPresentationControls({ mode, onModeChange }: Readonly<{
  mode: MapMarkerMode; onModeChange: (mode: MapMarkerMode) => void
}>) {
  const ref = useRef<HTMLDetailsElement>(null)
  return <details ref={ref} className={styles.presentation} onKeyDown={(event) => {
    if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus() }
  }}>
    <summary aria-label="지도 장소 표시 설정">표시 <span aria-hidden="true">⌄</span></summary>
    <fieldset><legend>장소 표시</legend>
      {([['circle', '원'], ['category', '큰 유형 아이콘'], ['detail', '세부 유형 아이콘']] as const).map(([value, label]) => (
        <label key={value}><input type="radio" name="map-marker-mode" value={value} checked={mode === value}
          onChange={() => onModeChange(value)} />{label}</label>
      ))}
      <p>멀리서는 점으로, 가까이서는 아이콘과 이름으로 표시합니다. 분류가 없으면 기본 점을 사용합니다.</p>
    </fieldset>
  </details>
}

export function CoincidentPlaceChoices({ cluster, onClose, onSelect, onOpenPlaceList }: Readonly<{
  cluster: PlaceMapCluster; onClose: () => void; onSelect: (id: string) => void; onOpenPlaceList?: () => void
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  const preview = cluster.coincidentPreview
  if (preview == null) return null
  return <dialog ref={dialogRef} className={styles.choices} aria-labelledby="coincident-place-title"
    onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <header><h2 id="coincident-place-title">같은 위치의 장소 {cluster.count}개</h2>
      <button type="button" aria-label="장소 선택 닫기" onClick={onClose}>×</button></header>
    <p>건물이나 주소가 같아도 서로 다른 장소입니다.</p>
    <ul>{preview.places.map((place) => <li key={place.placeId}><button type="button" onClick={() => { onClose(); onSelect(place.placeId) }}>
      <span>{place.label}</span><small>{place.classification?.primaryTaxonomy.label ?? '분류 미확인'}</small>
    </button></li>)}</ul>
    {preview.remainingCount > 0 && <footer><p>처음 {preview.places.length}개만 표시했습니다. 나머지 {preview.remainingCount}개는 현재 목록에서 확인해 주세요.</p>
      {onOpenPlaceList !== undefined && <button type="button" onClick={() => { onClose(); onOpenPlaceList() }}>현재 목록 펼치기</button>}
    </footer>}
  </dialog>
}
