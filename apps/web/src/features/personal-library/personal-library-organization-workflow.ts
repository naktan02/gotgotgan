'use client'

import type { LibraryPlaceOrganizationResponse } from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
} from './personal-library-http'

type OrganizationWorkflowInput = Readonly<{
  selectedPlaceId?: string
  onAccessFailure: (reason: unknown) => void
  refreshLibrary: () => Promise<unknown>
}>

export function usePersonalLibraryOrganizationWorkflow({
  selectedPlaceId,
  onAccessFailure,
  refreshLibrary,
}: OrganizationWorkflowInput) {
  const [organizationItems, setOrganizationItems] = useState<LibraryPlaceOrganizationResponse['items']>([])
  const [organizationCursor, setOrganizationCursor] = useState<string | undefined>()
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationLoadingMore, setOrganizationLoadingMore] = useState(false)
  const [organizationMutationKey, setOrganizationMutationKey] = useState<string | undefined>()
  const [organizationError, setOrganizationError] = useState<string | undefined>()
  const requestSequence = useRef(0)
  const mutationKeyRef = useRef<string | undefined>(undefined)

  const loadOrganization = useCallback(async (
    placeId: string,
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setOrganizationLoadingMore(true) : setOrganizationLoading(true)
    setOrganizationError(undefined)
    try {
      const page = await personalLibraryHttp.organization(placeId, cursor, signal)
      if (sequence !== requestSequence.current) return
      setOrganizationItems((current) => append ? [...current, ...page.items] : page.items)
      setOrganizationCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        onAccessFailure(reason)
      } else {
        setOrganizationError('내 분류를 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === requestSequence.current) {
        setOrganizationLoading(false)
        setOrganizationLoadingMore(false)
      }
    }
  }, [onAccessFailure])

  useEffect(() => {
    setOrganizationItems([])
    setOrganizationCursor(undefined)
    setOrganizationError(undefined)
    if (selectedPlaceId === undefined) return
    const controller = new AbortController()
    void loadOrganization(selectedPlaceId, undefined, false, controller.signal)
    return () => controller.abort()
  }, [loadOrganization, selectedPlaceId])

  const mutate = useCallback(async (
    mutationKey: string,
    request: Parameters<typeof personalLibraryHttp.command>[0],
    failureMessage: string,
  ) => {
    if (mutationKeyRef.current !== undefined) return
    mutationKeyRef.current = mutationKey
    setOrganizationMutationKey(mutationKey)
    setOrganizationError(undefined)
    try {
      await personalLibraryHttp.command(request)
      await Promise.all([
        selectedPlaceId === undefined ? undefined : loadOrganization(selectedPlaceId),
        refreshLibrary(),
      ])
    } catch (reason) {
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        onAccessFailure(reason)
      } else {
        setOrganizationError(failureMessage)
      }
    } finally {
      mutationKeyRef.current = undefined
      setOrganizationMutationKey(undefined)
    }
  }, [loadOrganization, onAccessFailure, refreshLibrary, selectedPlaceId])

  const toggleCollectionMembership = useCallback((collectionId: string, selected: boolean) => {
    if (selectedPlaceId === undefined) return Promise.resolve()
    return mutate(`collection:${collectionId}`, {
      commandId: crypto.randomUUID(),
      command: selected
        ? { kind: 'remove-collection-place', collectionId, placeId: selectedPlaceId }
        : { kind: 'add-collection-place', collectionId, placeId: selectedPlaceId },
    }, '컬렉션 변경을 저장하지 못했습니다.')
  }, [mutate, selectedPlaceId])

  const toggleTagMembership = useCallback((tagId: string, selected: boolean) => {
    if (selectedPlaceId === undefined) return Promise.resolve()
    return mutate(`tag:${tagId}`, {
      commandId: crypto.randomUUID(),
      command: selected
        ? { kind: 'untag-place', tagId, placeId: selectedPlaceId }
        : { kind: 'tag-place', tagId, placeId: selectedPlaceId },
    }, '태그 변경을 저장하지 못했습니다.')
  }, [mutate, selectedPlaceId])

  return {
    organizationItems,
    organizationCursor,
    organizationLoading,
    organizationLoadingMore,
    organizationMutationKey,
    organizationError,
    loadMoreOrganization: () => (
      selectedPlaceId === undefined || organizationCursor === undefined
        ? undefined
        : loadOrganization(selectedPlaceId, organizationCursor, true)
    ),
    retryOrganization: () => selectedPlaceId === undefined
      ? undefined
      : loadOrganization(selectedPlaceId),
    toggleCollectionMembership,
    toggleTagMembership,
  }
}
