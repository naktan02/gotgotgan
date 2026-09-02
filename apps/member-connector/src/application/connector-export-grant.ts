import { connectorPublicOriginSchema } from '@place/contracts/connector'
import { z } from 'zod'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const opaqueGrantTokenSchema = z.string().min(32).max(8_192).regex(/^[A-Za-z0-9._~-]+$/)
const providerKeySchema = z.enum(['naver', 'kakao', 'google'])

export const connectorExportGrantSchema = z.object({
  schemaVersion: z.literal('place-connector-export-grant.v1'),
  operationId: z.uuid(),
  providerKey: providerKeySchema,
  operation: z.literal('export-saved-library'),
  planDigest: sha256Schema,
  token: opaqueGrantTokenSchema,
  placeOrigin: connectorPublicOriginSchema,
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  limits: z.object({
    maximumItems: z.number().int().min(1).max(100_000),
    maximumBytes: z.number().int().min(1_024).max(134_217_728),
    maximumBatches: z.number().int().min(1).max(1_000),
  }).strict(),
}).strict().superRefine((grant, context) => {
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Export grant expiry must follow issuance.',
    })
  }
})

const exportGrantUseSchema = z.object({
  operationId: z.uuid(),
  providerKey: providerKeySchema,
  operation: z.literal('export-saved-library'),
  planDigest: sha256Schema,
  sourceOrigin: connectorPublicOriginSchema,
  itemCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
  batchCount: z.number().int().nonnegative(),
  now: z.iso.datetime({ offset: true }),
}).strict()

export type ConnectorExportGrant = z.infer<typeof connectorExportGrantSchema>
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
    grant.data.providerKey !== use.data.providerKey ||
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
