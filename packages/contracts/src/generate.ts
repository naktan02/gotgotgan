import { z } from 'zod'

import { connectorWireDocumentSchema } from './connector/index.js'
import { buildOpenApiDocument } from './http/openapi.js'
import { placeReferenceSchema } from './place-reference/index.js'

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function buildContractArtifacts(): ReadonlyMap<string, string> {
  const connectorWireDocument = z.toJSONSchema(connectorWireDocumentSchema, {
    target: 'draft-2020-12',
    io: 'input',
  })
  const placeReference = z.toJSONSchema(placeReferenceSchema, {
    target: 'draft-2020-12',
    io: 'input',
  })

  return new Map([
    ['connector/place-connector.v1.schema.json', json({
      ...connectorWireDocument,
      $id: 'urn:place:connector:v1',
      title: 'Place Connector wire document v1',
    })],
    ['http/openapi.v1.json', json(buildOpenApiDocument())],
    ['place-reference/place-reference.v1.schema.json', json({
      ...placeReference,
      $id: 'urn:place:place-reference:v1',
      title: 'Place reference v1',
    })],
  ])
}
