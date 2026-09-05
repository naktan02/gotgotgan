'use client'

import {
  DataTransferSettings,
  dataTransferSettingsGateway,
  normalizeSettingsTab,
} from '@/features/data-transfer-settings/public'
import { OperationHistory, operationHistoryGateway } from '@/features/operation-history/public/index'

export function SettingsWorkspace({ remoteImportPreviewEnabled, sharedImportRuntimeEnabled, initialTab }: Readonly<{
  remoteImportPreviewEnabled: boolean
  sharedImportRuntimeEnabled: boolean
  initialTab?: string
}>) {
  return <DataTransferSettings
    gateway={dataTransferSettingsGateway}
    historyPanel={<OperationHistory gateway={operationHistoryGateway} />}
    remoteImportPreviewEnabled={remoteImportPreviewEnabled}
    sharedImportRuntimeEnabled={sharedImportRuntimeEnabled}
    initialTab={normalizeSettingsTab(initialTab)}
  />
}
