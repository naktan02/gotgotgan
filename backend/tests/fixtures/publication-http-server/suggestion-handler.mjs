import {
  readPublicationRequestJson,
  sendPublicationJson,
} from './publication-http.mjs'

const sessionId = '01992d20-6000-7000-8000-000000000001'
const suggestions = [
  {
    suggestionId: '01992d20-6000-7000-8000-000000000002',
    identity: { kind: 'provider', providerKey: 'google', providerPlaceId: 'google-senkai-fukuoka' },
    source: { key: 'google', label: 'Google Maps', detailsAvailable: true, attributions: [{ label: 'Google Maps' }] },
    name: '센카이 라멘', areaLabel: '후쿠오카 하카타', location: null,
    categoryLabel: '라멘 전문점', observedAt: '2026-08-26T10:00:00.000Z',
  },
  {
    suggestionId: '01992d20-6000-7000-8000-000000000003',
    identity: { kind: 'provider', providerKey: 'kakao', providerPlaceId: 'kakao-senkai-tokyo' },
    source: { key: 'kakao', label: 'Kakao Local', detailsAvailable: false, attributions: [{ label: 'Kakao Local' }] },
    name: '센카이 라멘', areaLabel: '도쿄 신주쿠', location: { latitude: 35.6938, longitude: 139.7034 },
    categoryLabel: '일본 음식점', observedAt: '2026-08-26T10:00:00.000Z',
  },
]

export function createSuggestionHandler() {
  const requests = []
  const selections = []

  return async function handleSuggestion(request, response) {
    if (request.method === 'POST' && request.url === '/v1/search/suggestions') {
      let body
      try { body = await readPublicationRequestJson(request) } catch {
        sendPublicationJson(response, 400, { code: 'PLACE_SUGGESTION_REQUEST_INVALID' }, 'application/problem+json')
        return true
      }
      const query = String(body.query ?? '')
      const observation = { query, aborted: false }
      requests.push(observation)
      response.once('close', () => {
        if (!response.writableEnded) observation.aborted = true
      })
      if (query === '센') await new Promise((resolve) => setTimeout(resolve, 900))
      const items = ['센카이', 'senkai', '샌카이'].some((value) => query.includes(value))
        ? suggestions
        : query === '부분 후보'
          ? suggestions.slice(0, 1)
          : []
      sendPublicationJson(response, 200, {
        schemaVersion: 'place-suggestions.v1',
        sessionId: body.sessionId ?? sessionId,
        items,
        sources: query === '부분 후보'
          ? [
              { sourceKey: 'local', status: 'complete', resultCount: 0 },
              { sourceKey: 'google', status: 'complete', resultCount: 1 },
              { sourceKey: 'kakao', status: 'unavailable', resultCount: 0, errorCode: 'PLACE_SUGGESTION_SOURCE_UNAVAILABLE' },
            ]
          : [
              { sourceKey: 'local', status: 'complete', resultCount: 0 },
              { sourceKey: 'google', status: 'complete', resultCount: items.length > 0 ? 1 : 0 },
              { sourceKey: 'kakao', status: 'complete', resultCount: items.length > 1 ? 1 : 0 },
            ],
      })
      return true
    }

    if (request.method === 'POST' && request.url === '/v1/search/suggestion-selections') {
      let body
      try { body = await readPublicationRequestJson(request) } catch {
        sendPublicationJson(response, 400, { code: 'PLACE_SUGGESTION_SELECTION_INVALID' }, 'application/problem+json')
        return true
      }
      selections.push({ suggestionId: body.suggestionId })
      sendPublicationJson(response, 200, {
        schemaVersion: 'place-suggestion-selection.v1',
        suggestionId: body.suggestionId,
        status: 'recorded',
        observationId: '01992d20-6000-7000-8000-000000000004',
      })
      return true
    }

    if (request.method === 'GET' && request.url === '/__test/suggestion-observations') {
      sendPublicationJson(response, 200, { requests, selections })
      return true
    }

    return false
  }
}
