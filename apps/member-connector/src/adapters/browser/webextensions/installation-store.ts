type LocalStorageLike = Readonly<{
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}>

const installationKey = 'placeConnectorInstallationId'

export class WebExtensionInstallationStore {
  constructor(
    private readonly storage: LocalStorageLike,
    private readonly nextId: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  async getOrCreate(): Promise<string> {
    const stored = (await this.storage.get(installationKey))[installationKey]
    if (typeof stored === 'string' && stored.length > 0) return stored
    const installationId = this.nextId()
    await this.storage.set({ [installationKey]: installationId })
    return installationId
  }
}
