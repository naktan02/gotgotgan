import {
  outboundExecutionAuthorizationReceiptV2Schema,
  outboundExecutionConsumeRequestV2Schema,
  outboundExecutionGrantV2Schema,
  outboundExecutionPlanDigestInputV2,
  type OutboundExecutionAttemptV2,
  type OutboundExecutionAuthorizationReceiptV2,
  type OutboundExecutionConsumeRequestV2,
  type OutboundExecutionGrantV2,
  type OutboundExecutionManifestV2,
} from '@place/contracts/transfers'

import {
  validateConnectorExportGrantClaims,
  type ConnectorExportGrantUse,
} from './grant.js'
import type {
  SavedPlaceTargetAuthorizationReceipt,
  SavedPlaceTargetBoundary,
  SavedPlaceTargetCapabilities,
  SavedPlaceTargetCreateResult,
  SavedPlaceTargetAddResult,
} from './ports/saved-place-target.js'
import type {
  OutboundReconciliationAuthorizationVault,
} from './ports/reconciliation-authorization-vault.js'

export type ApprovedExportBinding = Readonly<{
  operationId: string
  transferId: string
  connectionId: string
  providerKey: 'naver' | 'kakao' | 'google'
  accountFingerprint: string
  installationId: string
  planDigest: string
  sourceOrigin: string
}>

export type ApprovedExportPlan = Readonly<{
  requestFingerprint: string
}>

export type PreparedApprovedExport = Readonly<{
  grant: OutboundExecutionGrantV2
  binding: ApprovedExportBinding
  plan: ApprovedExportPlan
  consumeRequest: OutboundExecutionConsumeRequestV2
  batchSize: number
  batchCount: number
}>

export type AuthorizedApprovedExport = Readonly<{
  prepared: PreparedApprovedExport
  authorization: OutboundExecutionAuthorizationReceiptV2
}>

export class ApprovedExportCoordinationError extends Error {
  constructor(
    readonly code:
      | 'adapter-unavailable'
      | 'binding-mismatch'
      | 'grant-invalid'
      | 'grant-expired'
      | 'limit-exceeded'
      | 'authorization-invalid'
      | 'authorization-not-sealed'
      | 'attempt-not-sealed'
      | 'attempt-not-prepared'
      | 'attempt-not-reported'
      | 'reconciliation-not-recorded'
      | 'provider-result-invalid',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovedExportCoordinationError'
  }
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(String(value)).byteLength
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}

function digestInput(manifest: OutboundExecutionManifestV2): string {
  const { schemaVersion: _, planDigest: __, ...committed } = manifest
  return outboundExecutionPlanDigestInputV2(committed)
}

function availableBatchSize(
  capabilities: SavedPlaceTargetCapabilities,
  providerKey: ApprovedExportBinding['providerKey'],
  needsCreate: boolean,
): number {
  const required = [
    'preflight-add', 'add-places', 'reconcile-add',
    ...(needsCreate ? ['create-target-list', 'reconcile-create-target-list'] as const : []),
  ] as const
  if (
    capabilities.providerKey !== providerKey ||
    capabilities.deliveryState !== 'available' ||
    capabilities.maximumAddItems === null ||
    capabilities.maximumAddItems < 1 ||
    required.some((capability) => capabilities.capabilities[capability] !== 'available')
  ) throw new ApprovedExportCoordinationError(
    'adapter-unavailable', 'No verified Provider write Adapter is available',
  )
  return Math.min(capabilities.maximumAddItems, 500)
}

function sameLimits(
  left: OutboundExecutionAuthorizationReceiptV2['limits'],
  right: OutboundExecutionGrantV2['limits'],
): boolean {
  return left.maximumItems === right.maximumItems &&
    left.maximumBytes === right.maximumBytes &&
    left.maximumBatches === right.maximumBatches
}

export function providerAuthorization(
  receipt: OutboundExecutionAuthorizationReceiptV2,
): SavedPlaceTargetAuthorizationReceipt {
  const { receiptToken: _, ...proof } = receipt
  return proof
}

