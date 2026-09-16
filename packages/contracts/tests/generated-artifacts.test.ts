import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { buildContractArtifacts } from '../src/generate.js'

describe('generated contract artifacts', () => {
  it('publishes matching anonymous catalog map browser and backend operations', () => {
    const openApi = JSON.parse(
      buildContractArtifacts().get('http/openapi.v1.json') ?? '{}',
    ) as Readonly<{ paths?: Readonly<Record<string, Readonly<{ post?: unknown }>>> }>
    const browser = openApi.paths?.['/api/search/catalog/map']?.post as
      Readonly<Record<string, unknown>> | undefined
    const backend = openApi.paths?.['/v1/search/catalog/map']?.post as
      Readonly<Record<string, unknown>> | undefined

    expect(browser).toBeDefined()
    expect(backend).toBeDefined()
    expect(browser?.requestBody).toEqual(backend?.requestBody)
    const browserResponses = browser?.responses as Readonly<Record<string, unknown>> | undefined
    const backendResponses = backend?.responses as Readonly<Record<string, unknown>> | undefined
    expect(browserResponses?.['200']).toEqual(backendResponses?.['200'])
    expect(browser?.security).toEqual([])
    expect(backend?.security).toEqual([])
  })

  it('match the committed OpenAPI and PlaceReference publications', async () => {
    const generated = buildContractArtifacts()
    const [openApi, placeReference] = await Promise.all([
      readFile(new URL('../http/openapi.v1.json', import.meta.url), 'utf8'),
      readFile(
        new URL('../place-reference/place-reference.v1.schema.json', import.meta.url),
        'utf8',
      ),
    ])

    expect(generated.get('http/openapi.v1.json')).toBe(openApi)
    expect(generated.get('place-reference/place-reference.v1.schema.json')).toBe(
      placeReference,
    )
  })

  it('publishes only the member-session connector grant aliases', () => {
    const openApi = JSON.parse(
      buildContractArtifacts().get('http/openapi.v1.json') ?? '{}',
    ) as Readonly<{ paths?: Readonly<Record<string, Readonly<{ post?: unknown }>>> }>
    const paths = openApi.paths ?? {}
    const aliases = [
      ['/api/v2/transfers/connector-import-grants', '/v2/transfers/connector-import-grants'],
      ['/api/v2/transfers/outbound-execution-grants', '/v2/transfers/outbound-execution-grants'],
    ] as const

    for (const [browserPath, backendPath] of aliases) {
      const browser = paths[browserPath]?.post as Readonly<Record<string, unknown>> | undefined
      const backend = paths[backendPath]?.post as Readonly<Record<string, unknown>> | undefined
      expect(browser).toBeDefined()
      expect(backend).toBeDefined()
      expect(browser?.requestBody).toEqual(backend?.requestBody)
      expect(browser?.responses).toEqual(backend?.responses)
      expect(browser?.security).toEqual([{ placeBrowserSession: [] }])
      expect(browser?.description).toContain('Origin')
      expect(browser?.description).toContain('placeOrigin')
    }

    expect(paths['/api/connector/grants']).toBeUndefined()
    expect(paths['/api/connector/captures']).toBeUndefined()
    expect(Object.keys(paths).some((path) =>
      path.startsWith('/api/v2/transfers/connector-captures/') ||
      path.startsWith('/api/v2/transfers/outbound-execution-authorizations') ||
      path.startsWith('/api/v2/transfers/outbound-execution-attempt') ||
      path.startsWith('/api/v2/transfers/outbound-execution-reconciliations')
    )).toBe(false)
  })

  it('requires standard Origin only on backend connector-capability operations', () => {
    const openApi = JSON.parse(
      buildContractArtifacts().get('http/openapi.v1.json') ?? '{}',
    ) as Readonly<{ paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>> }>
    const paths = openApi.paths ?? {}
    const capabilityOperations = [
      ['/v2/transfers/connector-captures/{operationId}/{manifestId}', 'get'],
      ['/v2/transfers/connector-captures/{operationId}/{manifestId}/chunks', 'post'],
      ['/v2/transfers/connector-captures/{operationId}/{manifestId}/complete', 'post'],
      ['/v2/transfers/outbound-execution-authorizations', 'post'],
      ['/v2/transfers/outbound-execution-attempts', 'post'],
      ['/v2/transfers/outbound-execution-attempt-intents', 'post'],
      ['/v2/transfers/outbound-execution-reconciliations', 'post'],
    ] as const

    for (const [path, method] of capabilityOperations) {
      const operation = paths[path]?.[method] as Readonly<{
        parameters?: readonly Readonly<Record<string, unknown>>[]
      }> | undefined
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        name: 'Origin', in: 'header', required: true,
      }))
    }

    for (const path of [
      '/v2/transfers/connector-import-grants',
      '/v2/transfers/outbound-execution-grants',
      '/api/v2/transfers/connector-import-grants',
      '/api/v2/transfers/outbound-execution-grants',
    ]) {
      const operation = paths[path]?.post as Readonly<{
        parameters?: readonly Readonly<Record<string, unknown>>[]
      }> | undefined
      expect(operation?.parameters?.some((parameter) => parameter.name === 'Origin') ?? false)
        .toBe(false)
    }
  })
})
