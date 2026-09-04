import type {
  ConnectorTransferRuntimeCapabilities,
} from '../application/connector-transfer-runtime.js'

/** Shipped transfer capabilities shown by entrypoints before any Provider permission is requested. */
export const configuredConnectorTransferCapabilities: ConnectorTransferRuntimeCapabilities =
  Object.freeze({ importProviders: Object.freeze([]), exportProviders: Object.freeze([]) })

export const configuredConnectorTransferActivation = Object.freeze({
  deliveryState: 'source-only' as const,
  capabilities: configuredConnectorTransferCapabilities,
  blockers: Object.freeze([
    Object.freeze({
      code: 'SECURE_KEY_PROVISIONING_UNAVAILABLE',
      summary: 'No restart-safe non-extractable Connector key provider is configured.',
    }),
    Object.freeze({
      code: 'EXTENSION_CAPABILITY_ORIGIN_UNAVAILABLE',
      summary: 'No dedicated server-verified extension-origin capability channel is configured.',
    }),
    Object.freeze({
      code: 'TRUSTED_PROVIDER_ACCOUNT_IDENTITY_UNAVAILABLE',
      summary: 'No trusted Provider account identity reader is configured.',
    }),
    Object.freeze({
      code: 'PROVIDER_WRITE_ADAPTER_UNVERIFIED',
      summary: 'No Provider saved-list write adapter has verified live evidence.',
    }),
  ]),
})
