import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectorPageSession } from './connector-page-session'

const origin = 'https://place.example'
const operationId = '01992d20-7000-7000-8000-000000000071'

function grant() {
  return {
    schemaVersion: 'place-connector-grant.v1' as const,
    operationId,
    providerKey: 'naver' as const,
    operation: 'import-saved-library' as const,
    idempotencyKey: '01992d20-7000-7000-8000-000000000072',
    token: 'opaque.connector.grant.token.that.is.long.enough',
    placeOrigin: origin,
    expiresAt: '2026-08-26T12:00:00.000Z',
    limits: {
      maximumItems: 100,
      maximumBytes: 10_000,
      maximumBatches: 10,
      maximumBatchBytes: 5_000,
    },
  }
}

class PageHarness {
  readonly commands: unknown[] = []
  private readonly listeners = new Set<EventListener>()

  get listenerCount(): number {
    return this.listeners.size
  }

  addEventListener(_type: string, listener: EventListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: EventListener): void {
    this.listeners.delete(listener)
  }

  postMessage(command: unknown): void {
    this.commands.push(command)
  }

  emit(data: unknown): void {
    const event = { source: this, origin, data } as unknown as Event
    for (const listener of this.listeners) listener(event)
  }
}

function commandKinds(page: PageHarness): string[] {
  return page.commands.map((command) => (command as { kind: string }).kind)
}

describe('connector page session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancels the connector operation when start times out', async () => {
    const page = new PageHarness()
    const session = new ConnectorPageSession(page as never, origin)

    const result = session.start(grant(), vi.fn(), 100)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBeUndefined()
    expect(commandKinds(page)).toEqual(['start-import', 'cancel-import'])
    expect(page.commands.at(-1)).toMatchObject({ kind: 'cancel-import', operationId })
  })

  it('cancels the active operation and settles start when the session closes', async () => {
    const page = new PageHarness()
    const session = new ConnectorPageSession(page as never, origin)

    const result = session.start(grant(), vi.fn(), 1_000)
    session.close()

    await expect(result).resolves.toBeUndefined()
    expect(commandKinds(page)).toEqual(['start-import', 'cancel-import'])
    expect(vi.getTimerCount()).toBe(0)
    expect(page.listenerCount).toBe(0)
  })

  it('settles the active start when cancellation is explicit', async () => {
    const page = new PageHarness()
    const session = new ConnectorPageSession(page as never, origin)

    const result = session.start(grant(), vi.fn(), 1_000)
    session.cancel(operationId)

    expect(commandKinds(page)).toEqual(['start-import', 'cancel-import'])
    expect(vi.getTimerCount()).toBe(0)
    await expect(result).resolves.toBeUndefined()
  })

  it('does not cancel an operation that already returned a terminal result', async () => {
    const page = new PageHarness()
    const session = new ConnectorPageSession(page as never, origin)

    const result = session.start(grant(), vi.fn(), 1_000)
    const requestId = (page.commands[0] as { requestId: string }).requestId
    page.emit({
      schemaVersion: 'place-connector-event.v1',
      channel: 'place-connector',
      requestId,
      kind: 'result',
      operationId,
      code: 'completed',
      retryable: false,
      importBatchId: '01992d20-7000-7000-8000-000000000073',
    })
    session.close()

    await expect(result).resolves.toMatchObject({ kind: 'result', code: 'completed' })

    expect(commandKinds(page)).toEqual(['start-import'])
    expect(vi.getTimerCount()).toBe(0)
  })
})
