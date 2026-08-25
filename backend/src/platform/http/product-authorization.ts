import type { FastifyReply, FastifyRequest } from 'fastify'

export type ProductAuthorization =
  | Readonly<{ status: 'authorized'; memberId: string }>
  | Readonly<{ status: 'authentication-required' | 'access-denied' }>

export type ProductAuthorizer = (
  authorization: string | undefined,
  permission: 'library.read' | 'library.write' | 'search.read',
) => Promise<ProductAuthorization>

export function sendProductProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  retryable = false,
): FastifyReply {
  if (status === 401) reply.header('WWW-Authenticate', 'Bearer')
  return reply
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .type('application/problem+json')
    .status(status)
    .send({
      type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
      title,
      status,
      code,
      retryable,
      correlationRef: request.id,
    })
}

export async function requireProductMember(
  request: FastifyRequest,
  reply: FastifyReply,
  authorizer: ProductAuthorizer,
  permission: 'library.read' | 'library.write',
): Promise<string | undefined> {
  const result = await authorizer(request.headers.authorization, permission)
  if (result.status === 'authorized') return result.memberId
  sendProductProblem(
    request,
    reply,
    result.status === 'authentication-required' ? 401 : 403,
    result.status === 'authentication-required' ? 'PLACE_AUTHENTICATION_REQUIRED' : 'PLACE_ACCESS_DENIED',
    result.status === 'authentication-required' ? 'Authentication required' : 'Access denied',
  )
  return undefined
}
