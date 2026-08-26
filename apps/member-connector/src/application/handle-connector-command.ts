import {
  connectorExtensionEventSchema,
  type ConnectorBrowserKey,
  type ConnectorExtensionEvent,
  type ConnectorGrant,
  type ConnectorPageCommand,
  type ConnectorProviderKey,
  type ConnectorResultCode,
} from '@place/contracts/connector'

import {
  ConnectorOperationError,
  type CollectionProgress,
  type SavedLibraryCollectionResult,
} from './collect-saved-library.js'

export type SavedLibraryOperation = (input: Readonly<{
  grant: ConnectorGrant
  signal: AbortSignal
  onProgress: (progress: CollectionProgress) => void | Promise<void>
}>) => Promise<SavedLibraryCollectionResult>

type Dependencies = Readonly<{
  browserKey: ConnectorBrowserKey
  getInstallationId(): Promise<string>
  operations: ReadonlyMap<ConnectorProviderKey, SavedLibraryOperation>
}>

type HandleInput = Readonly<{
  sourceOrigin?: string
  command: ConnectorPageCommand
  emit(event: ConnectorExtensionEvent): void | Promise<void>
}>

type ActiveOperation = Readonly<{
  abort: AbortController
  requestId: string
}>

export class ConnectorCommandHandler {
  private readonly active = new Map<string, ActiveOperation>()

  constructor(private readonly dependencies: Dependencies) {}

  async handle(input: HandleInput): Promise<void> {
    if (input.command.kind === 'probe') {
      await input.emit(connectorExtensionEventSchema.parse({
        schemaVersion: 'place-connector-event.v1',
        channel: 'place-connector',
        requestId: input.command.requestId,
        kind: 'ready',
        installationId: await this.dependencies.getInstallationId(),
        browserKey: this.dependencies.browserKey,
        supportedProviders: [...this.dependencies.operations.keys()].sort(),
      }))
      return
    }

    if (input.command.kind === 'cancel-import') {
      this.active.get(input.command.operationId)?.abort.abort(
        new DOMException('Connector operation cancelled', 'AbortError'),
      )
      return
    }

    const { grant } = input.command
    if (input.sourceOrigin !== grant.placeOrigin) {
      await this.emitResult(
        input.emit,
        input.command.requestId,
        grant.operationId,
        'invalid-request',
        false,
      )
      return
    }
    const operation = this.dependencies.operations.get(grant.providerKey)
    if (operation === undefined) {
      await this.emitResult(
        input.emit,
        input.command.requestId,
        grant.operationId,
        'provider-unavailable',
        true,
      )
      return
    }
    if (this.active.has(grant.operationId)) {
      await this.emitResult(
        input.emit,
        input.command.requestId,
        grant.operationId,
        'invalid-request',
        false,
      )
      return
    }

    const abort = new AbortController()
    this.active.set(grant.operationId, { abort, requestId: input.command.requestId })
    try {
      await operation({
        grant,
        signal: abort.signal,
        onProgress: async (progress) => input.emit(connectorExtensionEventSchema.parse({
          schemaVersion: 'place-connector-event.v1',
          channel: 'place-connector',
          requestId: input.command.requestId,
          kind: 'progress',
          operationId: grant.operationId,
          progress,
        })),
      })
      await this.emitResult(
        input.emit,
        input.command.requestId,
        grant.operationId,
        'completed',
        false,
      )
    } catch (error) {
      if (abort.signal.aborted) {
        await this.emitResult(
          input.emit,
          input.command.requestId,
          grant.operationId,
          'cancelled',
          false,
        )
      } else if (error instanceof ConnectorOperationError) {
        await this.emitResult(
          input.emit,
          input.command.requestId,
          grant.operationId,
          error.code,
          error.retryable,
        )
      } else {
        await this.emitResult(
          input.emit,
          input.command.requestId,
          grant.operationId,
          'internal-failure',
          true,
        )
      }
    } finally {
      this.active.delete(grant.operationId)
    }
  }

  private async emitResult(
    emit: HandleInput['emit'],
    requestId: string,
    operationId: string,
    code: ConnectorResultCode,
    retryable: boolean,
  ): Promise<void> {
    await emit(connectorExtensionEventSchema.parse({
      schemaVersion: 'place-connector-event.v1',
      channel: 'place-connector',
      requestId,
      kind: 'result',
      operationId,
      code,
      retryable,
    }))
  }
}
