'use client'

import {
  DataTransferSettings,
  dataTransferSettingsGateway,
  normalizeSettingsTab,
} from '@/features/data-transfer-settings/public'

export function SettingsWorkspace({ initialTab }: Readonly<{ initialTab?: string }>) {
  return <DataTransferSettings gateway={dataTransferSettingsGateway} initialTab={normalizeSettingsTab(initialTab)} />
}
