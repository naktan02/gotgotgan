export type LibraryMapRequest = Readonly<{
  generation: number
  signal: AbortSignal
}>

export function createLibraryMapRequestGuard() {
  let generation = 0
  let controller: AbortController | undefined

  return {
    start(): LibraryMapRequest {
      generation += 1
      controller?.abort()
      controller = new AbortController()
      return { generation, signal: controller.signal }
    },
    cancel(request: LibraryMapRequest) {
      if (request.generation !== generation) return
      generation += 1
      controller?.abort()
      controller = undefined
    },
    invalidate() {
      generation += 1
      controller?.abort()
      controller = undefined
    },
    isCurrent(request: LibraryMapRequest): boolean {
      return request.generation === generation
    },
  }
}

export type LibraryMapRequestGuard = ReturnType<typeof createLibraryMapRequestGuard>
