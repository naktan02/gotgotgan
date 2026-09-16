import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import 'maplibre-gl/dist/maplibre-gl.css'
import './globals.css'

import { resolvePlaceMapStyleUrl } from '@/platform/maps/public'

export const metadata: Metadata = {
  title: '곳곳간',
  description: '흩어진 장소를 나만의 목록으로 모으고 기록하는 공간',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const mapStyleUrl = resolvePlaceMapStyleUrl(
    process.env.PLACE_MAP_STYLE_URL,
    process.env.PLACE_WEB_E2E_BASE_URL,
  )
  return (
    <html lang="ko">
      <body data-place-map-style-url={mapStyleUrl}>{children}</body>
    </html>
  )
}
