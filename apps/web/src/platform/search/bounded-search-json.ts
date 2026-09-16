export const CATALOG_SEARCH_REQUEST_MAX_BYTES = 32 * 1_024
export const CATALOG_SEARCH_RESPONSE_MAX_BYTES = 1_024 * 1_024
export const CATALOG_MAP_REQUEST_MAX_BYTES = 32 * 1_024
export const CATALOG_MAP_RESPONSE_MAX_BYTES = 1_024 * 1_024

export class BoundedSearchJsonError extends Error {
  override readonly name = 'BoundedSearchJsonError'
}

type JsonMessage = Readonly<{
  body: ReadableStream<Uint8Array> | null
  headers: Headers
}>

function supportedContentType(value: string | null): boolean {
  if (value === null) return false
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType === 'application/problem+json'
}

async function rejectBody(message: JsonMessage, reason: string): Promise<never> {
  try {
    await message.body?.cancel(reason)
  } catch {}
  throw new BoundedSearchJsonError(reason)
}

export async function readBoundedSearchJson(
  message: JsonMessage,
  maximumBytes: number,
): Promise<unknown> {
  if (!supportedContentType(message.headers.get('content-type'))) {
    return rejectBody(message, 'Search JSON content type is unsupported')
  }
  const contentEncoding = message.headers.get('content-encoding')
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
    return rejectBody(message, 'Compressed Search JSON is unsupported')
  }
  const contentLength = message.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes) {
      return rejectBody(message, 'Search JSON content length exceeds its limit')
    }
  }
  if (message.body === null) throw new BoundedSearchJsonError('Search JSON body is required')

  const reader = message.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maximumBytes) {
        await reader.cancel('Search JSON body exceeds its limit')
        throw new BoundedSearchJsonError('Search JSON body exceeds its limit')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error) {
    try {
      await reader.cancel('Search JSON body is invalid')
    } catch {}
    if (error instanceof BoundedSearchJsonError) throw error
    throw new BoundedSearchJsonError('Search JSON body is invalid')
  } finally {
    reader.releaseLock()
  }
}
