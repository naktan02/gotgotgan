import type { BrowserMapStyle } from '@place/contracts/http'

const localStyle = {
  version: 8,
  name: '곳곳간 E2E 빈 지도',
  sources: {},
  layers: [{
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#eaf1f7' },
  }],
} as const satisfies BrowserMapStyle

export function GET() {
  return Response.json(localStyle, {
    headers: {
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  })
}
