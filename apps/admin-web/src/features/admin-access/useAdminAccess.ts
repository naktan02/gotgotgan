'use client'

import { useCallback, useEffect, useState } from 'react'

import { isAdminSession, type AdminAccessState } from '@/domains/admin-access/admin-session'

export function useAdminAccess(): Readonly<{ state: AdminAccessState; retry: () => void }> {
  const [state, setState] = useState<AdminAccessState>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'checking' })
    void fetch('/api/admin/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted) return
      if (response.status === 401) return setState({ kind: 'unauthenticated' })
      if (response.status === 403) return setState({ kind: 'forbidden' })
      if (!response.ok) return setState({ kind: 'unavailable' })
      const value: unknown = await response.json().catch(() => undefined)
      setState(isAdminSession(value) ? { kind: 'ready', session: value } : { kind: 'unavailable' })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'unavailable' })
    })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}
