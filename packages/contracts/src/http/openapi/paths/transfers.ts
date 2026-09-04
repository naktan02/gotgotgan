import { bearer, browserSession, connectorGrant, described, operation, ref } from '../model.js'
import {
  boundedCursorParameter,
  boundedLimitParameter,
  connectorCapabilityOriginHeader,
  pathParameters,
  transferConnectionQueryParameter,
  transferOperationKindParameter,
  transferOperationStateParameter,
} from '../parameters.js'
const transferPaths: Readonly<Record<string, Record<string, unknown>>> = {
  '/v2/transfers/provider-capabilities': {
    get: operation('listProviderTransferCapabilitiesV2', {
      '200': described('Return truthful provider-specific transfer capabilities', 'ProviderCapabilityListV2'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v2/transfers/provider-connections': {
    get: operation('listProviderConnectionsV2', {
      '200': described('Return credential-free provider connection lifecycle projections', 'ProviderConnectionListV2'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v2/transfers/provider-connection-commands': {
    post: operation('applyProviderConnectionCommandV2', {
      '200': described('Replay a provider connection command', 'ProviderConnectionCommandResultV2'),
      '201': described('Apply a provider connection command', 'ProviderConnectionCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable connection', 'ProviderConnectionCommandResultV2'),
      '409': described('Reject a stale or reused command', 'ProviderConnectionCommandResultV2'),
      '422': described('Reject a gated provider integration', 'ProviderConnectionCommandResultV2'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'ProviderConnectionCommandRequestV2' }),
  },
  '/v2/transfers/provider-connections/{connectionId}/target-lists': {
    parameters: [pathParameters.connectionId],
    get: operation('listProviderTargetListsV2', {
      '200': described('Return target list observation or an explicit unavailable projection', 'ProviderTargetListProjectionV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v2/transfers/source-snapshots': {
    get: operation('listSourceSnapshotsV2', {
      '200': described('Return immutable saved-place source snapshot summaries', 'SourceSnapshotListV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '503': ref('responses', 'ProductUnavailable'),
    }, {
      security: bearer,
      parameters: [transferConnectionQueryParameter, boundedCursorParameter, boundedLimitParameter],
    }),
  },
  '/v2/transfers/source-snapshots/{snapshotId}': {
    parameters: [pathParameters.snapshotId],
    get: operation('getSourceSnapshotV2', {
      '200': described('Return immutable observed facts and match state', 'SourceSnapshotDetailV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v2/transfers/import-plan-commands': {
    post: operation('applyImportPlanCommandV2', {
      '200': described('Replay an import plan command', 'ImportPlanCommandResultV2'),
      '201': described('Create, decide, or explicitly approve an import plan', 'ImportPlanCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable transfer resource', 'ImportPlanCommandResultV2'),
      '409': described('Reject a stale plan, snapshot, Collection, or command', 'ImportPlanCommandResultV2'),
      '422': described('Reject an unresolved or invalid plan selection', 'ImportPlanCommandResultV2'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'ImportPlanCommandRequestV2' }),
  },
  '/v2/transfers/import-plans/{planId}': {
    parameters: [pathParameters.planId],
    get: operation('getImportPlanV2', {
      '200': described('Return an import preview and materialization outcome', 'ImportPlanV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v3/transfers/import-plan-commands': {
    post: operation('applyImportPlanCommandV3', {
      '200': described('Replay an import plan command', 'ImportPlanCommandResultV3'),
      '201': described('Create, decide, or explicitly approve an import plan',
        'ImportPlanCommandResultV3'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable transfer resource', 'ImportPlanCommandResultV3'),
      '409': described('Reject a stale plan, snapshot, Collection, or command',
        'ImportPlanCommandResultV3'),
      '422': described('Reject an unresolved or invalid plan selection',
        'ImportPlanCommandResultV3'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'ImportPlanCommandRequestV3' }),
  },
  '/v3/transfers/import-plans/{planId}': {
    parameters: [pathParameters.planId],
    get: operation('getImportPlanV3', {
      '200': described('Return an import preview and materialization outcome', 'ImportPlanV3'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
  '/v2/transfers/outbound-transfer-commands': {
    post: operation('applyOutboundTransferCommandV2', {
      '200': described('Replay an outbound preview or approval command', 'OutboundTransferCommandResultV2'),
      '201': described('Create a preview or record approval without claiming provider execution', 'OutboundTransferCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable transfer resource', 'OutboundTransferCommandResultV2'),
      '409': described('Reject changed source, target observation, or command identity', 'OutboundTransferCommandResultV2'),
      '422': described('Reject an unavailable or unresolved preview', 'OutboundTransferCommandResultV2'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer, requestSchema: 'OutboundTransferCommandRequestV2' }),
  },
  '/v2/transfers/outbound-transfers/{transferId}': {
    parameters: [pathParameters.transferId],
    get: operation('getOutboundTransferV2', {
      '200': described('Return a revision-bound outbound preview or approval state', 'OutboundTransferV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
      '503': ref('responses', 'ProductUnavailable'),
    }, { security: bearer }),
  },
}

const transferOperationPaths: Readonly<Record<string, Record<string, unknown>>> = {
  '/v2/operations': {
    get: operation('listTransferOperationsV2', {
      '200': described('Return the current member durable transfer operations', 'TransferOperationListV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
    }, {
      security: bearer,
      parameters: [
        transferOperationKindParameter, transferOperationStateParameter,
        boundedCursorParameter, boundedLimitParameter,
      ],
    }),
  },
  '/v2/operations/summary': {
    get: operation('summarizeTransferOperationsV2', {
      '200': described('Return active and attention-required transfer counts', 'TransferOperationSummaryV2'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
    }, { security: bearer }),
  },
  '/v2/operations/{operationId}': {
    parameters: [pathParameters.operationId],
    get: operation('getTransferOperationV2', {
      '200': described('Return one owned durable transfer operation', 'TransferOperationV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer }),
  },
  '/v2/operations/{operationId}/items': {
    parameters: [pathParameters.operationId],
    get: operation('listTransferOperationItemsV2', {
      '200': described('Return one bounded page of item receipts', 'TransferOperationItemPageV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': ref('responses', 'ProductNotFound'),
    }, { security: bearer, parameters: [boundedCursorParameter, boundedLimitParameter] }),
  },
  '/v2/operation-commands': {
    post: operation('applyTransferOperationCommandV2', {
      '200': described('Apply or replay an operation retry, resume, cancel, or reconcile command',
        'TransferOperationCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '404': described('Hide an unavailable operation', 'TransferOperationCommandResultV2'),
      '409': described('Reject stale or reused commands', 'TransferOperationCommandResultV2'),
      '422': described('Reject a command that is not approvable in the current operation state',
        'TransferOperationCommandResultV2'),
    }, { security: bearer, requestSchema: 'TransferOperationCommandRequestV2' }),
  },
  '/v2/transfers/account-erasure-review-commands': {
    post: operation('planAccountErasureReviewV2', {
      '200': described('Record a retention review plan without deleting account data',
        'AccountErasureReviewCommandResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
      '403': ref('responses', 'AccessDenied'),
      '409': described('Reject a reused command identifier', 'AccountErasureReviewCommandResultV2'),
    }, { security: bearer, requestSchema: 'AccountErasureReviewCommandRequestV2' }),
  },
}

const connectorImportGrantOperation = operation('issueConnectorImportGrantV2', {
  '200': described('Issue or rotate a manifest-bound connector import grant',
    'ConnectorImportGrantResultV2'),
  '400': ref('responses', 'ProductRequestInvalid'),
  '401': ref('responses', 'AuthenticationRequired'),
  '403': ref('responses', 'AccessDenied'),
  '409': described('Reject stale, reused, or unverified connection binding',
    'ConnectorImportGrantResultV2'),
}, { security: bearer, requestSchema: 'ConnectorImportGrantRequestV2' })

const outboundExecutionGrantOperation = operation('issueOutboundExecutionGrantV2', {
  '200': described('Issue an approved immutable plan-bound outbound grant',
    'OutboundExecutionGrantResultV2'),
  '400': ref('responses', 'ProductRequestInvalid'),
  '401': ref('responses', 'AuthenticationRequired'),
  '403': ref('responses', 'AccessDenied'),
  '409': described('Reject stale, reused, or unapproved transfer binding',
    'OutboundExecutionGrantResultV2'),
}, { security: bearer, requestSchema: 'OutboundExecutionGrantRequestV2' })

const connectorTransferPaths: Readonly<Record<string, Record<string, unknown>>> = {
  '/v2/transfers/connector-import-grants': { post: connectorImportGrantOperation },
  '/v2/transfers/connector-captures/{operationId}/{manifestId}': {
    parameters: [pathParameters.operationId, pathParameters.manifestId],
    get: operation('getConnectorCaptureStatusV2', {
      '200': described('Return resumable contiguous manifest progress', 'ConnectorCaptureManifestStatusV2'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, { security: connectorGrant, parameters: [connectorCapabilityOriginHeader] }),
  },
  '/v2/transfers/connector-captures/{operationId}/{manifestId}/chunks': {
    parameters: [pathParameters.operationId, pathParameters.manifestId],
    post: operation('recordConnectorCaptureChunkV2', {
      '200': described('Record or replay one integrity-checked immutable manifest chunk',
        'ConnectorCaptureChunkReceiptV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'ConnectorCaptureChunkV2',
    }),
  },
  '/v2/transfers/connector-captures/{operationId}/{manifestId}/complete': {
    parameters: [pathParameters.operationId, pathParameters.manifestId],
    post: operation('completeConnectorCaptureManifestV2', {
      '200': described('Verify exact sequences, checksums, counts and digest before snapshot handoff',
        'ConnectorCaptureCompleteResultV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'ConnectorCaptureCompleteRequestV2',
    }),
  },
  '/v2/transfers/outbound-execution-grants': { post: outboundExecutionGrantOperation },
  '/v2/transfers/outbound-execution-authorizations': {
    post: operation('consumeOutboundExecutionGrantV2', {
      '200': described('Atomically consume the one-time grant and return an execution-session receipt',
        'OutboundExecutionAuthorizationReceiptV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'OutboundExecutionConsumeRequestV2',
    }),
  },
  '/v2/transfers/outbound-execution-attempts': {
    post: operation('recordOutboundExecutionAttemptV2', {
      '200': described('Record exact provider item outcomes without credentials',
        'OutboundExecutionAttemptReceiptV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'OutboundExecutionAttemptV2',
    }),
  },
  '/v2/transfers/outbound-execution-attempt-intents': {
    post: operation('prepareOutboundExecutionAttemptV2', {
      '200': described('Durably seal the exact provider write intent before any provider mutation',
        'OutboundExecutionAttemptIntentReceiptV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'OutboundExecutionAttemptIntentV2',
    }),
  },
  '/v2/transfers/outbound-execution-reconciliations': {
    post: operation('recordOutboundExecutionReconciliationV2', {
      '200': described('Resolve or retain outcome-unknown item state',
        'OutboundExecutionReconciliationReceiptV2'),
      '400': ref('responses', 'ProductRequestInvalid'),
      '401': ref('responses', 'AuthenticationRequired'),
    }, {
      security: connectorGrant,
      parameters: [connectorCapabilityOriginHeader],
      requestSchema: 'OutboundExecutionReconciliationV2',
    }),
  },
}

const transferBrowserPaths = Object.fromEntries(Object.entries(transferPaths).map(([path, item]) => {
  const browserItem = Object.fromEntries(Object.entries(item).map(([key, value]) => {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(key)) return [key, value]
    const operationValue = value as Record<string, unknown>
    return [key, {
      ...operationValue,
      operationId: `${String(operationValue.operationId)}ForBrowser`,
      security: browserSession,
    }]
  }))
  return [`/api${path}`, browserItem]
}))

const transferOperationBrowserPaths = Object.fromEntries(
  Object.entries(transferOperationPaths)
    .filter(([path]) => path !== '/v2/transfers/account-erasure-review-commands')
    .map(([path, item]) => {
      const browserItem = Object.fromEntries(Object.entries(item).map(([key, value]) => {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(key)) return [key, value]
        const operationValue = value as Record<string, unknown>
        return [key, { ...operationValue,
          operationId: `${String(operationValue.operationId)}ForBrowser`, security: browserSession }]
      }))
      return [`/api${path}`, browserItem]
    }),
)

const memberGrantBrowserDescription =
  'Requires an authenticated member browser session. The request Origin header and the body ' +
  'placeOrigin must both exactly match the configured public origin.'

const connectorMemberGrantBrowserPaths = {
  '/api/v2/transfers/connector-import-grants': {
    post: {
      ...connectorImportGrantOperation,
      operationId: 'issueConnectorImportGrantV2ForBrowser',
      security: browserSession,
      description: memberGrantBrowserDescription,
    },
  },
  '/api/v2/transfers/outbound-execution-grants': {
    post: {
      ...outboundExecutionGrantOperation,
      operationId: 'issueOutboundExecutionGrantV2ForBrowser',
      security: browserSession,
      description: memberGrantBrowserDescription,
    },
  },
}

export const transferOpenApiPaths = {
  ...transferBrowserPaths,
  ...transferOperationBrowserPaths,
  ...connectorMemberGrantBrowserPaths,
  ...transferPaths,
  ...transferOperationPaths,
  ...connectorTransferPaths,
}
