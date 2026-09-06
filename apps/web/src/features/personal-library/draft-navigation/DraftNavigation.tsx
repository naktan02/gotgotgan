'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import styles from './draft-navigation.module.css'

export type PersonalPlaceNavigation = Readonly<{ requestNavigation: (action: () => void) => void }>
export type PlaceDraft = Readonly<{
  label: string; dirty: boolean; saving: boolean; valid: boolean
  save: () => Promise<unknown> | undefined; discard: () => void
}>

export function DraftNavigation({ navigationRef, drafts }: Readonly<{
  navigationRef?: Ref<PersonalPlaceNavigation>; drafts: readonly PlaceDraft[]
}>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<(() => void) | undefined>(undefined)
  const origin = useRef<HTMLElement | null>(null)
  const approvedNavigation = useRef(false)
  approvedNavigation.current = false
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const dirty = drafts.filter((draft) => draft.dirty)
  const busy = saving || drafts.some((draft) => draft.saving)
  const requestNavigation = (action: () => void) => {
    if (dirty.length === 0 && !busy) { action(); return }
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pending.current = action; setError(false); setOpen(true)
  }
  useImperativeHandle(navigationRef, () => ({ requestNavigation }))
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else if (dialog.current?.open) { dialog.current.close(); origin.current?.focus() }
  }, [open])
  useEffect(() => {
    if (dirty.length === 0 && !busy) return
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!approvedNavigation.current) { event.preventDefault(); event.returnValue = '' } }
    const leaveByLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target || link.hasAttribute('download') || link.getAttribute('href')?.startsWith('#')) return
      const destination = new URL(link.href, location.href)
      if (destination.origin !== location.origin) return
      event.preventDefault(); event.stopPropagation()
      requestNavigation(() => location.assign(destination.href))
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', leaveByLink, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', leaveByLink, true) }
  })
  const finish = () => { const action = pending.current; pending.current = undefined; approvedNavigation.current = true; setOpen(false); action?.() }
  const save = async () => {
    setSaving(true); setError(false)
    try {
      for (const draft of dirty) {
        if (!draft.valid || await draft.save() !== true) { setError(true); return }
      }
      finish()
    } catch { setError(true) } finally { setSaving(false) }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="unsaved-place-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) { pending.current = undefined; setOpen(false) } }}>
    <h2 id="unsaved-place-title">저장하지 않은 변경이 있어요</h2>
    <p>{dirty.map((draft) => draft.label).join(' · ') || '저장 중인 변경'}을 확인한 뒤 이동해 주세요.</p>
    {error && <p role="alert">변경을 모두 저장하지 못했습니다. 계속 작성에서 내용을 확인해 주세요.</p>}
    <div className={styles.actions}>
      <button autoFocus disabled={busy} type="button" onClick={() => { pending.current = undefined; setOpen(false) }}>계속 작성</button>
      <button disabled={busy} type="button" onClick={() => { dirty.forEach((draft) => draft.discard()); finish() }}>저장하지 않고 이동</button>
      <button disabled={busy || dirty.some((draft) => !draft.valid)} type="button" onClick={() => void save()}>{saving ? '저장 중…' : '저장 후 이동'}</button>
    </div>
  </dialog>
}
