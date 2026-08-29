'use client'

import type { BrowserLibraryCommandRequest } from '@place/contracts/http'
import type { LibraryCollectionListResponse } from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
  type PersonalLibraryPage,
  type PersonalLibraryRow,
} from './personal-library-http'
import type { ExecuteManagementMutation } from './personal-library-management-mutation'

type CollectionManagementInput = Readonly<{
  active: boolean
  collections: LibraryCollectionListResponse['items']
  collectionCursor?: string
  execute: ExecuteManagementMutation
  loadMoreCollections: () => void | Promise<unknown>
  refreshMetadata: () => Promise<unknown>
  onAccessFailure: (reason: unknown) => void
  onCollectionDeleted: (collectionId: string) => void
}>

export function usePersonalCollectionManagementWorkflow(input: CollectionManagementInput) {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>()
  const [collection, setCollection] = useState<PersonalLibraryPage['collection']>()
  const [collectionPlaces, setCollectionPlaces] = useState<readonly PersonalLibraryRow[]>([])
  const [collectionPlacesCursor, setCollectionPlacesCursor] = useState<string | undefined>()
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionLoadingMore, setCollectionLoadingMore] = useState(false)
  const [collectionError, setCollectionError] = useState<string | undefined>()
  const [newCollectionName, setNewCollectionName] = useState('')
  const [collectionNameDraft, setCollectionNameDraft] = useState('')
  const [collectionDeleteArmed, setCollectionDeleteArmed] = useState(false)
  const requestSequence = useRef(0)

  const loadCollection = useCallback(async (
    collectionId: string,
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setCollectionLoadingMore(true) : setCollectionLoading(true)
    if (!append) setCollectionError(undefined)
    try {
      const page = await personalLibraryHttp.collection(collectionId, cursor, signal)
      if (sequence !== requestSequence.current) return
      setCollection(page.collection)
      setCollectionPlaces((current) => append ? [...current, ...page.rows] : page.rows)
      setCollectionPlacesCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else {
        if (!append) {
          setCollection(undefined)
          setCollectionPlaces([])
          setCollectionPlacesCursor(undefined)
        }
        setCollectionError('컬렉션 내용을 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === requestSequence.current) {
        setCollectionLoading(false)
        setCollectionLoadingMore(false)
      }
    }
  }, [input.onAccessFailure])

  useEffect(() => {
    setSelectedCollectionId((current) => (
      current !== undefined && input.collections.some((item) => item.collectionId === current)
        ? current
        : input.collections[0]?.collectionId
    ))
  }, [input.collections])

  useEffect(() => {
    setCollectionDeleteArmed(false)
    const selected = input.collections.find((item) => item.collectionId === selectedCollectionId)
    setCollectionNameDraft(selected?.name ?? '')
  }, [input.collections, selectedCollectionId])

  useEffect(() => {
    setCollection(undefined)
    setCollectionPlaces([])
    setCollectionPlacesCursor(undefined)
    if (!input.active || selectedCollectionId === undefined) return
    const controller = new AbortController()
    void loadCollection(selectedCollectionId, undefined, false, controller.signal)
    return () => controller.abort()
  }, [input.active, loadCollection, selectedCollectionId])

  const selectedCollection = input.collections.find((item) => (
    item.collectionId === selectedCollectionId
  ))
  const newCollectionValue = newCollectionName.trim()
  const collectionNameValue = collectionNameDraft.trim()

  const createCollection = () => {
    if (newCollectionValue.length === 0 || newCollectionValue.length > 120) {
      return Promise.resolve()
    }
    const collectionId = crypto.randomUUID()
    return input.execute({
      key: `collection:create:${collectionId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: {
          kind: 'create-collection', collectionId, name: newCollectionValue,
        },
      },
      failureMessage: '컬렉션을 만들지 못했습니다.',
      onApplied: async () => {
        setNewCollectionName('')
        await input.refreshMetadata()
        setSelectedCollectionId(collectionId)
      },
    })
  }

  const renameCollection = () => {
    if (
      selectedCollection === undefined || collectionNameValue.length === 0 ||
      collectionNameValue.length > 120 || collectionNameValue === selectedCollection.name
    ) return Promise.resolve()
    return input.execute({
      key: `collection:rename:${selectedCollection.collectionId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: {
          kind: 'rename-collection', collectionId: selectedCollection.collectionId,
          name: collectionNameValue,
        },
      },
      failureMessage: '컬렉션 이름을 바꾸지 못했습니다.',
      onApplied: () => Promise.all([
        input.refreshMetadata(),
        loadCollection(selectedCollection.collectionId),
      ]),
    })
  }

  const deleteCollection = () => {
    if (selectedCollection === undefined || !collectionDeleteArmed) return Promise.resolve()
    const collectionId = selectedCollection.collectionId
    return input.execute({
      key: `collection:delete:${collectionId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: { kind: 'delete-collection', collectionId },
      },
      failureMessage: '컬렉션을 삭제하지 못했습니다.',
      onApplied: async () => {
        input.onCollectionDeleted(collectionId)
        setSelectedCollectionId(undefined)
        setCollection(undefined)
        setCollectionPlaces([])
        await input.refreshMetadata()
      },
    })
  }

  const changeCollectionPlace = (
    placeId: string,
    command: BrowserLibraryCommandRequest['command'],
    action: 'move' | 'remove',
  ) => selectedCollectionId === undefined
    ? Promise.resolve()
    : input.execute({
        key: `collection-place:${action}:${placeId}`,
        request: { commandId: crypto.randomUUID(), command },
        failureMessage: action === 'move'
          ? '장소 순서를 바꾸지 못했습니다.'
          : '컬렉션에서 장소를 제거하지 못했습니다.',
        onApplied: () => Promise.all([
          input.refreshMetadata(),
          loadCollection(selectedCollectionId),
        ]),
      })

  const moveCollectionPlace = (placeId: string, direction: -1 | 1) => {
    if (selectedCollectionId === undefined) return Promise.resolve()
    const index = collectionPlaces.findIndex((item) => item.placeId === placeId)
    const target = collectionPlaces[index + direction]
    if (index < 0 || target?.position === undefined) return Promise.resolve()
    return changeCollectionPlace(placeId, {
      kind: 'move-collection-place',
      collectionId: selectedCollectionId,
      placeId,
      position: target.position,
    }, 'move')
  }

  const removeCollectionPlace = (placeId: string) => selectedCollectionId === undefined
    ? Promise.resolve()
    : changeCollectionPlace(placeId, {
        kind: 'remove-collection-place',
        collectionId: selectedCollectionId,
        placeId,
      }, 'remove')

  const setCollectionPublication = (visibility: 'private' | 'unlisted' | 'public') => {
    const current = collection?.collectionId === selectedCollectionId
      ? collection
      : selectedCollection
    if (current === undefined || current.visibility === visibility) return Promise.resolve()
    return input.execute({
      key: `collection:publication:${current.collectionId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: {
          kind: 'set-collection-publication',
          collectionId: current.collectionId,
          expectedUpdatedAt: current.updatedAt,
          visibility,
        },
      },
      failureMessage: visibility === 'private'
        ? '컬렉션 공유를 해제하지 못했습니다.'
        : '컬렉션 공유 설정을 바꾸지 못했습니다.',
      onApplied: () => Promise.all([
        input.refreshMetadata(),
        loadCollection(current.collectionId),
      ]),
    })
  }

  const currentCollection = collection?.collectionId === selectedCollectionId
    ? collection
    : selectedCollection

  return {
    collections: input.collections,
    collectionCursor: input.collectionCursor,
    selectedCollectionId,
    collection,
    collectionPlaces,
    collectionPlacesCursor,
    collectionLoading,
    collectionLoadingMore,
    collectionError,
    newCollectionName,
    collectionNameDraft,
    collectionDeleteArmed,
    newCollectionValid: newCollectionValue.length > 0 && newCollectionValue.length <= 120,
    collectionNameValid: selectedCollection !== undefined && collectionNameValue.length > 0 &&
      collectionNameValue.length <= 120 && collectionNameValue !== selectedCollection.name,
    selectCollection: setSelectedCollectionId,
    setNewCollectionName,
    setCollectionNameDraft,
    armCollectionDelete: () => setCollectionDeleteArmed(true),
    cancelCollectionDelete: () => setCollectionDeleteArmed(false),
    createCollection,
    renameCollection,
    deleteCollection,
    moveCollectionPlace,
    removeCollectionPlace,
    publication: currentCollection === undefined ? undefined : {
      visibility: currentCollection.visibility,
      sharePath: currentCollection.publicationId === null
        ? undefined
        : `/share/collections/${currentCollection.publicationId}`,
      setVisibility: setCollectionPublication,
    },
    retryCollection: () => selectedCollectionId === undefined
      ? undefined
      : loadCollection(selectedCollectionId),
    loadMoreCollectionPlaces: () => (
      selectedCollectionId === undefined || collectionPlacesCursor === undefined
        ? undefined
        : loadCollection(selectedCollectionId, collectionPlacesCursor, true)
    ),
    loadMoreCollections: input.loadMoreCollections,
  }
}
