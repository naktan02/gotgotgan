import {
  outboundExecutionGrantV2Schema,
  type OutboundExecutionGrantV2,
} from '@place/contracts/transfers'
import { z } from 'zod'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const providerKeySchema = z.enum(['naver', 'kakao', 'google'])

export const connectorExportGrantSchema = outboundExecutionGrantV2Schema

const exportGrantUseSchema = z.object({
  operationId: z.uuid(),
  transferId: z.uuid(),
  connectionId: z.uuid(),
  providerKey: providerKeySchema,
  accountFingerprint: sha256Schema,
  installationId: z.uuid(),
  operation: z.literal('export-saved-library'),
  planDigest: sha256Schema,
  sourceOrigin: z.url(),
  itemCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
  batchCount: z.number().int().min(1),
  now: z.iso.datetime({ offset: true }),
}).strict()

export type ConnectorExportGrant = OutboundExecutionGrantV2
export type ConnectorExportGrantUse = z.infer<typeof exportGrantUseSchema>

export type ConnectorExportGrantValidation =
  | Readonly<{ status: 'claims-valid'; grant: ConnectorExportGrant }>
  | Readonly<{
      status: 'claims-invalid'
      reason: 'invalid-grant' | 'binding-mismatch' | 'not-yet-valid' | 'expired' | 'limit-exceeded'
    }>

/**
 * Validates only the stateless envelope shape and exact claims binding. This is not authorization:
 * the Backend must consume the one-time token digest and return an approval receipt before any
 * SavedPlaceTarget mutation is invoked.
 */
export function validateConnectorExportGrantClaims(input: Readonly<{
  grant: unknown
  use: unknown
}>): ConnectorExportGrantValidation {
  const grant = connectorExportGrantSchema.safeParse(input.grant)
  const use = exportGrantUseSchema.safeParse(input.use)
  if (!grant.success || !use.success) return { status: 'claims-invalid', reason: 'invalid-grant' }

  if (
    grant.data.operationId !== use.data.operationId ||
    grant.data.transferId !== use.data.transferId ||
    grant.data.connectionId !== use.data.connectionId ||
    grant.data.providerKey !== use.data.providerKey ||
    grant.data.accountFingerprint !== use.data.accountFingerprint ||
    grant.data.installationId !== use.data.installationId ||
    grant.data.operation !== use.data.operation ||
    grant.data.planDigest !== use.data.planDigest ||
    grant.data.placeOrigin !== use.data.sourceOrigin
  ) return { status: 'claims-invalid', reason: 'binding-mismatch' }

  const now = Date.parse(use.data.now)
  if (now < Date.parse(grant.data.issuedAt)) {
    return { status: 'claims-invalid', reason: 'not-yet-valid' }
  }
  if (now >= Date.parse(grant.data.expiresAt)) {
    return { status: 'claims-invalid', reason: 'expired' }
  }
  if (
    use.data.itemCount > grant.data.limits.maximumItems ||
    use.data.byteCount > grant.data.limits.maximumBytes ||
    use.data.batchCount > grant.data.limits.maximumBatches
  ) return { status: 'claims-invalid', reason: 'limit-exceeded' }

  return { status: 'claims-valid', grant: grant.data }
}
