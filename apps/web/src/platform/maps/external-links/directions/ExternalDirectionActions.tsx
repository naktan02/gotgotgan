'use client'

import { useEffect, useId, useRef } from 'react'

import styles from './external-direction-actions.module.css'
import { buildExternalDirectionLinks } from './external-direction-links'

type ExternalDirectionActionsProperties = Readonly<{
  destination: Readonly<{
    name: string
    location: Readonly<{ latitude: number; longitude: number }> | null
  }>
}>

export function ExternalDirectionActions({ destination }: ExternalDirectionActionsProperties) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const titleId = useId()
  const links = destination.location === null ? []
    : buildExternalDirectionLinks({ name: destination.name, location: destination.location })
  useEffect(() => {
    if (dialog.current?.open) dialog.current.close()
  }, [destination.name, destination.location?.latitude, destination.location?.longitude])

  return (
    <div className={styles.actions}>
      <button aria-controls={links.length === 0 ? undefined : dialogId} aria-haspopup="dialog"
        className={styles.trigger} disabled={links.length === 0} ref={trigger} type="button"
        title={links.length === 0 ? '좌표가 없어 길찾기를 사용할 수 없습니다' : '외부 지도 선택'}
        onClick={() => dialog.current?.showModal()}>
        <span aria-hidden="true">↗</span> 길찾기
      </button>
      {links.length > 0 && <dialog aria-labelledby={titleId} className={styles.dialog} id={dialogId} ref={dialog}
        onClose={() => trigger.current?.focus()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const choices = event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button, a[href]')
          const first = choices[0]
          const last = choices[choices.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            event.currentTarget.close()
          }
        }}>
        <header><h2 id={titleId}>길찾기 지도 선택</h2><button autoFocus type="button" aria-label="길찾기 지도 선택 닫기" onClick={() => dialog.current?.close()}>×</button></header>
        <p>{destination.name}</p>
        <nav aria-label="외부 지도 길찾기" className={styles.links}>
          {links.map((link) => (
            <a href={link.href} key={link.provider} rel="external noopener noreferrer" target="_blank"
              onClick={() => dialog.current?.close()}>{link.label}<span aria-hidden="true">↗</span></a>
          ))}
        </nav>
        <small>선택한 외부 지도에서 길찾기를 엽니다.</small>
      </dialog>}
    </div>
  )
}
