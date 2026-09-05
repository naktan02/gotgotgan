import type { DesktopAcquisitionProviderFactory } from '../../../../application/ports/desktop-acquisition-provider.js'
import { NaverSavedPlaceSnapshotNormalizer } from '../snapshot/saved-place-snapshot-normalizer.js'
import { createNaverSavedPlaceCollector, NaverApiSavedPlaceSource, NaverProviderSession } from '../api/saved-place-source.js'
import { allowsNaverLoginNavigation, allowsNaverSavedPlaceRequest, naverMemberPageUrl } from '../api/request-policy.js'

export const createNaverDesktopAcquisitionProvider: DesktopAcquisitionProviderFactory = (createClient) => {
  // Probe and collection share one operation budget; the host builds a new Adapter for each click.
  const client = createClient(allowsNaverSavedPlaceRequest)
  return {
    label: 'NAVER', loginUrl: naverMemberPageUrl,
    allowsLoginNavigation: allowsNaverLoginNavigation,
    canProbeLogin: (value) => {
      if (!allowsNaverLoginNavigation(value)) return false
      return new Set(['https://map.naver.com', 'https://pages.map.naver.com']).has(new URL(value).origin)
    },
    acquisition: {
      source: new NaverApiSavedPlaceSource(createNaverSavedPlaceCollector(), client),
      session: new NaverProviderSession(client), normalizer: new NaverSavedPlaceSnapshotNormalizer(),
    },
  }
}
