'use client'

import { ConnectedPlaceImportsView } from './ConnectedPlaceImportsView'
import { useConnectedPlaceImportsWorkflow } from './connected-place-imports-workflow'

export function ConnectedPlaceImports() {
  return <ConnectedPlaceImportsView workflow={useConnectedPlaceImportsWorkflow()} />
}
