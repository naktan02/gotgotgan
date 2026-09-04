import { createHash } from 'node:crypto'

import type { ConnectorCapturePayload, ConnectorManifest } from '../domain/operations.js'

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function captureManifestDigestInput(input: Readonly<{
  operationId: string; connectionId: string; providerKey: string; accountFingerprint: string
  installationId: string; manifest: Omit<ConnectorManifest, 'manifestDigest'>
  chunks: readonly Readonly<{
    sequence: number; itemCount: number; byteCount: number; checksum: string
  }>[]
}>): string {
  return JSON.stringify({
    operationId: input.operationId, connectionId: input.connectionId,
    providerKey: input.providerKey, accountFingerprint: input.accountFingerprint,
    installationId: input.installationId,
    manifest: {
      ...input.manifest,
      observedAt: new Date(input.manifest.observedAt).toISOString(),
      capturedAt: new Date(input.manifest.capturedAt).toISOString(),
    },
    chunks: [...input.chunks].sort((left, right) => left.sequence - right.sequence),
  })
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-capture-payload')
  return value as Record<string, unknown>
}

function boundedText(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new Error('invalid-capture-payload')
  }
  return value
}

function position(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('invalid-capture-payload')
  return value as number
}

export function parseCapturePayload(value: string): ConnectorCapturePayload {
  const root = record(JSON.parse(value) as unknown)
  if (!Array.isArray(root.lists) || root.lists.length > 100 || Object.keys(root).length !== 1) {
    throw new Error('invalid-capture-payload')
  }
  return {
    lists: root.lists.map((entry) => {
      const list = record(entry)
      if (!Array.isArray(list.items) || list.items.length > 1_000) throw new Error('invalid-capture-payload')
      return {
        sourceListId: boundedText(list.sourceListId, 512)!,
        observedName: boundedText(list.observedName, 200)!, sourcePosition: position(list.sourcePosition),
        items: list.items.map((entryItem) => {
          const item = record(entryItem)
          const location = item.observedLocation === null ? null : record(item.observedLocation)
          const latitude = location === null ? null : location.latitude
          const longitude = location === null ? null : location.longitude
          if (location !== null && (
            typeof latitude !== 'number' || latitude < -90 || latitude > 90 ||
            typeof longitude !== 'number' || longitude < -180 || longitude > 180
          )) throw new Error('invalid-capture-payload')
          return {
            sourceItemId: boundedText(item.sourceItemId, 512)!,
            providerPlaceId: boundedText(item.providerPlaceId, 512, true),
            observedName: boundedText(item.observedName, 300)!,
            observedAddress: boundedText(item.observedAddress, 500, true),
            observedCategory: boundedText(item.observedCategory, 300, true),
            observedLocation: location === null ? null : {
              latitude: latitude as number, longitude: longitude as number,
            },
            sourcePosition: position(item.sourcePosition),
          }
        }),
      }
    }),
  }
}
