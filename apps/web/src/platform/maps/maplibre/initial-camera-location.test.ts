import { describe, expect, it, vi } from 'vitest'

import { readInitialCameraLocation } from './initial-camera-location'

describe('initial map camera location', () => {
  it('does not inspect location permission when supplied bounds own the initial camera', async () => {
    const query = vi.fn()
    const getCurrentPosition = vi.fn()
    await expect(readInitialCameraLocation('supplied-bounds', {
      permissions: { query } as unknown as Permissions,
      geolocation: { getCurrentPosition } as unknown as Geolocation,
    })).resolves.toBeUndefined()
    expect(query).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('does not invoke geolocation unless permission is already granted', async () => {
    const getCurrentPosition = vi.fn()
    await expect(readInitialCameraLocation('granted-current-location', {
      permissions: { query: vi.fn(async () => ({ state: 'prompt' })) } as unknown as Permissions,
      geolocation: { getCurrentPosition } as unknown as Geolocation,
    })).resolves.toBeUndefined()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('reads a cached low-accuracy location after an explicit opt-in and granted decision', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: 37.55, longitude: 127.04 },
    } as GeolocationPosition))
    await expect(readInitialCameraLocation('granted-current-location', {
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) } as unknown as Permissions,
      geolocation: { getCurrentPosition } as unknown as Geolocation,
    })).resolves.toEqual([127.04, 37.55])
  })
})
