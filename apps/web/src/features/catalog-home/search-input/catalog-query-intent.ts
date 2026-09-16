import type { CatalogExplorationResponseV2 as CatalogExplorationResponse, CatalogSearchIntent } from '@place/contracts/search'

type QueryIntent = Readonly<{
  query: string
  intent: CatalogSearchIntent
  hasTaxonomy: boolean
  explore: (signal: AbortSignal) => Promise<CatalogExplorationResponse>
  search: (intent: CatalogSearchIntent) => void
  chooseDestination: (destination: CatalogExplorationResponse['destinations'][number]) => void
}>

// Initial URL and Enter share one intent owner. A newer explicit action wins,
// even when its text is identical or the old transport ignores cancellation.
export function createCatalogQueryIntentResolver() {
  let generation = 0
  let controller: AbortController | undefined
  const invalidate = () => { ++generation; controller?.abort(); controller = undefined }
  return {
    invalidate,
    async resolve(request: QueryIntent) {
      invalidate()
      const current = generation
      if (request.intent !== 'auto' || request.query.length < 2 || request.hasTaxonomy) {
        request.search(request.intent)
        return
      }
      controller = new AbortController()
      const signal = controller.signal
      try {
        const result = await request.explore(signal)
        if (current !== generation || signal.aborted) return
        const exact = result.destinations.filter((destination) => destination.exact)
        if (exact.length === 1) request.chooseDestination(exact[0]!)
        else request.search(result.intent === 'auto' ? 'conditions' : result.intent)
      } catch {
        if (current === generation && !signal.aborted) request.search('auto')
      }
    },
  }
}
