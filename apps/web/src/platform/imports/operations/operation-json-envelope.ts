type OperationJsonBody = Request | Response

export const operationJsonByteLimits = Object.freeze({
  commandRequest: 4 * 1_024,
  commandResponse: 16 * 1_024,
  detailResponse: 16 * 1_024,
  listResponse: 256 * 1_024,
  itemsResponse: 512 * 1_024,
  summaryResponse: 32 * 1_024,
})

export type OperationJsonReadResult =
  | Readonly<{ status: 'ok'; value: unknown }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'too-large' }>

function declaredLength(headers: Headers): number | undefined | 'invalid' {
  const value = headers.get('content-length')
  if (value === null) return undefined
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return 'invalid'
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 'invalid'
}

function hasJsonEnvelope(headers: Headers): boolean {
  const mediaType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType === 'application/problem+json'
}

async function release(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch { /* best-effort stream release */ }
}

function wasAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/** Reads operation control JSON without trusting Content-Length or unbounded buffering. */
export async function readOperationJson(
  body: OperationJsonBody,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<OperationJsonReadResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Operation JSON byte limit is invalid')
  }
  if (!hasJsonEnvelope(body.headers)) return { status: 'invalid' }
  const encoding = body.headers.get('content-encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') return { status: 'invalid' }
  const length = declaredLength(body.headers)
  if (length === 'invalid') return { status: 'invalid' }
  if (length !== undefined && length > maximumBytes) return { status: 'too-large' }
  if (body.body === null) return { status: 'invalid' }

  const reader = body.body.getReader()
  if (wasAborted(signal)) {
    await release(reader)
    return { status: 'invalid' }
  }
  const abort = () => { void release(reader) }
  signal?.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximumBytes) {
        await release(reader)
        return { status: 'too-large' }
      }
      chunks.push(next.value)
    }
  } catch {
    await release(reader)
    return { status: 'invalid' }
  } finally {
    signal?.removeEventListener('abort', abort)
  }

  if (wasAborted(signal)) return { status: 'invalid' }
  try {
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { status: 'ok', value: JSON.parse(text) }
  } catch {
    return { status: 'invalid' }
  }
}
