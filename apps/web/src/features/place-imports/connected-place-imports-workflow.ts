'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ConnectorExtensionEvent } from '@place/contracts/connector'
import {
  currentMembershipConsentsSchema,
  membershipOnboardingRequestSchema,
  membershipOnboardingResultSchema,
  problemSchema,
} from '@place/contracts/http'
import {
  placeImportBatchDetailSchema,
  placeImportBatchSchema,
  placeImportReviewResultSchema,
  providerConnectionListSchema,
  type PlaceImportBatchDetail,
  type PlaceImportItem,
} from '@place/contracts/imports'

import { ConnectorPageSession } from '@/platform/imports/connector/page-session/connector-page-session'

export type ImportBrowserSessionState = 'checking' | 'anonymous' | 'authenticated'

export type ImportAction =
  | Readonly<{ kind: 'create-place' }>
  | Readonly<{ kind: 'link-place'; canonicalPlaceId: string }>
  | Readonly<{ kind: 'skip'; reason?: string }>

type ConnectorReady = Extract<ConnectorExtensionEvent, Readonly<{ kind: 'ready' }>>

const activeStates = new Set(['queued', 'running', 'partial', 'enriching'])

class ImportBrowserProblem extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) {
    super(message)
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new ImportBrowserProblem('가져오기 응답을 확인하지 못했습니다.', true)
  }
  const payload: unknown = await response.json()
  if (!response.ok) {
    const parsed = problemSchema.safeParse(payload)
    throw new ImportBrowserProblem(
      parsed.success ? parsed.data.title : '가져오기를 처리하지 못했습니다.',
      parsed.success ? parsed.data.retryable : true,
      parsed.success ? parsed.data.code : undefined,
    )
  }
  return payload
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body === undefined ? init?.headers : {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      'content-type': 'application/json',
    },
    cache: 'no-store',
  })
  return responsePayload(response)
}

