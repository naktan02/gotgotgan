import type { CaptureArtifactReplayStore } from './ports/capture-artifact-store.js'
import type { ImportCaptureRetentionStore } from './ports/import-capture-retention-store.js'

export async function sweepExpiredImportCaptures(input: Readonly<{
  expiredAt: string
  limit: number
  retention: ImportCaptureRetentionStore
  artifacts: CaptureArtifactReplayStore
}>): Promise<Readonly<{
  examined: number
  deleted: number
  missing: number
  failed: number
}>> {
  if (
    Number.isNaN(Date.parse(input.expiredAt)) ||
    !Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 1_000
  ) throw new Error('Capture sweep input is invalid')

  const expired = await input.retention.findExpired({
    expiredAt: input.expiredAt,
    limit: input.limit,
  })
  let deleted = 0
  let missing = 0
  let failed = 0
  for (const capture of expired) {
    try {
      const outcome = await input.artifacts.delete({
        reference: capture.artifactReference,
        batchId: capture.batchId,
        providerKey: capture.providerKey,
      })
      await input.retention.markDeleted({
        captureId: capture.captureId,
        deletedAt: input.expiredAt,
      })
      if (outcome === 'deleted') deleted += 1
      else missing += 1
    } catch {
      failed += 1
    }
  }
  return { examined: expired.length, deleted, missing, failed }
}
