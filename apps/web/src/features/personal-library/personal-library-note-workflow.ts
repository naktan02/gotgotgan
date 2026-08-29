'use client'

import type { BrowserPrivateNoteCommandRequest } from '@place/contracts/http'
import type { WritingDetailResponse, WritingListResponse } from '@place/contracts/writing'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserWritingProblem,
  personalLibraryNotesHttp,
} from './personal-library-notes-http'

type NoteSummary = Extract<WritingListResponse['items'][number], { kind: 'note' }>
type NoteDocument = Extract<WritingDetailResponse['document'], { kind: 'note' }>
type NoteListLoad = Readonly<{ placeId: string; cursor?: string; append: boolean }>

type NoteWorkflowInput = Readonly<{
  active: boolean
  selectedPlaceId?: string
  onAccessFailure: (reason: unknown) => void
}>

function noteForPlace(document: WritingDetailResponse['document'], placeId: string): NoteDocument | undefined {
  return document.kind === 'note' && document.placeIds.length === 1 && document.placeIds[0] === placeId
    ? document
    : undefined
}

export function usePersonalLibraryNoteWorkflow(input: NoteWorkflowInput) {
  const [items, setItems] = useState<readonly NoteSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [selectedDocument, setSelectedDocument] = useState<NoteDocument | undefined>()
  const [draft, setDraft] = useState('')
  const [originalBody, setOriginalBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [failedCommand, setFailedCommand] = useState<BrowserPrivateNoteCommandRequest | undefined>()
  const [failedList, setFailedList] = useState<NoteListLoad | undefined>()
  const [versionConflict, setVersionConflict] = useState(false)
  const listSequence = useRef(0)
  const detailSequence = useRef(0)
  const mutationRef = useRef(false)
  const selectedPlaceRef = useRef(input.selectedPlaceId)
  selectedPlaceRef.current = input.selectedPlaceId

  const loadList = useCallback(async (
    placeId: string,
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++listSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    setFailedList(undefined)
    if (!append) {
      setItems([])
      setNextCursor(undefined)
    }
    try {
      const page = await personalLibraryNotesHttp.list(placeId, cursor, signal)
      if (sequence !== listSequence.current || selectedPlaceRef.current !== placeId) return
      const notes = page.items.filter((item): item is NoteSummary => item.kind === 'note')
      setItems((current) => append ? [...current, ...notes] : notes)
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== listSequence.current || selectedPlaceRef.current !== placeId ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (reason instanceof BrowserWritingProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else {
        setFailedList({ placeId, ...(cursor === undefined ? {} : { cursor }), append })
        setError('메모 목록을 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === listSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [input.onAccessFailure])

  const loadDetail = useCallback(async (placeId: string, documentId: string, signal?: AbortSignal) => {
    const sequence = ++detailSequence.current
    setDetailLoading(true)
    setError(undefined)
    try {
      const response = await personalLibraryNotesHttp.detail(documentId, signal)
      const document = noteForPlace(response.document, placeId)
      if (document === undefined) throw new Error('Writing detail does not match the selected Place')
      if (sequence !== detailSequence.current || selectedPlaceRef.current !== placeId) return
      setSelectedDocument(document)
      setDraft(document.body)
      setOriginalBody(document.body)
      setVersionConflict(false)
    } catch (reason) {
      if (
        sequence !== detailSequence.current || selectedPlaceRef.current !== placeId ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (reason instanceof BrowserWritingProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else {
        setError('메모 내용을 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false)
    }
  }, [input.onAccessFailure])

  useEffect(() => {
    listSequence.current += 1
    detailSequence.current += 1
    setItems([])
    setNextCursor(undefined)
    setSelectedDocument(undefined)
    setDraft('')
    setOriginalBody('')
    setError(undefined)
    setNotice(undefined)
    setFailedCommand(undefined)
    setFailedList(undefined)
    setVersionConflict(false)
    if (!input.active || input.selectedPlaceId === undefined) return
    const controller = new AbortController()
    void loadList(input.selectedPlaceId, undefined, false, controller.signal)
    return () => controller.abort()
  }, [input.active, input.selectedPlaceId, loadList])

  const executeCommand = useCallback(async (request: BrowserPrivateNoteCommandRequest) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    setFailedCommand(undefined)
    setVersionConflict(false)
    try {
      await personalLibraryNotesHttp.command(request)
      const placeId = request.command.placeId
      if (selectedPlaceRef.current !== placeId) return
      await loadList(placeId)
      await loadDetail(placeId, request.command.documentId)
      setNotice(request.command.kind === 'create-note' ? '비공개 메모를 만들었습니다.' : '메모를 저장했습니다.')
    } catch (reason) {
      if (selectedPlaceRef.current !== request.command.placeId) return
      if (reason instanceof BrowserWritingProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else if (
        reason instanceof BrowserWritingProblem &&
        reason.code === 'PLACE_WRITING_VERSION_CONFLICT'
      ) {
        setVersionConflict(true)
        setError('다른 곳에서 메모가 변경되었습니다. 현재 초안은 덮어쓰지 않았습니다.')
      } else if (reason instanceof BrowserWritingProblem && reason.status === 409) {
        setError('저장 요청이 이전 요청과 충돌했습니다. 다시 저장해 주세요.')
      } else if (reason instanceof BrowserWritingProblem && reason.status === 404) {
        setSelectedDocument(undefined)
        setVersionConflict(true)
        setError('이 메모가 더 이상 존재하지 않습니다. 목록을 새로 확인해 주세요.')
      } else if (reason instanceof BrowserWritingProblem && reason.status === 400) {
        setError('메모 내용을 확인해 주세요.')
      } else {
        setFailedCommand(request)
        setError('메모 저장 결과를 확인하지 못했습니다.')
      }
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }, [input.onAccessFailure, loadDetail, loadList])

  const dirty = draft !== originalBody
  const bodyValid = draft.trim().length > 0 && draft.length <= 2_000

  return {
    notes: {
      items,
      nextCursor,
      selectedDocumentId: selectedDocument?.documentId,
      draft,
      dirty,
      bodyValid,
      loading,
      loadingMore,
      detailLoading,
      saving,
      error,
      notice,
      canRetryCommand: failedCommand !== undefined,
      canRetryList: failedList !== undefined,
      versionConflict,
      setDraft,
      startNew: () => {
        if (dirty) return
        detailSequence.current += 1
        setSelectedDocument(undefined)
        setDraft('')
        setOriginalBody('')
        setError(undefined)
        setNotice(undefined)
        setVersionConflict(false)
      },
      edit: (documentId: string) => input.selectedPlaceId === undefined || dirty
        ? undefined
        : loadDetail(input.selectedPlaceId, documentId),
      discardChanges: () => setDraft(originalBody),
      save: () => {
        if (input.selectedPlaceId === undefined || !bodyValid || !dirty || versionConflict) {
          return undefined
        }
        const commandId = crypto.randomUUID()
        return executeCommand(selectedDocument === undefined
          ? {
              commandId,
              command: {
                kind: 'create-note', documentId: crypto.randomUUID(),
                placeId: input.selectedPlaceId, body: draft,
              },
            }
          : {
              commandId,
              command: {
                kind: 'update-note', documentId: selectedDocument.documentId,
                expectedVersion: selectedDocument.version,
                placeId: input.selectedPlaceId, body: draft,
              },
            })
      },
      retryCommand: () => failedCommand === undefined ? undefined : executeCommand(failedCommand),
      retryList: () => failedList === undefined
        ? undefined
        : loadList(failedList.placeId, failedList.cursor, failedList.append),
      reloadConflict: async () => {
        if (input.selectedPlaceId === undefined) return
        if (selectedDocument === undefined) {
          await loadList(input.selectedPlaceId)
          setVersionConflict(false)
          return
        }
        await loadDetail(input.selectedPlaceId, selectedDocument.documentId)
      },
      loadMore: () => input.selectedPlaceId === undefined || nextCursor === undefined
        ? undefined
        : loadList(input.selectedPlaceId, nextCursor, true),
    },
  }
}

export type PersonalLibraryNotes = ReturnType<typeof usePersonalLibraryNoteWorkflow>['notes']
