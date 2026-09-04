type JsonBody = Request | Response

export type BoundedJsonResult =
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

function isJson(headers: Headers): boolean {
  const mediaType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType === 'application/problem+json'
}

async function cancel(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch { /* best-effort resource release */ }
}

/** Reads JSON without trusting Content-Length or buffering an unbounded stream. */
export async function readBoundedJson(
  body: JsonBody,
  maximumBytes: number,
): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('JSON byte limit is invalid')
  }
  if (!isJson(body.headers)) return { status: 'invalid' }
  const encoding = body.headers.get('content-encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') return { status: 'invalid' }
  const length = declaredLength(body.headers)
  if (length === 'invalid') return { status: 'invalid' }
  if (length !== undefined && length > maximumBytes) return { status: 'too-large' }
  if (body.body === null) return { status: 'invalid' }

  const chunks: Uint8Array[] = []
  const reader = body.body.getReader()
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximumBytes) {
        await cancel(reader)
        return { status: 'too-large' }
      }
      chunks.push(next.value)
    }
  } catch {
    return { status: 'invalid' }
  }

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
