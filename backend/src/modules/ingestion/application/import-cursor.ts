import {
  InvalidImportCursorError,
  type ImportBatchStateFilter,
} from '../domain/import-queries.js'

type BatchCursor = Readonly<{ createdAt: string; batchId: string }>
type ItemCursor = Readonly<{
  sourceListPosition: number
  sourcePosition: number
  itemId: string
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function read(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error()
    return payload as Record<string, unknown>
  } catch {
    throw new InvalidImportCursorError('Import cursor is invalid.')
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function validPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function encode(payload: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeImportBatchCursor(
  value: string | undefined,
  state: ImportBatchStateFilter,
): BatchCursor | undefined {
  const payload = read(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'import-batches' || payload.state !== state ||
    !validTimestamp(payload.createdAt) || !validUuid(payload.batchId)
  ) throw new InvalidImportCursorError('Import batch cursor is invalid.')
  return { createdAt: payload.createdAt, batchId: payload.batchId }
}

export function encodeImportBatchCursor(
  state: ImportBatchStateFilter,
  cursor: BatchCursor,
): string {
  return encode({ v: 1, kind: 'import-batches', state, ...cursor })
}

export function decodeImportItemCursor(
  value: string | undefined,
  batchId: string,
): ItemCursor | undefined {
  const payload = read(value)
  if (payload === undefined) return undefined
  if (
    payload.v !== 1 || payload.kind !== 'import-items' || payload.batchId !== batchId ||
    !validPosition(payload.sourceListPosition) || !validPosition(payload.sourcePosition) ||
    !validUuid(payload.itemId)
  ) throw new InvalidImportCursorError('Import item cursor is invalid.')
  return {
    sourceListPosition: payload.sourceListPosition,
    sourcePosition: payload.sourcePosition,
    itemId: payload.itemId,
  }
}

export function encodeImportItemCursor(batchId: string, cursor: ItemCursor): string {
  return encode({ v: 1, kind: 'import-items', batchId, ...cursor })
}