export function isProviderBoundary(
  result: SavedPlaceTargetCreateResult | SavedPlaceTargetAddResult,
): result is SavedPlaceTargetBoundary {
  return result.status === 'action-required' || result.status === 'rate-limited' ||
    result.status === 'unsupported' || result.status === 'provider-unavailable' ||
    result.status === 'provider-drift' || result.status === 'cancelled'
}

export function providerProblem(
  result: SavedPlaceTargetBoundary,
): NonNullable<OutboundExecutionAttemptV2['problem']> {
  if (result.status === 'action-required') return {
    code: result.reason, retryable: false, actionRequired: result.reason,
  }
  if (result.status === 'rate-limited') return {
    code: 'rate-limited', retryable: true, actionRequired: null,
  }
  if (result.status === 'unsupported') return {
    code: `unsupported-${result.capability}`, retryable: false, actionRequired: null,
  }
  if (result.status === 'provider-unavailable') return {
    code: 'provider-unavailable', retryable: result.retryable, actionRequired: null,
  }
  return { code: result.status, retryable: false, actionRequired: null }
}

export function requireBefore(expiresAt: string, now: string, message: string): void {
  const instant = Date.parse(now)
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(instant) || !Number.isFinite(expiry) || expiry <= instant) {
    throw new ApprovedExportCoordinationError('grant-expired', message)
  }
}

/** Validates an exact approved plan and creates the token-free consume request. */
export async function prepareApprovedExport(
  input: Readonly<{
    grant: unknown
    binding: ApprovedExportBinding
    plan: ApprovedExportPlan
    capabilities: SavedPlaceTargetCapabilities
    now: string
  }>,
): Promise<PreparedApprovedExport> {
  const grant = outboundExecutionGrantV2Schema.safeParse(input.grant)
  if (!grant.success) {
    throw new ApprovedExportCoordinationError('grant-invalid', 'Export grant is invalid')
  }
  const manifest = grant.data.manifest
  const itemsToAdd = manifest.items.filter((item) => item.action === 'add')
  if (itemsToAdd.length === 0) {
    throw new ApprovedExportCoordinationError(
      'provider-result-invalid', 'Approved plan has no Provider mutations',
    )
  }
  const itemKeys = manifest.items.map((item) => item.itemKey)
  const sourcePositions = manifest.items.map((item) => item.sourcePosition)
  if (
    !/^[a-f0-9]{64}$/.test(input.plan.requestFingerprint) ||
    new Set(itemKeys).size !== itemKeys.length ||
    new Set(sourcePositions).size !== sourcePositions.length ||
    sourcePositions.some((position, index) => (
      index > 0 && position <= sourcePositions[index - 1]!
    )) ||
    manifest.operationId !== input.binding.operationId ||
    manifest.transferId !== input.binding.transferId ||
    manifest.connectionId !== input.binding.connectionId ||
    manifest.providerKey !== input.binding.providerKey ||
    manifest.accountFingerprint !== input.binding.accountFingerprint ||
    manifest.planDigest !== input.binding.planDigest ||
    grant.data.planDigest !== manifest.planDigest ||
    await sha256(digestInput(manifest)) !== manifest.planDigest
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Approved export plan is invalid',
  )
  const batchSize = availableBatchSize(
    input.capabilities, input.binding.providerKey, manifest.target.kind === 'new-list',
  )
  const batchCount = Math.ceil(itemsToAdd.length / batchSize)
  const canonicalManifest = digestInput(manifest)
  const use: ConnectorExportGrantUse = {
    ...input.binding,
    operation: 'export-saved-library',
    itemCount: itemsToAdd.length,
    byteCount: byteLength(canonicalManifest),
    batchCount,
    now: input.now,
  }
  const validation = validateConnectorExportGrantClaims({ grant: grant.data, use })
  if (validation.status === 'claims-invalid') {
    const code = validation.reason === 'limit-exceeded' ? 'limit-exceeded'
      : validation.reason === 'expired' || validation.reason === 'not-yet-valid'
        ? 'grant-expired' : 'binding-mismatch'
    throw new ApprovedExportCoordinationError(code, 'Export grant claims differ from the approved plan')
  }
  const consumeRequest = outboundExecutionConsumeRequestV2Schema.parse({
    schemaVersion: 'outbound-execution-consume-request.v2',
    grantId: grant.data.grantId,
    operationId: grant.data.operationId,
    connectionId: grant.data.connectionId,
    providerKey: grant.data.providerKey,
    accountFingerprint: grant.data.accountFingerprint,
    installationId: grant.data.installationId,
    planDigest: grant.data.planDigest,
    sourceOrigin: input.binding.sourceOrigin,
    itemCount: use.itemCount,
    byteCount: use.byteCount,
    batchCount,
    batchSize,
  })
  return {
    grant: grant.data, binding: input.binding, plan: input.plan,
    consumeRequest, batchSize, batchCount,
  }
}

