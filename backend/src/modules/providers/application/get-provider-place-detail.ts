import {
  ProviderDetailUnsupportedError,
  type ProviderPlaceDetail,
  type ProviderPlaceDetailRequest,
  type ProviderPlaceDetails,
} from '../domain/model.js'

export function createProviderPlaceDetailReader(
  readers: readonly ProviderPlaceDetails[],
): (request: ProviderPlaceDetailRequest) => Promise<ProviderPlaceDetail> {
  const byProvider = new Map(readers.map((reader) => [reader.providerKey, reader]))
  if (byProvider.size !== readers.length) {
    throw new Error('Provider detail reader keys must be unique.')
  }
  return async (request) => {
    const reader = byProvider.get(request.providerKey)
    if (reader === undefined) {
      throw new ProviderDetailUnsupportedError('Provider details are unsupported.')
    }
    return reader.get(request)
  }
}
