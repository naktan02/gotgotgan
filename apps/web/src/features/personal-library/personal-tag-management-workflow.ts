'use client'

import type { LibraryTagListResponse } from '@place/contracts/library'
import { useEffect, useState } from 'react'

import type { ExecuteManagementMutation } from './personal-library-management-mutation'

type TagManagementInput = Readonly<{
  tags: LibraryTagListResponse['items']
  tagCursor?: string
  execute: ExecuteManagementMutation
  loadMoreTags: () => void | Promise<unknown>
  refreshMetadata: () => Promise<unknown>
  onTagDeleted: (tagId: string) => void
}>

function normalizedTagName(value: string): string {
  return value.trim().toLowerCase()
}

export function usePersonalTagManagementWorkflow(input: TagManagementInput) {
  const [selectedTagId, setSelectedTagId] = useState<string | undefined>()
  const [newTagName, setNewTagName] = useState('')
  const [tagNameDraft, setTagNameDraft] = useState('')
  const [tagDeleteArmed, setTagDeleteArmed] = useState(false)

  useEffect(() => {
    setSelectedTagId((current) => (
      current !== undefined && input.tags.some((item) => item.tagId === current)
        ? current
        : input.tags[0]?.tagId
    ))
  }, [input.tags])

  useEffect(() => {
    setTagDeleteArmed(false)
    const selected = input.tags.find((item) => item.tagId === selectedTagId)
    setTagNameDraft(selected?.name ?? '')
  }, [input.tags, selectedTagId])

  const selectedTag = input.tags.find((item) => item.tagId === selectedTagId)
  const newTagValue = newTagName.trim()
  const tagNameValue = tagNameDraft.trim()
  const tagNameAlreadyExists = (value: string, exceptTagId?: string) => input.tags.some((item) => (
    item.tagId !== exceptTagId && normalizedTagName(item.name) === normalizedTagName(value)
  ))

  const createTag = () => {
    if (
      newTagValue.length === 0 || newTagValue.length > 64 ||
      tagNameAlreadyExists(newTagValue)
    ) return Promise.resolve()
    const tagId = crypto.randomUUID()
    return input.execute({
      key: `tag:create:${tagId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: { kind: 'create-tag', tagId, name: newTagValue },
      },
      failureMessage: '태그를 만들지 못했습니다.',
      onApplied: async () => {
        setNewTagName('')
        await input.refreshMetadata()
        setSelectedTagId(tagId)
      },
    })
  }

  const renameTag = () => {
    if (
      selectedTag === undefined || tagNameValue.length === 0 || tagNameValue.length > 64 ||
      tagNameValue === selectedTag.name || tagNameAlreadyExists(tagNameValue, selectedTag.tagId)
    ) return Promise.resolve()
    return input.execute({
      key: `tag:rename:${selectedTag.tagId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: { kind: 'rename-tag', tagId: selectedTag.tagId, name: tagNameValue },
      },
      failureMessage: '태그 이름을 바꾸지 못했습니다.',
      onApplied: input.refreshMetadata,
    })
  }

  const deleteTag = () => {
    if (selectedTag === undefined || !tagDeleteArmed) return Promise.resolve()
    const tagId = selectedTag.tagId
    return input.execute({
      key: `tag:delete:${tagId}`,
      request: {
        commandId: crypto.randomUUID(),
        command: { kind: 'delete-tag', tagId },
      },
      failureMessage: '태그를 삭제하지 못했습니다.',
      onApplied: async () => {
        input.onTagDeleted(tagId)
        setSelectedTagId(undefined)
        await input.refreshMetadata()
      },
    })
  }

  return {
    tags: input.tags,
    tagCursor: input.tagCursor,
    selectedTagId,
    newTagName,
    tagNameDraft,
    tagDeleteArmed,
    newTagValid: newTagValue.length > 0 && newTagValue.length <= 64 &&
      !tagNameAlreadyExists(newTagValue),
    tagNameValid: selectedTag !== undefined && tagNameValue.length > 0 &&
      tagNameValue.length <= 64 && tagNameValue !== selectedTag.name &&
      !tagNameAlreadyExists(tagNameValue, selectedTag.tagId),
    selectTag: setSelectedTagId,
    setNewTagName,
    setTagNameDraft,
    armTagDelete: () => setTagDeleteArmed(true),
    cancelTagDelete: () => setTagDeleteArmed(false),
    createTag,
    renameTag,
    deleteTag,
    loadMoreTags: input.loadMoreTags,
  }
}