function validateAuthorizationBinding(
  prepared: PreparedApprovedExport,
  candidate: unknown,
): OutboundExecutionAuthorizationReceiptV2 {
  const parsed = outboundExecutionAuthorizationReceiptV2Schema.safeParse(candidate)
  if (!parsed.success) {
    throw new ApprovedExportCoordinationError('authorization-invalid', 'Authorization receipt is invalid')
  }
  const receipt = parsed.data
  const grant = prepared.grant
  if (
    receipt.grantId !== grant.grantId ||
    receipt.operationId !== grant.operationId ||
    receipt.transferId !== grant.transferId ||
    receipt.connectionId !== grant.connectionId ||
    receipt.providerKey !== grant.providerKey ||
    receipt.accountFingerprint !== grant.accountFingerprint ||
    receipt.installationId !== grant.installationId ||
    receipt.planDigest !== grant.planDigest ||
    receipt.batchSize !== prepared.batchSize ||
    !sameLimits(receipt.limits, grant.limits)
  ) throw new ApprovedExportCoordinationError(
    'binding-mismatch', 'Authorization receipt differs from the approved plan',
  )
  return receipt
}

/** Persists authorization before any Provider mutation can be assembled. */
export async function authorizeApprovedExport(
  prepared: PreparedApprovedExport,
  candidate: unknown,
  now: string,
  vault: OutboundReconciliationAuthorizationVault,
): Promise<AuthorizedApprovedExport> {
  const receipt = validateAuthorizationBinding(prepared, candidate)
  const instant = Date.parse(now)
  if (!Number.isFinite(instant) || Date.parse(receipt.authorizedAt) > instant) {
    throw new ApprovedExportCoordinationError('grant-expired', 'Authorization receipt is not active')
  }
  requireBefore(receipt.expiresAt, now, 'Authorization receipt is not active')
  const sealed = await vault.seal(receipt)
  if (sealed === 'conflict') {
    throw new ApprovedExportCoordinationError(
      'authorization-not-sealed', 'Authorization conflicts with secure local persistence',
    )
  }
  return { prepared, authorization: receipt }
}

/** Rebuilds only the authority needed to report or reconcile an unknown outcome. */
export async function rehydrateReconciliationAuthorization(input: Readonly<{
  prepared: PreparedApprovedExport
  receiptReference: string
  now: string
  vault: OutboundReconciliationAuthorizationVault
}>): Promise<AuthorizedApprovedExport> {
  const candidate = await input.vault.load(input.receiptReference)
  if (candidate === null) {
    throw new ApprovedExportCoordinationError(
      'authorization-not-sealed', 'Reconciliation authorization is unavailable',
    )
  }
  const receipt = validateAuthorizationBinding(input.prepared, candidate)
  if (receipt.receiptReference !== input.receiptReference) {
    throw new ApprovedExportCoordinationError(
      'binding-mismatch', 'Reconciliation authorization reference differs',
    )
  }
  const instant = Date.parse(input.now)
  if (!Number.isFinite(instant) || Date.parse(receipt.authorizedAt) > instant) {
    throw new ApprovedExportCoordinationError(
      'grant-expired', 'Reconciliation authorization is not active',
    )
  }
  requireBefore(
    receipt.reconciliationExpiresAt,
    input.now,
    'Reconciliation authorization expired',
  )
  return { prepared: input.prepared, authorization: receipt }
}
