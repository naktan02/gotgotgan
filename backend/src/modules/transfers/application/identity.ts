import { createHash } from 'node:crypto'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]))
  }
  return value
}

export function transferFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')
}

function opaqueVersion(kind: string, id: string, revision: string): string {
  const body = Buffer.from(JSON.stringify({ v: 1, id, revision }), 'utf8').toString('base64url')
  return `${kind}-revision.v1.${body}`
}

export function connectionVersion(id: string, revision: string): string {
  return opaqueVersion('provider-connection', id, revision)
}

export function planVersion(id: string, revision: string): string {
  return opaqueVersion('import-plan', id, revision)
}

export function outboundVersion(id: string, revision: string): string {
  return opaqueVersion('outbound-transfer', id, revision)
}

export function snapshotVersion(id: string, digest: string): string {
  return opaqueVersion('source-snapshot', id, digest)
}

export function readOpaqueRevision(kind: string, value: string, id: string): string | undefined {
  const prefix = `${kind}-revision.v1.`
  if (!value.startsWith(prefix)) return undefined
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'),
    )
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    return record.v === 1 && record.id === id && typeof record.revision === 'string'
      ? record.revision
      : undefined
  } catch {
    return undefined
  }
}

export function deterministicOperationId(...parts: readonly string[]): string {
  const bytes = Buffer.from(transferFingerprint(parts).slice(0, 32), 'hex')
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
