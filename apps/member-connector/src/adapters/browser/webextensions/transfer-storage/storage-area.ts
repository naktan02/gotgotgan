export type StorageRecord = Readonly<Record<string, unknown>>

/** Minimal WebExtensions storage surface used by the transfer persistence adapters. */
export interface WebExtensionStorageArea {
  get(keys?: null | string | readonly string[]): Promise<StorageRecord>
  set(items: Readonly<Record<string, unknown>>): Promise<void>
  remove(keys: string | readonly string[]): Promise<void>
}

export async function readStoredValue(
  storage: WebExtensionStorageArea,
  key: string,
): Promise<unknown | undefined> {
  const values = await storage.get(key)
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
}
