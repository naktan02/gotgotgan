import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { buildContractArtifacts } from '../src/generate.js'

describe('generated contract artifacts', () => {
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
})
