import {
  connectorExtensionEventSchema,
  connectorPageCommandSchema,
} from '@place/contracts/connector'
import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'

const placeOrigin = import.meta.env.WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN
const parsedPlaceOrigin = new URL(placeOrigin)
if (placeOrigin !== parsedPlaceOrigin.origin) {
  throw new Error('WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN must be an exact origin')
}

export default defineContentScript({
  matches: [`${placeOrigin}/*`],
  runAt: 'document_start',
  main(context) {
    context.addEventListener(window, 'message', (event) => {
      if (event.source !== window || event.origin !== placeOrigin) return
      const command = connectorPageCommandSchema.safeParse(event.data)
      if (!command.success) return
      void browser.runtime.sendMessage(command.data).catch(() => {
        const operationId = command.data.kind === 'start-import'
          ? command.data.grant.operationId
          : command.data.kind === 'cancel-import'
            ? command.data.operationId
            : undefined
        window.postMessage({
          schemaVersion: 'place-connector-event.v1',
          channel: 'place-connector',
          requestId: command.data.requestId,
          kind: 'result',
          ...(operationId === undefined ? {} : { operationId }),
          code: 'internal-failure',
          retryable: true,
        }, placeOrigin)
      })
    })

    const forward = (message: unknown): false => {
      const event = connectorExtensionEventSchema.safeParse(message)
      if (event.success) window.postMessage(event.data, placeOrigin)
      return false
    }
    browser.runtime.onMessage.addListener(forward)
    context.onInvalidated(() => browser.runtime.onMessage.removeListener(forward))
  },
})
