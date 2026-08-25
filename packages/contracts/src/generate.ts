import { z } from 'zod'

import { buildOpenApiDocument } from './http/openapi.js'
import { placeReferenceSchema } from './place-reference/index.js'

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function buildContractArtifacts(): ReadonlyMap<string, string> {
  const placeReference = z.toJSONSchema(placeReferenceSchema, {
    target: 'draft-2020-12',
    io: 'input',
  })

  return new Map([
    ['http/openapi.v1.json', json(buildOpenApiDocument())],
    ['place-reference/place-reference.v1.schema.json', json({
      ...placeReference,
      $id: 'urn:place:place-reference:v1',
      title: 'Place reference v1',
    })],
  ])
}
