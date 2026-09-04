'use client'

import type { BrowserLibraryCommandRequest } from '@place/contracts/http'
import type { PlaceDetailPersonalState } from '@place/contracts/places'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalPlaceClient,
} from '../personal-place-client'

type RatingWorkflowInput = Readonly<{
  selectedPlaceId?: string
  personalState?: PlaceDetailPersonalState
  onAccessFailure: (reason: unknown) => void
  refreshLibrary: () => Promise<unknown>
  refreshPlace: () => Promise<unknown>
}>

type FailedRatingMutation = Readonly<{
  request: BrowserLibraryCommandRequest
}>

export function usePersonalRatingWorkflow({
  selectedPlaceId,
  personalState,
  onAccessFailure,
  refreshLibrary,
  refreshPlace,
}: RatingWorkflowInput) {
  const [ratingDraft, setRatingDraft] = useState('')
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState<string | undefined>()
  const [failedRatingMutation, setFailedRatingMutation] =
    useState<FailedRatingMutation | undefined>()
  const mutationRef = useRef(false)

  useEffect(() => {
    setRatingDraft(personalState?.personalRating?.toFixed(1) ?? '')
  }, [personalState?.personalRating, selectedPlaceId])

  useEffect(() => {
    setRatingError(undefined)
    setFailedRatingMutation(undefined)
  }, [selectedPlaceId])

  const mutate = useCallback(async (failed: FailedRatingMutation) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setRatingSaving(true)
    setRatingError(undefined)
    setFailedRatingMutation(undefined)
    try {
      await personalPlaceClient.command(failed.request)
      await Promise.all([refreshLibrary(), refreshPlace()])
    } catch (reason) {
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        onAccessFailure(reason)
      } else if (reason instanceof BrowserLibraryProblem && reason.status === 409) {
        await Promise.all([refreshLibrary(), refreshPlace()]).catch(() => undefined)
        setRatingError('다른 곳에서 평점이 변경되어 최신 값을 불러왔습니다. 다시 적용해 주세요.')
      } else {
        setFailedRatingMutation(failed)
        setRatingError('내 평점을 저장하지 못했습니다.')
      }
    } finally {
      mutationRef.current = false
      setRatingSaving(false)
    }
  }, [onAccessFailure, refreshLibrary, refreshPlace])

  const update = useCallback((personalRating: number | null) => {
    if (selectedPlaceId === undefined || personalState === undefined) return Promise.resolve()
    return mutate({
      request: {
        commandId: crypto.randomUUID(),
        command: {
          kind: 'set-place-preferences',
          placeId: selectedPlaceId,
          expectedUpdatedAt: personalState.preferencesUpdatedAt,
          saved: personalState.saved,
          wanted: personalState.wanted,
          personalRating,
        },
      },
    })
  }, [mutate, personalState, selectedPlaceId])

  const rating = Number(ratingDraft)
  const ratingValid = ratingDraft.trim().length > 0 && Number.isFinite(rating) &&
    rating >= 0.1 && rating <= 5 && Math.round(rating * 10) === rating * 10

  return {
    personalRating: personalState?.personalRating,
    ratingSaving,
    ratingError,
    ratingDraft,
    ratingValid,
    canRetryRating: failedRatingMutation !== undefined,
    setRatingDraft,
    saveRating: () => personalState === undefined || !ratingValid
      ? Promise.resolve()
      : update(rating),
    clearRating: () => personalState === undefined
      ? Promise.resolve()
      : update(null),
    retryRating: () => failedRatingMutation === undefined
      ? undefined
      : mutate(failedRatingMutation),
  }
}
