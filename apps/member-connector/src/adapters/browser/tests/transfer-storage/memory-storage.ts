import type {
  WebExtensionStorageArea,
} from '../../webextensions/transfer-storage/index.js'

export class MemoryWebExtensionStorage implements WebExtensionStorageArea {
  private readonly values = new Map<string, unknown>()

  async get(keys: null | string | readonly string[] = null) {
    const selected = keys === null
      ? [...this.values.keys()]
      : typeof keys === 'string' ? [keys] : [...keys]
    return Object.fromEntries(selected.flatMap((key) => this.values.has(key)
      ? [[key, structuredClone(this.values.get(key))]]
      : []))
  }

  async set(items: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(items)) this.values.set(key, structuredClone(value))
  }

  async remove(keys: string | readonly string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key)
  }

  dump(): Readonly<Record<string, unknown>> {
    return Object.fromEntries([...this.values].map(([key, value]) => [key, structuredClone(value)]))
  }

  clear(): void { this.values.clear() }

  corrupt(match: (key: string) => boolean): void {
    const key = [...this.values.keys()].find(match)
    if (key === undefined) throw new Error('test storage key not found')
    const value = structuredClone(this.values.get(key)) as Record<string, unknown>
    const ciphertext = String(value.ciphertext)
    value.ciphertext = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
    this.values.set(key, value)
  }
}

export async function nonExtractableAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  ) as Promise<CryptoKey>
}
