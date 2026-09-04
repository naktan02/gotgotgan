import { z } from 'zod'

export const revisionSchema = z.string().min(1).max(512)
export const cursorSchema = z.string().min(1).max(2_048)
export const labelSchema = z.string().trim().min(1).max(120)
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
export const accountFingerprintSchema = sha256Schema

export const sourceAcquisitionKindSchema = z.enum([
  'documented-api',
  'account-export',
  'structured-web',
  'browser-network',
  'browser-dom',
  'manual-capture',
])

export const sourceSnapshotProvenanceV2Schema = z.object({
  acquisitionKind: sourceAcquisitionKindSchema,
  parserVersion: z.string().min(1).max(120),
}).strict()

export type SourceAcquisitionKind = z.infer<typeof sourceAcquisitionKindSchema>
export type SourceSnapshotProvenanceV2 = z.infer<typeof sourceSnapshotProvenanceV2Schema>
export const opaqueConnectorTokenSchema = z.string().min(32).max(8_192).regex(/^[A-Za-z0-9._~-]+$/)
export const exactPublicOriginSchema = z.url().superRefine((value, context) => {
  const url = new URL(value)
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname)
  if (
    value !== url.origin || url.username !== '' || url.password !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) context.addIssue({ code: 'custom', message: 'origin must be exact HTTPS or loopback HTTP' })
})

export const transferCommandRejectionCodeV2Schema = z.enum([
  'not-found',
  'command-id-reused',
  'revision-conflict',
  'snapshot-changed',
  'collection-changed',
  'target-observation-changed',
  'invalid-selection',
  'connection-not-ready',
  'target-unavailable',
  'not-approvable',
])

export const transferCommandRejectionSchema = z.object({
  code: transferCommandRejectionCodeV2Schema,
}).strict()

export type TransferCommandRejectionCodeV2 = z.infer<typeof transferCommandRejectionCodeV2Schema>
