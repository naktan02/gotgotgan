import { createServer } from 'node:http'

import { createCatalogSearchHandler } from './publication-http-server/catalog-search-handler.mjs'
import { createPlaceSearchHandler } from './publication-http-server/place-search-handler.mjs'
import { createPublicContentHandler } from './publication-http-server/public-content-handler.mjs'
import { sendPublicationJson } from './publication-http-server/publication-http.mjs'
import { createSuggestionHandler } from './publication-http-server/suggestion-handler.mjs'

const host = process.env.PLACE_E2E_BACKEND_HOST
const port = Number(process.env.PLACE_E2E_BACKEND_PORT)
if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('E2E Place backend address is invalid')
}

const handlers = [
  createCatalogSearchHandler(),
  createPlaceSearchHandler(),
  createSuggestionHandler(),
  createPublicContentHandler(),
]

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
  for (const handle of handlers) {
    if (await handle(request, response, requestUrl)) return
  }
  sendPublicationJson(response, 404, { code: 'PLACE_PUBLICATION_NOT_FOUND' })
})

server.listen(port, host)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
