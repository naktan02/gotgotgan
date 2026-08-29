'use client'

import type {
  PublicProfileAppealRequest,
  PublicProfileModerationNotices,
} from '@place/contracts/profiles'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  PublicProfileHttpProblem,
  publicProfileHttp,
} from '@/platform/profiles/public-profile-http'

type LoadState = 'loading' | 'ready' | 'authentication-required' | 'unavailable'
type Notice = PublicProfileModerationNotices['notices'][number]
export type PublicProfileAppealReason = PublicProfileAppealRequest['reason']

function message(error: unknown): string {
  if (!(error instanceof PublicProfileHttpProblem)) return '프로필 검토 요청을 처리하지 못했습니다.'
  if (error.status === 401) return '프로필 검토 알림을 확인하려면 로그인이 필요합니다.'
  if (
    error.code === 'PLACE_PUBLIC_PROFILE_APPEAL_TARGET_CHANGED' ||
    error.code === 'PLACE_PUBLIC_PROFILE_APPEAL_ALREADY_RESOLVED'
  ) return '프로필 판정이 이미 바뀌었습니다. 최신 알림을 다시 확인해 주세요.'
  if (error.code === 'PLACE_PUBLIC_PROFILE_APPEAL_CONFLICT') {
    return '이의 제기 요청이 이전 요청과 충돌했습니다. 최신 알림을 다시 확인해 주세요.'
  }
  return '프로필 검토 요청을 처리하지 못했습니다.'
}

function appendUnique(current: readonly Notice[], incoming: readonly Notice[]): Notice[] {
  const known = new Set(current.map((notice) => notice.noticeId))
  return [...current, ...incoming.filter((notice) => !known.has(notice.noticeId))]
}

export function usePublicProfileModeration() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [notices, setNotices] = useState<Notice[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [acknowledgingNoticeId, setAcknowledgingNoticeId] = useState<string>()
  const [submittingNoticeId, setSubmittingNoticeId] = useState<string>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const pendingAppeal = useRef<PublicProfileAppealRequest | undefined>(undefined)

  const load = useCallback(async (
    cursor?: string,
    append = false,
    signal?: AbortSignal,
    initial = false,
  ) => {
    if (initial) setLoadState('loading')
    if (append) setLoadingMore(true)
    setError(undefined)
    try {
      const page = await publicProfileHttp.notices({ limit: 20, ...(cursor === undefined ? {} : { cursor }) }, signal)
      setNotices((current) => append ? appendUnique(current, page.notices) : [...page.notices])
      setNextCursor(page.nextCursor)
      setLoadState('ready')
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      if (initial) {
        setLoadState(loadError instanceof PublicProfileHttpProblem && loadError.status === 401
          ? 'authentication-required'
          : 'unavailable')
      } else {
        setError(message(loadError))
      }
    } finally {
      if (append) setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(undefined, false, controller.signal, true)
    return () => controller.abort()
  }, [load])

  const acknowledge = useCallback(async (noticeId: string) => {
    setAcknowledgingNoticeId(noticeId)
    setError(undefined)
    try {
      const outcome = await publicProfileHttp.acknowledgeNotice(noticeId)
      setNotices((current) => current.map((notice) => notice.noticeId === noticeId
        ? { ...notice, acknowledgedAt: outcome.acknowledgedAt }
        : notice))
    } catch (acknowledgementError) {
      setError(message(acknowledgementError))
    } finally {
      setAcknowledgingNoticeId(undefined)
    }
  }, [])

  const appeal = useCallback(async (noticeId: string, reason: PublicProfileAppealReason) => {
    const prior = pendingAppeal.current
    const request: PublicProfileAppealRequest = prior?.noticeId === noticeId && prior.reason === reason
      ? prior
      : { appealId: crypto.randomUUID(), noticeId, reason }
    pendingAppeal.current = request
    setSubmittingNoticeId(noticeId)
    setError(undefined)
    try {
      await publicProfileHttp.appeal(request)
      pendingAppeal.current = undefined
      await load()
    } catch (appealError) {
      setError(message(appealError))
    } finally {
      setSubmittingNoticeId(undefined)
    }
  }, [load])

  return {
    loadState,
    notices,
    nextCursor,
    acknowledgingNoticeId,
    submittingNoticeId,
    loadingMore,
    error,
    acknowledge,
    appeal,
    loadMore: () => nextCursor === undefined ? undefined : load(nextCursor, true),
    reload: () => load(undefined, false, undefined, true),
  }
}

export type PublicProfileModerationWorkflow = ReturnType<typeof usePublicProfileModeration>
