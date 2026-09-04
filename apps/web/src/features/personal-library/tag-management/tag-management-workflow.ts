'use client'

import type { LibraryTagListResponse } from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import { TagManagementProblem, tagManagementClient } from './tag-management-client'

type TagManagementInput = Readonly<{
  onAccessFailure: (status: number) => void
  onChanged: (deletedTagId?: string) => Promise<unknown>
}>

function normalized(name: string) {
  return name.trim().toLocaleLowerCase()
}

export function useTagManagementWorkflow({ onAccessFailure, onChanged }: TagManagementInput) {
  const [tags, setTags] = useState<LibraryTagListResponse['items']>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [mutationKey, setMutationKey] = useState<string | undefined>()
  const [createDraft, setCreateDraft] = useState('')
  const [editingTagId, setEditingTagId] = useState<string | undefined>()
  const [deleteArmedTagId, setDeleteArmedTagId] = useState<string | undefined>()
  const [renameDraft, setRenameDraft] = useState('')
  const requestSequence = useRef(0)
  const mutationSequence = useRef(0)
  const mutationController = useRef<AbortController | undefined>(undefined)
  const mutationKeyRef = useRef<string | undefined>(undefined)

  const handleFailure = useCallback((reason: unknown, message: string) => {
    if (reason instanceof TagManagementProblem && [401, 403].includes(reason.status)) {
      onAccessFailure(reason.status)
      return
    }
    setError(message)
  }, [onAccessFailure])

  const load = useCallback(async (
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    try {
      const page = await tagManagementClient.list(cursor, signal)
      if (sequence !== requestSequence.current) return
      setTags((current) => append
        ? [...current, ...page.items.filter((candidate) => (
          !current.some((tag) => tag.tagId === candidate.tagId)
        ))]
        : page.items)
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      handleFailure(reason, '태그 목록을 불러오지 못했습니다.')
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [handleFailure])

  useEffect(() => {
    const controller = new AbortController()
    void load(undefined, false, controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => () => {
    mutationController.current?.abort()
    mutationSequence.current += 1
  }, [])

  const mutate = useCallback(async (
    key: string,
    request: Parameters<typeof tagManagementClient.command>[0],
    deletedTagId?: string,
  ) => {
    if (mutationKeyRef.current !== undefined) return false
    const sequence = ++mutationSequence.current
    const controller = new AbortController()
    mutationController.current = controller
    mutationKeyRef.current = key
    setMutationKey(key)
    setError(undefined)
    try {
      await tagManagementClient.command(request, controller.signal)
      if (sequence !== mutationSequence.current) return false
      await Promise.all([load(undefined, false, controller.signal), onChanged(deletedTagId)])
      return sequence === mutationSequence.current
    } catch (reason) {
      if (
        sequence !== mutationSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return false
      handleFailure(reason, reason instanceof TagManagementProblem && reason.status === 404
        ? '이 태그는 더 이상 존재하지 않습니다.'
        : '태그 변경을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
      return false
    } finally {
      if (sequence === mutationSequence.current) {
        mutationController.current = undefined
        mutationKeyRef.current = undefined
        setMutationKey(undefined)
      }
    }
  }, [handleFailure, load, onChanged])

  const createTag = useCallback(() => {
    const name = createDraft.trim()
    if (name.length === 0 || name.length > 64) return Promise.resolve()
    if (tags.some((tag) => normalized(tag.name) === normalized(name))) {
      setError('같은 이름의 태그가 이미 있습니다.')
      return Promise.resolve()
    }
    return mutate('create', {
      commandId: crypto.randomUUID(),
      command: { kind: 'create-tag', tagId: crypto.randomUUID(), name },
    }).then((applied) => {
      if (applied) setCreateDraft('')
    })
  }, [createDraft, mutate, tags])

  const beginRename = useCallback((tagId: string) => {
    const tag = tags.find((candidate) => candidate.tagId === tagId)
    if (tag === undefined) return
    setEditingTagId(tagId)
    setDeleteArmedTagId(undefined)
    setRenameDraft(tag.name)
    setError(undefined)
  }, [tags])

  const renameTag = useCallback(() => {
    const current = tags.find((tag) => tag.tagId === editingTagId)
    const name = renameDraft.trim()
    if (current === undefined || name.length === 0 || name.length > 64 || name === current.name) {
      return Promise.resolve()
    }
    if (tags.some((tag) => tag.tagId !== current.tagId && normalized(tag.name) === normalized(name))) {
      setError('같은 이름의 태그가 이미 있습니다.')
      return Promise.resolve()
    }
    return mutate(`rename:${current.tagId}`, {
      commandId: crypto.randomUUID(),
      command: { kind: 'rename-tag', tagId: current.tagId, name },
    }).then((applied) => {
      if (applied) {
        setEditingTagId(undefined)
        setRenameDraft('')
      }
    })
  }, [editingTagId, mutate, renameDraft, tags])

  const deleteTag = useCallback((tagId: string) => {
    if (deleteArmedTagId !== tagId || !tags.some((tag) => tag.tagId === tagId)) {
      return Promise.resolve()
    }
    return mutate(`delete:${tagId}`, {
      commandId: crypto.randomUUID(),
      command: { kind: 'delete-tag', tagId },
    }, tagId).then((applied) => {
      if (applied) setDeleteArmedTagId(undefined)
    })
  }, [deleteArmedTagId, mutate, tags])

  return {
    tags,
    nextCursor,
    loading,
    loadingMore,
    error,
    mutationKey,
    createDraft,
    editingTagId,
    deleteArmedTagId,
    renameDraft,
    setCreateDraft,
    setRenameDraft,
    createTag,
    beginRename,
    cancelRename: () => setEditingTagId(undefined),
    renameTag,
    armDelete: (tagId: string) => {
      if (!tags.some((tag) => tag.tagId === tagId)) return
      setEditingTagId(undefined)
      setDeleteArmedTagId(tagId)
      setError(undefined)
    },
    cancelDelete: () => setDeleteArmedTagId(undefined),
    deleteTag,
    retry: () => load(),
    loadMore: () => nextCursor === undefined ? undefined : load(nextCursor, true),
    mutate,
  }
}

export type TagManagementWorkflow = ReturnType<typeof useTagManagementWorkflow>