export function useConnectedPlaceImportsWorkflow() {
  const [connections, setConnections] = useState<ReturnType<typeof providerConnectionListSchema.parse>['items']>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>()
  const [detail, setDetail] = useState<PlaceImportBatchDetail>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [reviewingItemId, setReviewingItemId] = useState<string>()
  const [reviewResults, setReviewResults] = useState<Readonly<Record<string, string>>>({})
  const [connectorChecking, setConnectorChecking] = useState(true)
  const [connectorReady, setConnectorReady] = useState<ConnectorReady>()
  const [onboardingRequired, setOnboardingRequired] = useState(false)
  const [onboardingConsents, setOnboardingConsents] = useState<
    ReturnType<typeof currentMembershipConsentsSchema.parse>['consents']
  >()
  const [acceptedConsentKeys, setAcceptedConsentKeys] = useState<ReadonlySet<string>>(new Set())
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [browserSessionState, setBrowserSessionState] =
    useState<ImportBrowserSessionState>('checking')
  const connectorSession = useRef<ConnectorPageSession | undefined>(undefined)
  const startCommand = useRef<string | undefined>(undefined)
  const reviewCommands = useRef(new Map<string, string>())
  const batch = detail?.batch

  const loadConnections = useCallback(async () => {
    try {
      const projection = providerConnectionListSchema.parse(
        await requestJson('/api/imports/connections'),
      )
      setConnections(projection.items)
      setSelectedConnectionId(
        projection.items.find((item) => item.status === 'ready')?.connectionId,
      )
      setOnboardingRequired(false)
      setBrowserSessionState('authenticated')
    } catch (failure) {
      if (
        failure instanceof ImportBrowserProblem &&
        failure.code === 'PLACE_AUTHENTICATION_REQUIRED'
      ) {
        setBrowserSessionState('anonymous')
        setOnboardingRequired(false)
        setError(undefined)
        return
      }
      if (failure instanceof ImportBrowserProblem && failure.code === 'PLACE_ACCESS_DENIED') {
        setBrowserSessionState('authenticated')
        setOnboardingRequired(true)
        setError(undefined)
        try {
          const current = currentMembershipConsentsSchema.parse(
            await requestJson('/api/membership-consents/current'),
          )
          setOnboardingConsents(current.consents)
          setAcceptedConsentKeys(new Set())
        } catch (consentFailure) {
          setError(
            consentFailure instanceof Error
              ? consentFailure.message
              : '현재 Place 이용 동의를 불러오지 못했습니다.',
          )
        }
        return
      }
      setError(
        failure instanceof Error ? failure.message : '연결 계정을 불러오지 못했습니다.',
      )
    }
  }, [])

  const loadDetail = useCallback(async (batchId: string) => {
    const parsed = placeImportBatchDetailSchema.parse(await requestJson(`/api/imports/${batchId}`))
    setDetail(parsed)
  }, [])

  const probeConnector = useCallback(async () => {
    setConnectorChecking(true)
    const ready = await connectorSession.current?.probe()
    setConnectorReady(ready)
    setConnectorChecking(false)
  }, [])

  useEffect(() => {
    const session = new ConnectorPageSession(window, window.location.origin)
    connectorSession.current = session
    void probeConnector()
    return () => {
      session.close()
      connectorSession.current = undefined
    }
  }, [probeConnector])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  async function completeOnboarding() {
    if (
      onboardingConsents === undefined ||
      acceptedConsentKeys.size !== onboardingConsents.length
    ) return
    setOnboardingBusy(true)
    setError(undefined)
    try {
      const request = membershipOnboardingRequestSchema.parse({
        acceptedConsents: onboardingConsents,
      })
      const result = membershipOnboardingResultSchema.parse(
        await requestJson('/api/memberships/onboarding', {
          method: 'POST',
          body: JSON.stringify(request),
        }),
      )
      if (result.authorityRole !== 'owner') {
        throw new ImportBrowserProblem('Platform Owner 권한을 Place에 연결하지 못했습니다.', true)
      }
      setOnboardingRequired(false)
      setOnboardingConsents(undefined)
      setAcceptedConsentKeys(new Set())
      await loadConnections()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Place 가입을 완료하지 못했습니다.')
    } finally {
      setOnboardingBusy(false)
    }
  }

  useEffect(() => {
    if (batch === undefined || !activeStates.has(batch.state)) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const parsed = placeImportBatchDetailSchema.parse(await requestJson(`/api/imports/${batch.batchId}`))
        if (!active) return
        setDetail(parsed)
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : '진행 상황을 확인하지 못했습니다.')
      }
      if (active) timer = window.setTimeout(() => void poll(), 1_000)
    }
    timer = window.setTimeout(() => void poll(), 1_000)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [batch?.batchId, batch?.state])

  async function startServerImport() {
    if (selectedConnectionId === undefined) return
    setBusy(true)
    setError(undefined)
    startCommand.current ??= crypto.randomUUID()
    try {
      const created = placeImportBatchSchema.parse(await requestJson('/api/imports', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 'place-import-request.v1',
          connectionId: selectedConnectionId,
          idempotencyKey: startCommand.current,
        }),
      }))
      await loadDetail(created.batchId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '가져오기를 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function transition(kind: 'cancel' | 'resume') {
    if (batch === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const updated = placeImportBatchSchema.parse(await requestJson(
        `/api/imports/${batch.batchId}/${kind}`,
        { method: 'POST', body: JSON.stringify({ schemaVersion: `place-import-${kind === 'cancel' ? 'cancel' : 'resume'}.v1` }) },
      ))
      setDetail((current) => current === undefined ? current : { ...current, batch: updated })
      if (kind === 'resume') await loadDetail(batch.batchId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '가져오기 상태를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function review(item: PlaceImportItem, action: ImportAction) {
    const key = `${item.itemId}:${JSON.stringify(action)}`
    const commandId = reviewCommands.current.get(key) ?? crypto.randomUUID()
    reviewCommands.current.set(key, commandId)
    setReviewingItemId(item.itemId)
    setError(undefined)
    try {
      placeImportReviewResultSchema.parse(await requestJson('/api/import-reviews', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 'place-import-review.v1', commandId, itemId: item.itemId, action,
        }),
      }))
      setReviewResults((current) => ({
        ...current, [item.itemId]: action.kind === 'skip' ? '건너뜀' : '저장 완료',
      }))
      await loadDetail(item.batchId)
      reviewCommands.current.delete(key)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '검토 결과를 확인하지 못했습니다.')
    } finally {
      setReviewingItemId(undefined)
    }
  }

  const items = detail?.items ?? []
  const batchActive = batch !== undefined && activeStates.has(batch.state)

  function setConsentAccepted(key: string, accepted: boolean) {
    setAcceptedConsentKeys((current) => {
      const next = new Set(current)
      if (accepted) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return {
    connections,
    selectedConnectionId,
    detail,
    batch,
    busy,
    error,
    reviewingItemId,
    reviewResults,
    connectorChecking,
    connectorReady,
    onboardingRequired,
    onboardingConsents,
    acceptedConsentKeys,
    onboardingBusy,
    browserSessionState,
    items,
    batchActive,
    selectConnection: setSelectedConnectionId,
    setConsentAccepted,
    completeOnboarding,
    probeConnector,
    startServerImport,
    transition,
    review,
  }
}

export type ConnectedPlaceImportsWorkflow = ReturnType<typeof useConnectedPlaceImportsWorkflow>
