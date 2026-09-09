export const mapAccentPalette = {
  fern: '#237a57',
  ocean: '#2f6fb0',
  amber: '#b7791f',
  coral: '#c15f45',
  violet: '#7455a6',
  cyan: '#25818c',
  magenta: '#a94f7c',
  slate: '#5f6f7f',
} as const

export type MapAccentToken = keyof typeof mapAccentPalette

export function mapAccentColor(token: MapAccentToken): string {
  return mapAccentPalette[token]
}
