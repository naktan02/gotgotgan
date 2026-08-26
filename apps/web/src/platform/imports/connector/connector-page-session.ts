import {
  connectorExtensionEventSchema,
  connectorPageCommandSchema,
  type ConnectorExtensionEvent,
  type ConnectorGrant,
  type ConnectorProviderKey,
} from '@place/contracts/connector'

type PageWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'postMessage'>
type ReadyEvent = Extract<ConnectorExtensionEvent, Readonly<{ kind: 'ready' }>>
type ResultEvent = Extract<ConnectorExtensionEvent, Readonly<{ kind: 'result' }>>
type ProgressEvent = Extract<ConnectorExtensionEvent, Readonly<{ kind: 'progress' }>>

type Pending = Readonly<{
  accept(event: ConnectorExtensionEvent): boolean
  cancel(): void
}>

export class ConnectorPageSession {
  private readonly pending = new Map<string, Pending>()
  private readonly listener: (event: MessageEvent<unknown>) => void
  private closed = false

  constructor(
    private readonly page: PageWindow,
    private readonly origin: string,
  ) {
    this.listener = (event) => {
      if (event.source !== this.page || event.origin !== this.origin) return
      const parsed = connectorExtensionEventSchema.safeParse(event.data)
      if (!parsed.success) return
      const pending = this.pending.get(parsed.data.requestId)
      if (pending?.accept(parsed.data) === true) this.pending.delete(parsed.data.requestId)
    }
    page.addEventListener('message', this.listener as EventListener)
  }

  private command(command: unknown): void {
    if (this.closed) throw new Error('Connector page session is closed.')
    this.page.postMessage(connectorPageCommandSchema.parse(command), this.origin)
  }

  private waitFor<T extends ConnectorExtensionEvent>(input: Readonly<{
    requestId: string
    timeoutMilliseconds: number
    accept(event: ConnectorExtensionEvent): T | undefined
  }>): Promise<T | undefined> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(input.requestId)
        resolve(undefined)
      }, input.timeoutMilliseconds)
      this.pending.set(input.requestId, {
        accept: (event) => {
          const accepted = input.accept(event)
          if (accepted === undefined) return false
          window.clearTimeout(timer)
          resolve(accepted)
          return true
        },
        cancel: () => {
          window.clearTimeout(timer)
          resolve(undefined)
        },
      })
    })
  }

  async probe(timeoutMilliseconds = 800): Promise<ReadyEvent | undefined> {
    const requestId = crypto.randomUUID()
    const response = this.waitFor<ReadyEvent>({
      requestId,
      timeoutMilliseconds,
      accept: (event) => event.kind === 'ready' ? event : undefined,
    })
    this.command({
      schemaVersion: 'place-connector-command.v1', channel: 'place-connector',
      requestId, kind: 'probe',
    })
    return response
  }

  async prepare(
    providerKey: ConnectorProviderKey,
    timeoutMilliseconds = 30_000,
  ): Promise<boolean> {
    const requestId = crypto.randomUUID()
    const response = this.waitFor<Extract<ConnectorExtensionEvent, { kind: 'prepared' }>>({
      requestId,
      timeoutMilliseconds,
      accept: (event) => event.kind === 'prepared' ? event : undefined,
    })
    this.command({
      schemaVersion: 'place-connector-command.v1', channel: 'place-connector',
      requestId, kind: 'prepare-import', providerKey,
    })
    return (await response)?.allowed ?? false
  }

  async start(
    grant: ConnectorGrant,
    onProgress: (event: ProgressEvent) => void,
    timeoutMilliseconds = 300_000,
  ): Promise<ResultEvent | undefined> {
    const requestId = crypto.randomUUID()
    const response = this.waitFor<ResultEvent>({
      requestId,
      timeoutMilliseconds,
      accept: (event) => {
        if (event.kind === 'progress') {
          onProgress(event)
          return undefined
        }
        return event.kind === 'result' ? event : undefined
      },
    })
    this.command({
      schemaVersion: 'place-connector-command.v1', channel: 'place-connector',
      requestId, kind: 'start-import', grant,
    })
    return response
  }

  cancel(operationId: string): void {
    this.command({
      schemaVersion: 'place-connector-command.v1', channel: 'place-connector',
      requestId: crypto.randomUUID(), kind: 'cancel-import', operationId,
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.page.removeEventListener('message', this.listener as EventListener)
    for (const pending of this.pending.values()) pending.cancel()
    this.pending.clear()
  }
}
