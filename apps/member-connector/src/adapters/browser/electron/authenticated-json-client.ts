import {
  AuthenticatedJsonClientError,
  type AuthenticatedJsonClient,
} from '../../../application/ports/authenticated-json-client.js'

export class ElectronAuthenticatedJsonClient implements AuthenticatedJsonClient {
  private receivedBytes = 0
  private requestCount = 0

  constructor(
    private readonly fetchInSession: (url: string, init: RequestInit) => Promise<Response>,
    private readonly allowsRequest: (url: URL) => boolean,
    private readonly timeoutMilliseconds = 15_000,
    private readonly maximumTotalBytes = 64 * 1_048_576,
  ) {
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 30_000) {
      throw new Error('Invalid request timeout.')
    }
    if (!Number.isInteger(maximumTotalBytes) || maximumTotalBytes < 1 || maximumTotalBytes > 64 * 1_048_576) {
      throw new Error('Invalid collection byte limit.')
    }
  }

  async get(input: Parameters<AuthenticatedJsonClient['get']>[0]) {
    if (!this.allowsRequest(input.url)) {
      throw new AuthenticatedJsonClientError('permission-denied', 'Provider endpoint is not allowed.')
    }
    if (!Number.isInteger(input.maximumBytes) || input.maximumBytes < 1 || input.maximumBytes > 4_194_304) {
      throw new AuthenticatedJsonClientError('response-too-large', 'Invalid response limit.')
    }
    if (++this.requestCount > 2_500 || this.receivedBytes >= this.maximumTotalBytes) {
      throw new AuthenticatedJsonClientError('response-too-large', 'Collection resource limit exceeded.')
    }
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const abort = () => {
      controller.abort()
      void reader?.cancel().catch(() => undefined)
    }
    input.signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, this.timeoutMilliseconds)
    try {
      input.signal.throwIfAborted()
      const response = await this.fetchInSession(input.url.href, {
        method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store',
        headers: { accept: 'application/json' }, signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.toLowerCase().includes('json')) {
        await response.body?.cancel()
        return { status: response.status, contentType, body: new Uint8Array() }
      }
      if (Number(response.headers.get('content-length')) > input.maximumBytes) {
        await response.body?.cancel()
        throw new AuthenticatedJsonClientError('response-too-large', 'Provider response exceeds limit.')
      }
      reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      while (reader !== undefined) {
        controller.signal.throwIfAborted()
        const result = await reader.read()
        if (result.done) break
        length += result.value.byteLength
        this.receivedBytes += result.value.byteLength
        if (length > input.maximumBytes || this.receivedBytes > this.maximumTotalBytes) {
          throw new AuthenticatedJsonClientError('response-too-large', 'Provider response exceeds limit.')
        }
        chunks.push(result.value)
      }
      controller.signal.throwIfAborted()
      const body = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      return { status: response.status, contentType, body }
    } catch (error) {
      if (error instanceof AuthenticatedJsonClientError) throw error
      throw new AuthenticatedJsonClientError('transport-unavailable', 'Provider request was interrupted or unavailable.')
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener('abort', abort)
      await reader?.cancel().catch(() => undefined)
      controller.abort()
    }
  }
}
