import { createServer } from 'node:http'

const host = process.env.PLACE_E2E_BACKEND_HOST
const port = Number(process.env.PLACE_E2E_BACKEND_PORT)
if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('E2E publication backend address is invalid')
}

const collectionPublicationId = '01992d20-0000-7000-8000-000000000001'
const writingPublicationId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const projections = new Map([
  [`/v1/public/collections/${collectionPublicationId}`, {
    publicationId: collectionPublicationId,
    visibility: 'unlisted',
    name: '성수에서 다시 갈 곳',
    description: '링크를 받은 사람에게만 보이는 컬렉션',
    places: [{ placeId, position: 0 }],
    updatedAt: '2026-08-26T10:00:00.000Z',
  }],
  [`/v1/public/writing/${writingPublicationId}`, {
    kind: 'entry',
    publicationId: writingPublicationId,
    visibility: 'public',
    title: '성수의 하루',
    body: '공개하기로 선택한 글만 표시합니다.',
    placeIds: [placeId],
    updatedAt: '2026-08-26T10:00:00.000Z',
  }],
])

const server = createServer((request, response) => {
  const projection = request.method === 'GET' ? projections.get(request.url ?? '') : undefined
  response.setHeader('content-type', 'application/json')
  response.setHeader('x-content-type-options', 'nosniff')
  if (projection === undefined) {
    response.statusCode = 404
    response.end(JSON.stringify({ code: 'PLACE_PUBLICATION_NOT_FOUND' }))
    return
  }
  response.statusCode = 200
  response.end(JSON.stringify(projection))
})

server.listen(port, host)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
