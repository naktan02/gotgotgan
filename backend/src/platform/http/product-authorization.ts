import type { FastifyReply, FastifyRequest } from 'fastify'

export type ProductAuthorization =
  | Readonly<{ status: 'authorized'; memberId: string }>
  | Readonly<{ status: 'authentication-required' | 'access-denied' }>

export type ProductPermission =
  | 'library.read'
  | 'library.write'
  | 'library.share'
  | 'search.read'
  | 'imports.read'
  | 'imports.write'

export type ProductAuthorizer = (
  authorization: string | undefined,
  permission: ProductPermission,
) => Promise<ProductAuthorization>

export type OptionalProductMember =
  | Readonly<{ kind: 'anonymous' }>
  | Readonly<{ kind: 'member'; memberId: string }>
  | Readonly<{ kind: 'replied' }>

export function sendProductProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 503,
  code: string,
  title: string,
  retryable = false,
  authenticationScheme: 'Bearer' | 'PlaceConnector' = 'Bearer',
): FastifyReply {
  if (status === 401) reply.header('WWW-Authenticate', authenticationScheme)
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
  permission: 'library.read' | 'library.write' | 'library.share' | 'imports.read' | 'imports.write',
): Promise<string | undefined> {
  let result: ProductAuthorization
  try {
    result = await authorizer(request.headers.authorization, permission)
  } catch {
    sendAuthorizationUnavailable(request, reply)
    return undefined
  }
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

export async function resolveOptionalProductMember(
  request: FastifyRequest,
  reply: FastifyReply,
  authorizer: ProductAuthorizer | undefined,
  permission: ProductPermission,
): Promise<OptionalProductMember> {
  if (request.headers.authorization === undefined) return { kind: 'anonymous' }
  if (authorizer === undefined) {
    sendAuthorizationUnavailable(request, reply)
    return { kind: 'replied' }
  }

  let result: ProductAuthorization
  try {
    result = await authorizer(request.headers.authorization, permission)
  } catch {
    sendAuthorizationUnavailable(request, reply)
    return { kind: 'replied' }
  }
  if (result.status === 'authorized') {
    return { kind: 'member', memberId: result.memberId }
  }

  sendProductProblem(
    request,
    reply,
    result.status === 'authentication-required' ? 401 : 403,
    result.status === 'authentication-required'
      ? 'PLACE_AUTHENTICATION_REQUIRED'
      : 'PLACE_ACCESS_DENIED',
    result.status === 'authentication-required' ? 'Authentication required' : 'Access denied',
  )
  return { kind: 'replied' }
}

function sendAuthorizationUnavailable(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return sendProductProblem(
    request,
    reply,
    503,
    'PLACE_AUTHORIZATION_UNAVAILABLE',
    'Authorization is temporarily unavailable',
    true,
  )
}
