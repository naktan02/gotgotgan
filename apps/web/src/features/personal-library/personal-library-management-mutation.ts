'use client'

import type { BrowserLibraryCommandRequest } from '@place/contracts/http'
import { useCallback, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
} from './personal-library-http'

export type ManagementMutation = Readonly<{
  key: string
  request: BrowserLibraryCommandRequest
  failureMessage: string
  onApplied: () => Promise<unknown>
}>

export type ExecuteManagementMutation = (mutation: ManagementMutation) => Promise<void>

export function usePersonalLibraryManagementMutation(input: Readonly<{
  onAccessFailure: (reason: unknown) => void
  refreshMetadata: () => Promise<unknown>
}>) {
  const [mutationKey, setMutationKey] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [failedMutation, setFailedMutation] = useState<ManagementMutation | undefined>()
  const mutationRef = useRef<string | undefined>(undefined)

  const execute = useCallback<ExecuteManagementMutation>(async (mutation) => {
    if (mutationRef.current !== undefined) return
    mutationRef.current = mutation.key
    setMutationKey(mutation.key)
    setError(undefined)
    setFailedMutation(undefined)
    try {
      await personalLibraryHttp.command(mutation.request)
      await mutation.onApplied()
    } catch (reason) {
      if (reason instanceof BrowserLibraryProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else if (reason instanceof BrowserLibraryProblem && [400, 404, 409].includes(reason.status)) {
        await input.refreshMetadata().catch(() => undefined)
        setError('대상이 이미 변경되었거나 입력을 적용할 수 없습니다. 최신 목록에서 다시 시도해 주세요.')
      } else {
        setFailedMutation(mutation)
        setError(mutation.failureMessage)
      }
    } finally {
      mutationRef.current = undefined
      setMutationKey(undefined)
    }
  }, [input.onAccessFailure, input.refreshMetadata])

  return {
    mutationKey,
    managementMutationError: error,
    canRetryManagementMutation: failedMutation !== undefined,
    executeManagementMutation: execute,
    retryManagementMutation: () => failedMutation === undefined
      ? undefined
      : execute(failedMutation),
  }
}
