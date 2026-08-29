import {
  browserLibraryCommandRequestSchema,
  type BrowserLibraryCommandRequest,
} from '@place/contracts/http'
import { libraryCommandResultSchema } from '@place/contracts/library'

export class PublishedCollectionCopyProblem extends Error {
  constructor(readonly status: number) {
    super('Published Collection copy failed')
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new PublishedCollectionCopyProblem(response.status)
  }
  return response.json()
}

export function createPublishedCollectionCopyAttempt(
  sourcePublicationId: string,
  targetName: string,
  fetcher: typeof fetch = fetch,
) {
  const targetCollectionId = crypto.randomUUID()
  const request: BrowserLibraryCommandRequest = {
    commandId: crypto.randomUUID(),
    command: {
      kind: 'copy-published-collection',
      sourcePublicationId,
      targetCollectionId,
      targetName,
    },
  }
  const body = browserLibraryCommandRequestSchema.parse(request)

  return {
    targetCollectionId,
    async execute(): Promise<string> {
      const response = await fetcher('/api/library/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      libraryCommandResultSchema.parse(await responsePayload(response))
      return targetCollectionId
    },
  }
}
