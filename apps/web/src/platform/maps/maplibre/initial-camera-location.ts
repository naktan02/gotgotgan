import type { PlaceMapInitialCameraMode } from '../place-map-interface'

type GeolocationNavigator = Pick<Navigator, 'geolocation' | 'permissions'>

export async function readInitialCameraLocation(
  mode: PlaceMapInitialCameraMode,
  navigatorRef: GeolocationNavigator,
): Promise<readonly [longitude: number, latitude: number] | undefined> {
  if (mode !== 'granted-current-location') return undefined
  try {
    const permission = await navigatorRef.permissions.query({ name: 'geolocation' })
    if (permission.state !== 'granted') return undefined
    return await new Promise((resolve) => {
      navigatorRef.geolocation.getCurrentPosition(
        (position) => resolve([position.coords.longitude, position.coords.latitude]),
        () => resolve(undefined),
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 2_000 },
      )
    })
  } catch {
    return undefined
  }
}
