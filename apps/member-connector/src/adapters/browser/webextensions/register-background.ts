import { connectorPageCommandSchema } from '@place/contracts/connector'

import type { ConnectorCommandHandler } from '../../../application/handle-connector-command.js'

type MessageSenderLike = Readonly<{
  url?: string | undefined
  tab?: Readonly<{
    id?: number | undefined
    url?: string | undefined
  }> | undefined
}>

type BrowserRuntimeLike = Readonly<{
  runtime: Readonly<{
    onMessage: Readonly<{
      addListener(listener: (
        message: unknown,
        sender: MessageSenderLike,
        sendResponse: (response?: unknown) => void,
      ) => void): void
    }>
  }>
  tabs: Readonly<{
    sendMessage(tabId: number, message: unknown): Promise<unknown>
  }>
}>

function sourceOrigin(sender: MessageSenderLike): string | undefined {
  const source = sender.url ?? sender.tab?.url
  if (source === undefined) return undefined
  try {
    return new URL(source).origin
  } catch {
    return undefined
  }
}

export function registerConnectorBackground(
  runtime: BrowserRuntimeLike,
  handler: ConnectorCommandHandler,
): void {
  runtime.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const command = connectorPageCommandSchema.safeParse(message)
    if (!command.success) {
      sendResponse({ accepted: false })
      return
    }
    const tabId = sender.tab?.id
    const origin = sourceOrigin(sender)
    sendResponse({ accepted: true })
    void handler.handle({
      ...(origin === undefined ? {} : { sourceOrigin: origin }),
      command: command.data,
      emit: async (event) => {
        if (tabId !== undefined) await runtime.tabs.sendMessage(tabId, event)
      },
    }).catch(() => undefined)
  })
}
