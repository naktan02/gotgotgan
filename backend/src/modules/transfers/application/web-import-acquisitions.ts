import { createHash, randomUUID } from 'node:crypto'

import type {
  ImportAcquisitionCommandResultV1,
  ImportAcquisitionCommandV1,
  ImportAcquisitionV1,
  StartImportAcquisitionV1,
} from '@place/contracts/transfers'

import { transferFingerprint } from './identity.js'
import type {
  WebImportAcquisitionStore,
  WebImportArtifactStore,
} from './ports/web-import-acquisition.js'
import type { ImportAcquisitions } from '../domain/acquisitions.js'

type Options = Readonly<{
  store: WebImportAcquisitionStore
  artifacts: WebImportArtifactStore
  artifactRetentionMilliseconds: number
  remoteBrowserEnabled?: boolean
  nextArtifactId?: () => string
  now?: () => Date
}>

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function requestFingerprint(command: StartImportAcquisitionV1): string {
  return transferFingerprint(command.kind === 'shared-links' ? {
    schemaVersion: command.schemaVersion,
    kind: command.kind,
    commandId: command.commandId,
    acquisitionId: command.acquisitionId,
    importSourceId: command.importSourceId,
    snapshotId: command.snapshotId,
    providerKey: command.providerKey,
    links: command.links.map((link) => ({
      entryId: link.entryId,
      position: link.position,
      inputDigest: sha256(link.url.trim()),
    })),
  } : command)
}

/**
 * Member-facing one-shot acquisition module. It stages sensitive link input and durably
 * enqueues work; provider I/O belongs exclusively to the acquisition worker.
 */
export class WebImportAcquisitions implements ImportAcquisitions {
  private readonly now: () => Date
  private readonly nextArtifactId: () => string

  constructor(private readonly options: Options) {
    if (!Number.isInteger(options.artifactRetentionMilliseconds) ||
      options.artifactRetentionMilliseconds < 60_000 ||
      options.artifactRetentionMilliseconds > 900_000) {
      throw new Error('web import artifact retention is invalid')
    }
    this.now = options.now ?? (() => new Date())
    this.nextArtifactId = options.nextArtifactId ?? randomUUID
  }

  async start(
    memberId: string,
    command: StartImportAcquisitionV1,
  ): Promise<ImportAcquisitionCommandResultV1> {
    const startedAt = this.now()
    const fingerprint = requestFingerprint(command)
    if (command.kind === 'remote-browser') {
      if (this.options.remoteBrowserEnabled !== true) {
        throw new Error('remote browser acquisition is disabled')
      }
      const reservation = await this.options.store.reserve({
        memberId,
        command,
        requestFingerprint: fingerprint,
        inputDigests: [],
        startedAt: startedAt.toISOString(),
      })
      if (reservation.status !== 'complete') throw new Error('remote acquisition was reserved')
      return reservation.result
    }

    const body = new TextEncoder().encode(JSON.stringify(command))
    const artifactId = this.nextArtifactId()
    const retainedUntil = new Date(
      startedAt.getTime() + this.options.artifactRetentionMilliseconds,
    ).toISOString()
    const artifact = {
      artifactId,
      reference: this.options.artifacts.reference(artifactId),
      checksum: sha256(body),
      retainedUntil,
    }
    const reservation = await this.options.store.reserve({
      memberId,
      command: {
        ...command,
        links: command.links.map(({ entryId, position }) => ({ entryId, position })),
      },
      requestFingerprint: fingerprint,
      inputDigests: command.links.map((link) => sha256(link.url.trim())),
      artifact,
      startedAt: startedAt.toISOString(),
    })
    if (reservation.status === 'complete') return reservation.result
    const binding = {
      reference: reservation.artifact.reference,
      batchId: command.acquisitionId,
      providerKey: command.providerKey,
    } as const
    await this.options.artifacts.put({
      artifactId: reservation.artifact.artifactId,
      batchId: command.acquisitionId,
      providerKey: command.providerKey,
      body,
      checksum: reservation.artifact.checksum,
      contentType: 'application/json',
      retentionUntil: reservation.artifact.retainedUntil,
    })
    const activation = await this.options.store.activate({
      memberId,
      commandId: command.commandId,
      acquisitionId: command.acquisitionId,
      activatedAt: this.now().toISOString(),
    })
    if (!activation.artifactRequired) {
      await this.options.artifacts.discard(binding)
      await this.options.store.markArtifactDeleted(
        command.acquisitionId, this.now().toISOString(),
      )
    }
    return activation.result
  }

  get(memberId: string, acquisitionId: string): Promise<ImportAcquisitionV1 | undefined> {
    return this.options.store.get(memberId, acquisitionId)
  }

  async applyCommand(
    memberId: string,
    command: ImportAcquisitionCommandV1,
  ): Promise<ImportAcquisitionCommandResultV1> {
    const cancelledAt = this.now().toISOString()
    const outcome = await this.options.store.cancel({
      memberId,
      command,
      commandFingerprint: transferFingerprint(command),
      cancelledAt,
    })
    if (outcome.artifact !== undefined) {
      await this.options.artifacts.discard({
        reference: outcome.artifact.reference,
        batchId: outcome.artifact.acquisitionId,
        providerKey: outcome.artifact.providerKey,
      })
      await this.options.store.markArtifactDeleted(outcome.artifact.acquisitionId, cancelledAt)
    }
    return outcome.result
  }
}
