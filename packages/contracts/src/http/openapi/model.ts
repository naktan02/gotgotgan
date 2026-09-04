export const anonymous: readonly unknown[] = []
export const bearer = [{ placeBearer: [] }]
export const browserSession = [{ placeBrowserSession: [] }]
export const connectorGrant = [{ placeConnector: [] }]
export const optionalBearer = [{ placeBearer: [] }, {}]

export const ref = (section: 'responses' | 'schemas', name: string) => ({
  $ref: `#/components/${section}/${name}`,
})
export const described = (description: string, schemaName?: string) => ({
  description,
  ...(schemaName === undefined ? {} : {
    content: { 'application/json': { schema: ref('schemas', schemaName) } },
  }),
})

export function requestBody(schemaName: string) {
  return {
    required: true,
    content: { 'application/json': { schema: ref('schemas', schemaName) } },
  }
}

export function operation(
  operationId: string,
  responses: Readonly<Record<string, unknown>>,
  options: Readonly<{
    parameters?: readonly unknown[]
    security?: readonly unknown[]
    requestSchema?: string
    summary?: string
  }> = {},
) {
  return {
    operationId,
    summary: options.summary ?? operationId,
    ...(options.security === undefined ? {} : { security: options.security }),
    ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
    ...(options.requestSchema === undefined ? {} : {
      requestBody: requestBody(options.requestSchema),
    }),
    responses,
  }
}
