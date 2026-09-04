export type PlaceFilingRequest = Readonly<{
  generation: number
  placeId: string
}>

export function createPlaceFilingRequestGuard() {
  let activePlaceId: string | undefined
  let generation = 0

  return {
    activate(placeId: string | undefined) {
      if (activePlaceId === placeId) return
      activePlaceId = placeId
      generation += 1
    },
    start(placeId: string): PlaceFilingRequest {
      generation += 1
      return { generation, placeId }
    },
    isActive(placeId: string): boolean {
      return activePlaceId === placeId
    },
    isCurrent(request: PlaceFilingRequest): boolean {
      return request.generation === generation && request.placeId === activePlaceId
    },
  }
}

export type PlaceFilingRequestGuard = ReturnType<typeof createPlaceFilingRequestGuard>
