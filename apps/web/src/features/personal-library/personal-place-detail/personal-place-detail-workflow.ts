'use client'

import type { PlaceDetailResponse } from '@place/contracts/places'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalPlaceClient,
} from './personal-place-client'
import { usePersonalNoteWorkflow } from './notes/note-workflow'
import { BrowserWritingProblem } from './notes/notes-http'
import { usePersonalOrganizationWorkflow } from './organization/organization-workflow'
import { usePersonalRatingWorkflow } from './rating/rating-workflow'
import { usePersonalVisitWorkflow } from './visits/visit-workflow'
import { BrowserVisitProblem } from './visits/visits-http'

type PersonalPlaceDetailWorkflowInput = Readonly<{
  placeId: string
  onChanged: () => Promise<unknown>
}>

function problemStatus(reason: unknown): number | undefined {
  return reason instanceof BrowserLibraryProblem ||
    reason instanceof BrowserVisitProblem || reason instanceof BrowserWritingProblem
    ? reason.status
    : undefined
}

export function usePersonalPlaceDetailWorkflow({
  placeId,
  onChanged,
}: PersonalPlaceDetailWorkflowInput) {
  const [detail, setDetail] = useState<PlaceDetailResponse | undefined>()
  const [loading, setLoading] = useState(true)
  const [authenticationRequired, setAuthenticationRequired] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const requestSequence = useRef(0)

  const handleFailure = useCallback((reason: unknown) => {
    if (reason instanceof DOMException && reason.name === 'AbortError') return
    const status = problemStatus(reason)
    if (status === 401) {
      setAuthenticationRequired(true)
      setAccessDenied(false)
      setError(undefined)
      return
    }
    if (status === 403) {
      setAuthenticationRequired(false)
      setAccessDenied(true)
      setError(undefined)
      return
    }
    setError('내 장소 기능을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }, [])

  const loadDetail = useCallback(async (signal?: AbortSignal, background = false) => {
    const sequence = ++requestSequence.current
    if (!background) setLoading(true)
    setAuthenticationRequired(false)
    setAccessDenied(false)
    setError(undefined)
    try {
      const value = await personalPlaceClient.place(placeId, signal)
      if (sequence !== requestSequence.current) return
      setDetail(value)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (!background) setDetail(undefined)
      handleFailure(reason)
    } finally {
      if (sequence === requestSequence.current && !background) setLoading(false)
    }
  }, [handleFailure, placeId])

  useEffect(() => {
    setDetail(undefined)
    const controller = new AbortController()
    void loadDetail(controller.signal)
    return () => controller.abort()
  }, [loadDetail])

  const refreshPlace = useCallback(
    () => loadDetail(undefined, true),
    [loadDetail],
  )
  const personalState = detail?.personalState
  const personalPlaceId = personalState === undefined ? undefined : placeId
  const organization = usePersonalOrganizationWorkflow({
    selectedPlaceId: personalPlaceId,
    onAccessFailure: handleFailure,
    refreshLibrary: onChanged,
  })
  const rating = usePersonalRatingWorkflow({
    selectedPlaceId: personalPlaceId,
    personalState,
    onAccessFailure: handleFailure,
    refreshLibrary: onChanged,
    refreshPlace,
  })
  const visits = usePersonalVisitWorkflow({
    active: personalPlaceId !== undefined,
    selectedPlaceId: personalPlaceId,
    summary: personalState?.visits,
    onAccessFailure: handleFailure,
    refreshPlace,
  })
  const notes = usePersonalNoteWorkflow({
    active: personalPlaceId !== undefined,
    selectedPlaceId: personalPlaceId,
    onAccessFailure: handleFailure,
  })

  return {
    detail,
    loading,
    authenticationRequired,
    accessDenied,
    error,
    retry: () => loadDetail(),
    ...organization,
    ...rating,
    ...visits,
    ...notes,
  }
}

export type PersonalPlaceDetailWorkflow = ReturnType<typeof usePersonalPlaceDetailWorkflow>
