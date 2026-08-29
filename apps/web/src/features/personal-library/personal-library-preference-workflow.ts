'use client'

import type { BrowserLibraryCommandRequest } from '@place/contracts/http'
import type { PlaceDetailPersonalState } from '@place/contracts/places'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
} from './personal-library-http'

type PreferenceWorkflowInput = Readonly<{
  selectedPlaceId?: string
  personalState?: PlaceDetailPersonalState
  onAccessFailure: (reason: unknown) => void
  refreshLibrary: () => Promise<unknown>
  refreshPlace: () => Promise<unknown>
}>

type FailedPreferenceMutation = Readonly<{
  mutationKey: 'saved' | 'wanted' | 'rating'
  request: BrowserLibraryCommandRequest
}>

export function usePersonalLibraryPreferenceWorkflow({
  selectedPlaceId,
  personalState,
  onAccessFailure,
  refreshLibrary,
  refreshPlace,
}: PreferenceWorkflowInput) {
  const [ratingDraft, setRatingDraft] = useState('')
  const [preferenceMutationKey, setPreferenceMutationKey] = useState<string | undefined>()
  const [preferenceError, setPreferenceError] = useState<string | undefined>()
  const [failedPreferenceMutation, setFailedPreferenceMutation] =
    useState<FailedPreferenceMutation | undefined>()
  const mutationRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    setRatingDraft(personalState?.personalRating?.toFixed(1) ?? '')
  }, [personalState?.personalRating, selectedPlaceId])

  useEffect(() => {
    setPreferenceError(undefined)
    setFailedPreferenceMutation(undefined)
  }, [selectedPlaceId])

  const mutate = useCallback(async (failed: FailedPreferenceMutation) => {
    if (mutationRef.current !== undefined) return
    mutationRef.current = failed.mutationKey
    setPreferenceMutationKey(failed.mutationKey)
    setPreferenceError(undefined)
    setFailedPreferenceMutation(undefined)
    try {
      await personalLibraryHttp.command(failed.request)
      await Promise.all([refreshLibrary(), refreshPlace()])
    } catch (reason) {
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        onAccessFailure(reason)
      } else if (reason instanceof BrowserLibraryProblem && reason.status === 409) {
        await Promise.all([refreshLibrary(), refreshPlace()]).catch(() => undefined)
        setPreferenceError('다른 곳에서 상태가 변경되어 최신 값을 불러왔습니다. 다시 적용해 주세요.')
      } else {
        setFailedPreferenceMutation(failed)
        setPreferenceError('내 상태를 저장하지 못했습니다.')
      }
    } finally {
      mutationRef.current = undefined
      setPreferenceMutationKey(undefined)
    }
  }, [onAccessFailure, refreshLibrary, refreshPlace])

  const update = useCallback((
    mutationKey: FailedPreferenceMutation['mutationKey'],
    next: Readonly<{ saved: boolean; wanted: boolean; personalRating: number | null }>,
  ) => {
    if (selectedPlaceId === undefined || personalState === undefined) return Promise.resolve()
    return mutate({
      mutationKey,
      request: {
        commandId: crypto.randomUUID(),
        command: {
          kind: 'set-place-preferences',
          placeId: selectedPlaceId,
          expectedUpdatedAt: personalState.preferencesUpdatedAt,
          ...next,
        },
      },
    })
  }, [mutate, personalState, selectedPlaceId])

  const rating = Number(ratingDraft)
  const ratingValid = ratingDraft.trim().length > 0 && Number.isFinite(rating) &&
    rating >= 0.1 && rating <= 5 && Math.round(rating * 10) === rating * 10

  return {
    preferenceState: personalState,
    preferenceMutationKey,
    preferenceError,
    ratingDraft,
    ratingValid,
    canRetryPreference: failedPreferenceMutation !== undefined,
    setRatingDraft,
    setSaved: (saved: boolean) => personalState === undefined
      ? Promise.resolve()
      : update('saved', {
          saved,
          wanted: personalState.wanted,
          personalRating: personalState.personalRating,
        }),
    setWanted: (wanted: boolean) => personalState === undefined
      ? Promise.resolve()
      : update('wanted', {
          saved: personalState.saved,
          wanted,
          personalRating: personalState.personalRating,
        }),
    saveRating: () => personalState === undefined || !ratingValid
      ? Promise.resolve()
      : update('rating', {
          saved: personalState.saved,
          wanted: personalState.wanted,
          personalRating: rating,
        }),
    clearRating: () => personalState === undefined
      ? Promise.resolve()
      : update('rating', {
          saved: personalState.saved,
          wanted: personalState.wanted,
          personalRating: null,
        }),
    retryPreference: () => failedPreferenceMutation === undefined
      ? undefined
      : mutate(failedPreferenceMutation),
  }
}
