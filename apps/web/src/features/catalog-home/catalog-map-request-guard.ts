export function createCatalogMapRequestGuard() {
  let generation = 0
  let controller: AbortController | undefined
  return {
    invalidate() {
      generation += 1
      controller?.abort()
      controller = undefined
    },
    start() {
      generation += 1
      controller?.abort()
      controller = new AbortController()
      return { generation, signal: controller.signal }
    },
    isCurrent(candidate: number) {
      return candidate === generation
    },
  }
}

export type CatalogMapRequestGuard = ReturnType<typeof createCatalogMapRequestGuard>
