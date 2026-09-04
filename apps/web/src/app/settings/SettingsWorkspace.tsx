'use client'

import {
  DataTransferSettings,
  dataTransferSettingsGateway,
  normalizeSettingsTab,
} from '@/features/data-transfer-settings/public'
import { OperationHistory, operationHistoryGateway } from '@/features/operation-history/public/index'

export function SettingsWorkspace({ initialTab }: Readonly<{ initialTab?: string }>) {
  return <DataTransferSettings
    gateway={dataTransferSettingsGateway}
    historyPanel={<OperationHistory gateway={operationHistoryGateway} />}
    initialTab={normalizeSettingsTab(initialTab)}
  />
}
