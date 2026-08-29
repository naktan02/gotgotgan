'use client'

import type { PublicProfileRecord, SetPublicProfileRequest } from '@place/contracts/profiles'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  PublicProfileHttpProblem,
  publicProfileHttp,
} from '@/platform/profiles/public-profile-http'

type LoadState = 'loading' | 'ready' | 'authentication-required' | 'unavailable'

function message(error: unknown): string {
  if (!(error instanceof PublicProfileHttpProblem)) return '공개 프로필을 저장하지 못했습니다.'
  if (error.status === 401) return '공개 프로필을 관리하려면 로그인이 필요합니다.'
  if (error.code === 'PLACE_PUBLIC_HANDLE_UNAVAILABLE') return '이미 사용 중인 핸들입니다.'
  if (error.code === 'PLACE_PUBLIC_HANDLE_IMMUTABLE') return '한 번 만든 공개 핸들은 변경할 수 없습니다.'
  if (error.code === 'PLACE_PUBLIC_PROFILE_VERSION_CONFLICT') return '다른 화면에서 프로필이 변경되었습니다. 최신 내용을 다시 불러오세요.'
  return '공개 프로필을 저장하지 못했습니다.'
}

export function usePublicProfileSettings() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [profile, setProfile] = useState<PublicProfileRecord>()
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [visibility, setVisibility] = useState<'hidden' | 'public'>('hidden')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef<SetPublicProfileRequest | undefined>(undefined)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState('loading')
    setError(undefined)
    try {
      const next = await publicProfileHttp.current(signal)
      setProfile(next)
      setHandle(next?.handle ?? '')
      setDisplayName(next?.displayName ?? '')
      setVisibility(next?.visibility ?? 'hidden')
      setLoadState('ready')
    } catch (loadError) {
      setLoadState(loadError instanceof PublicProfileHttpProblem && loadError.status === 401
        ? 'authentication-required'
        : 'unavailable')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const submit = useCallback(async (request: SetPublicProfileRequest) => {
    pending.current = request
    setSaving(true)
    setError(undefined)
    try {
      await publicProfileHttp.set(request)
      pending.current = undefined
      await load()
    } catch (saveError) {
      setError(message(saveError))
    } finally {
      setSaving(false)
    }
  }, [load])

  const save = useCallback(() => {
    const request: SetPublicProfileRequest = {
      commandId: crypto.randomUUID(),
      profile: {
        handle,
        displayName,
        visibility,
        expectedUpdatedAt: profile?.updatedAt ?? null,
      },
    }
    void submit(request)
  }, [displayName, handle, profile?.updatedAt, submit, visibility])

  return {
    loadState, profile, handle, displayName, visibility, saving, error,
    setHandle, setDisplayName, setVisibility, save,
    retry: () => pending.current === undefined ? load() : submit(pending.current),
    reload: load,
  }
}

export type PublicProfileSettingsWorkflow = ReturnType<typeof usePublicProfileSettings>
