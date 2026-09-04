export function requireNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}
