import {
  composeConnectorTransferRuntime,
  type ConnectorTransferRuntime,
} from '../application/connector-transfer-runtime.js'
import {
  configuredConnectorTransferActivation,
  configuredConnectorTransferCapabilities,
} from './transfer-capabilities.js'

/** Future Provider adapters are composed here only after their complete v2 dependencies exist. */
export function createConfiguredConnectorTransferRuntime(): ConnectorTransferRuntime {
  if (configuredConnectorTransferActivation.blockers.length === 0) {
    throw new Error('Disabled Connector transfer runtime requires explicit activation blockers')
  }
  const runtime = composeConnectorTransferRuntime()
  if (
    JSON.stringify(runtime.capabilities) !==
    JSON.stringify(configuredConnectorTransferCapabilities)
  ) throw new Error('Configured Connector capabilities differ from the composed runtime')
  return runtime
}
