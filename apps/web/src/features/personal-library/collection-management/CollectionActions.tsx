'use client'

import type { CollectionColorToken, PersonalLibraryCollectionSummaryV2 } from '@place/contracts/library'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { collectionColorOptions } from '../library-map/collection-color-palette'
import { CollectionManagementPanel } from './CollectionManagementPanel'
import styles from './collection-actions.module.css'

type Action = 'rename' | 'color' | 'manage' | 'delete'
const labels = { rename: '이름 변경', color: '목록 색상', manage: '공개·공유 및 장소 관리', delete: '목록 삭제' } as const

export function CollectionActions({ collection, colorToken, busy, error, onRename, onColor, onDelete, onAccessFailure, onChanged }: Readonly<{
  collection: PersonalLibraryCollectionSummaryV2; busy: boolean; error?: string
  colorToken?: CollectionColorToken
  onRename: (name: string) => Promise<boolean>; onDelete: () => Promise<boolean>
  onColor: (colorToken: CollectionColorToken) => Promise<boolean>
  onAccessFailure: (status: number) => void; onChanged: () => Promise<unknown>
}>) {
  const [action, setAction] = useState<Action>()
  const titleId = useId()
  const [name, setName] = useState(collection.name)
  const [color, setColor] = useState<CollectionColorToken>(colorToken ?? 'fern')
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const menu = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (action) dialog.current?.showModal()
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus() }
  }, [action])
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current) menu.current.open = false }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const choose = (value: Action) => {
    setName(collection.name); setColor(colorToken ?? 'fern'); setAction(value)
    if (menu.current) menu.current.open = false
  }
  return <div className={styles.actions}>
    <details ref={menu} className={styles.menu} onToggle={() => {
      if (!menu.current?.open) return
      const bounds = trigger.current?.getBoundingClientRect()
      if (bounds) setMenuPosition({ left: Math.max(8, Math.min(innerWidth - 228, bounds.right - 220)), top: Math.max(8, Math.min(bounds.bottom, innerHeight - 164)) })
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); if (menu.current) menu.current.open = false; trigger.current?.focus() }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); if (menu.current) menu.current.open = true
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
      const current = items.findIndex((item) => item === document.activeElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[index]?.focus()
    }}>
      <summary ref={trigger} aria-label={`${collection.name} 더보기`} aria-haspopup="menu">⋯</summary>
      <div role="menu" aria-label={`${collection.name} 관리`} style={menuPosition}>
        {(Object.keys(labels) as Action[]).map((value) => <button key={value} role="menuitem" type="button" onClick={() => choose(value)}>{labels[value]}</button>)}
      </div>
    </details>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) setAction(undefined) }}>
      <header><h2 id={titleId}>{action && labels[action]}</h2><button disabled={busy} type="button" aria-label="목록 관리 닫기" onClick={() => setAction(undefined)}>×</button></header>
      {action === 'rename' && <form onSubmit={(event) => { event.preventDefault(); void onRename(name).then((saved) => { if (saved) setAction(undefined) }) }}>
        <label>목록 이름<input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button disabled={busy || !name.trim() || name.trim() === collection.name} type="submit">이름 저장</button>
      </form>}
      {action === 'color' && <form onSubmit={(event) => { event.preventDefault(); void onColor(color).then((saved) => { if (saved) setAction(undefined) }) }}>
        <fieldset className={styles.colors}><legend>지도와 범례에 사용할 색상</legend>
          {collectionColorOptions.map((option) => <button aria-label={`${collection.name} ${option.token} 색상`}
            aria-pressed={color === option.token} key={option.token} onClick={() => setColor(option.token)}
            style={{ '--collection-color': option.value } as CSSProperties} type="button"><span aria-hidden="true" /></button>)}
        </fieldset>
        <p>색상과 함께 목록 이름도 항상 표시됩니다.</p>
        <button disabled={busy || color === colorToken} type="submit">색상 저장</button>
      </form>}
      {action === 'delete' && <div><p><strong>{collection.name}</strong> 목록을 삭제할까요?</p><p>이 목록과 공유 링크가 삭제됩니다. 다른 목록과 개인 평점·메모·방문 기록은 유지됩니다.</p>
        <button className={styles.danger} disabled={busy} type="button" onClick={() => void onDelete().then((deleted) => { if (deleted) setAction(undefined) })}>목록 삭제 확인</button></div>}
      {action === 'manage' && <CollectionManagementPanel expanded collection={collection} onAccessFailure={onAccessFailure} onChanged={onChanged} />}
      {error && <p role="alert">{error}</p>}
    </dialog>
  </div>
}
