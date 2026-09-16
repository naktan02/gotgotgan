import {
  connectorCaptureChunkReceiptV2Schema,
  connectorCaptureCompleteRequestV2Schema,
  connectorCaptureCompleteResultV2Schema,
  connectorCaptureManifestStatusV2Schema,
  connectorCaptureManifestV2Schema,
  connectorImportGrantRequestV2Schema,
  connectorImportGrantResultV2Schema,
  connectorImportGrantV2Schema,
} from '@place/contracts/transfers'

import type {
  ConnectorSnapshotHandoff,
} from '../../../application/import-snapshot/index.js'
import { PlaceTransferHttp } from './place-transfer-http.js'

function capturePath(operationId: string, manifestId: string):
`/v2/transfers/connector-captures/${string}/${string}` {
  return `/v2/transfers/connector-captures/${encodeURIComponent(operationId)}/${encodeURIComponent(manifestId)}`
}

/** v2 import handoff over the exact public Place BFF paths. */
export class HttpImmutableSnapshotHandoff implements ConnectorSnapshotHandoff {
  constructor(
    private readonly memberSessionHttp: PlaceTransferHttp,
    private readonly capabilityHttp: PlaceTransferHttp,
  ) {}

  async issueGrant(input: Parameters<ConnectorSnapshotHandoff['issueGrant']>[0]) {
    const request = connectorImportGrantRequestV2Schema.parse(input.request)
    return connectorImportGrantResultV2Schema.parse(await this.memberSessionHttp.send({
      pathname: '/api/v2/transfers/connector-import-grants',
      method: 'POST', body: request, signal: input.signal,
    }))
  }

  async status(input: Parameters<ConnectorSnapshotHandoff['status']>[0]) {
    const grant = connectorImportGrantV2Schema.parse(input.grant)
    return connectorCaptureManifestStatusV2Schema.parse(await this.capabilityHttp.send({
      pathname: capturePath(grant.operationId, grant.manifest.manifestId),
      method: 'GET', token: grant.token, signal: input.signal,
    }))
  }

  async upload(input: Parameters<ConnectorSnapshotHandoff['upload']>[0]) {
    const grant = connectorImportGrantV2Schema.parse(input.grant)
    const path = capturePath(grant.operationId, grant.manifest.manifestId)
    return connectorCaptureChunkReceiptV2Schema.parse(await this.capabilityHttp.send({
      pathname: `${path}/chunks`, method: 'POST', body: input.chunk,
      token: grant.token, signal: input.signal,
    }))
  }

  async complete(input: Parameters<ConnectorSnapshotHandoff['complete']>[0]) {
    const grant = connectorImportGrantV2Schema.parse(input.grant)
    const manifest = connectorCaptureManifestV2Schema.parse(input.manifest)
    const path = capturePath(grant.operationId, manifest.manifestId)
    const request = connectorCaptureCompleteRequestV2Schema.parse({
      schemaVersion: 'connector-capture-complete-request.v2',
      operationId: grant.operationId,
      manifest,
    })
    return connectorCaptureCompleteResultV2Schema.parse(await this.capabilityHttp.send({
      pathname: `${path}/complete`, method: 'POST', body: request,
      token: grant.token, signal: input.signal,
    }))
  }
}
