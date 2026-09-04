'use client'

import type {
  LibraryCollectionDetailResponse,
  PersonalLibraryCollectionSummaryV2,
} from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CollectionManagementProblem,
  collectionManagementClient,
} from './collection-management-client'

type ManagedCollection = Pick<
  PersonalLibraryCollectionSummaryV2,
  'collectionId' | 'name' | 'visibility' | 'publicationId' | 'collectionRevision'
>

type CollectionManagementInput = Readonly<{
  collection: ManagedCollection
  onAccessFailure: (status: number) => void
  onChanged: () => Promise<unknown>
}>

function mutationError(reason: unknown) {
  const status = reason instanceof CollectionManagementProblem ? reason.status : 503
  if (status === 404) return '이 카테고리는 더 이상 존재하지 않습니다.'
  if (status === 409) return '다른 곳에서 카테고리가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'
  return '카테고리 변경을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
}

export function useCollectionManagementWorkflow({
  collection,
  onAccessFailure,
  onChanged,
}: CollectionManagementInput) {
  const [places, setPlaces] = useState<LibraryCollectionDetailResponse['places']>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [mutationKey, setMutationKey] = useState<string | undefined>()
  const [removeArmedPlaceId, setRemoveArmedPlaceId] = useState<string | undefined>()
  const [visibility, setVisibilityState] = useState(collection.visibility)
  const [publicationId, setPublicationId] = useState(collection.publicationId)
  const [collectionRevision, setCollectionRevision] = useState(collection.collectionRevision)
  const [copyMessage, setCopyMessage] = useState<string | undefined>()
  const requestSequence = useRef(0)
  const mutationSequence = useRef(0)
  const mutationController = useRef<AbortController | undefined>(undefined)
  const mutationKeyRef = useRef<string | undefined>(undefined)
  const activeCollectionId = useRef(collection.collectionId)

  const handleFailure = useCallback((reason: unknown, message: string) => {
    if (reason instanceof CollectionManagementProblem && [401, 403].includes(reason.status)) {
      onAccessFailure(reason.status)
      return
    }
    setError(message)
  }, [onAccessFailure])

  const load = useCallback(async (
    collectionId: string,
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    try {
      const page = await collectionManagementClient.detail(collectionId, cursor, signal)
      if (sequence !== requestSequence.current || activeCollectionId.current !== collectionId) return
      setPlaces((current) => append
        ? [...current, ...page.places.filter((candidate) => (
          !current.some((item) => item.placeId === candidate.placeId)
        ))]
        : page.places)
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      handleFailure(reason, '카테고리의 장소 순서를 불러오지 못했습니다.')
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [handleFailure])

  useEffect(() => {
    activeCollectionId.current = collection.collectionId
    mutationController.current?.abort()
    mutationKeyRef.current = undefined
    setMutationKey(undefined)
    setRemoveArmedPlaceId(undefined)
    setVisibilityState(collection.visibility)
    setPublicationId(collection.publicationId)
    setCollectionRevision(collection.collectionRevision)
    setCopyMessage(undefined)
    setPlaces([])
    setNextCursor(undefined)
    const controller = new AbortController()
    void load(collection.collectionId, undefined, false, controller.signal)
    return () => controller.abort()
  }, [collection, load])

  const runMutation = useCallback(async <Result,>(
    key: string,
    operation: (signal: AbortSignal) => Promise<Result>,
    accept?: (result: Result) => void,
  ) => {
    if (mutationKeyRef.current !== undefined) return
    const collectionId = collection.collectionId
    const sequence = ++mutationSequence.current
    const controller = new AbortController()
    mutationController.current = controller
    mutationKeyRef.current = key
    setMutationKey(key)
    setError(undefined)
    setCopyMessage(undefined)
    try {
      const result = await operation(controller.signal)
      if (activeCollectionId.current !== collectionId || sequence !== mutationSequence.current) return
      accept?.(result)
      await Promise.all([load(collectionId), onChanged()])
    } catch (reason) {
      if (
        sequence !== mutationSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      handleFailure(reason, mutationError(reason))
      if (reason instanceof CollectionManagementProblem && [404, 409].includes(reason.status)) {
        await onChanged()
      }
    } finally {
      if (sequence === mutationSequence.current) {
        mutationKeyRef.current = undefined
        mutationController.current = undefined
        setMutationKey(undefined)
      }
    }
  }, [collection.collectionId, handleFailure, load, onChanged])

  const setVisibility = useCallback((nextVisibility: ManagedCollection['visibility']) => {
    if (nextVisibility === visibility) return Promise.resolve()
    return runMutation('visibility', async (signal) => {
      const result = await collectionManagementClient.setVisibility({
        schemaVersion: 'collection-lifecycle-command.v2',
        kind: 'update',
        commandId: crypto.randomUUID(),
        collectionId: collection.collectionId,
        expectedCollectionRevision: collectionRevision,
        visibility: nextVisibility,
      }, signal)
      if (result.outcome === 'rejected') {
        throw new CollectionManagementProblem(result.rejection.code === 'not-found' ? 404 : 409)
      }
      return result.collection
    }, (updated) => {
      if (updated === null) return
      setVisibilityState(updated.visibility)
      setPublicationId(updated.publicationId)
      setCollectionRevision(updated.collectionRevision)
    })
  }, [collection.collectionId, collectionRevision, runMutation, visibility])

  const movePlace = useCallback((placeId: string, direction: 'up' | 'down') => {
    const index = places.findIndex((place) => place.placeId === placeId)
    const target = places[direction === 'up' ? index - 1 : index + 1]
    if (index < 0 || target === undefined) return Promise.resolve()
    return runMutation(`move:${placeId}`, async (signal) => {
      await collectionManagementClient.command({
        commandId: crypto.randomUUID(),
        command: {
          kind: 'move-collection-place',
          collectionId: collection.collectionId,
          placeId,
          position: target.position,
        },
      }, signal)
    })
  }, [collection.collectionId, places, runMutation])

  const removePlace = useCallback((placeId: string) => {
    if (removeArmedPlaceId !== placeId) return Promise.resolve()
    return runMutation(`remove:${placeId}`, async (signal) => {
      await collectionManagementClient.command({
        commandId: crypto.randomUUID(),
        command: { kind: 'remove-collection-place', collectionId: collection.collectionId, placeId },
      }, signal)
    }, () => setRemoveArmedPlaceId(undefined))
  }, [collection.collectionId, removeArmedPlaceId, runMutation])

  const sharePath = publicationId === null ? undefined : `/share/collections/${publicationId}`

  return {
    places,
    nextCursor,
    loading,
    loadingMore,
    error,
    mutationKey,
    removeArmedPlaceId,
    visibility,
    publicationId,
    copyMessage,
    sharePath,
    setVisibility,
    movePlace,
    removePlace,
    armRemove: setRemoveArmedPlaceId,
    cancelRemove: () => setRemoveArmedPlaceId(undefined),
    retry: () => load(collection.collectionId),
    loadMore: () => nextCursor === undefined
      ? undefined
      : load(collection.collectionId, nextCursor, true),
    copyShareLink: async () => {
      if (sharePath === undefined) return
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`)
        setCopyMessage('공유 링크를 복사했습니다.')
      } catch {
        setCopyMessage('공유 링크를 복사하지 못했습니다.')
      }
    },
  }
}

export type CollectionManagementWorkflow = ReturnType<typeof useCollectionManagementWorkflow>
export type { ManagedCollection }
