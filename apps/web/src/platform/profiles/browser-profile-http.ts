import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  publicProfileAppealRequestSchema,
  publicProfileAppealResultSchema,
  publicProfileCommandResultSchema,
  publicProfileHandleParamsSchema,
  publicProfileModerationNoticeQuerySchema,
  publicProfileModerationNoticesSchema,
  publicProfileNoticeAcknowledgementResultSchema,
  publicProfileNoticeParamsSchema,
  publicProfileQuerySchema,
  publicProfileRecordSchema,
  publicProfileReportRequestSchema,
  publicProfileReportResultSchema,
  setPublicProfileRequestSchema,
} from '@place/contracts/profiles'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import {
  createProfileBackendClient,
  PublicProfileNotFoundError,
  type ProfileBackendClient,
} from './profile-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>

type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: ProfileBackendClient
  createCorrelationRef: () => string
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function noIndex(response: Response): Response {
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}

function problem(status: number, code: string, title: string, correlationRef: string, retryable = false) {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, {
    status,
    headers: { ...privateHeaders, 'content-type': 'application/problem+json' },
  })
}

async function json(response: Response): Promise<unknown> {
  if (response.headers.get('content-type')?.includes('json') !== true) throw new Error()
  return response.json()
}

function queryValues(request: Request): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in values) return undefined
    values[key] = value
  }
  return values
}

export function createBrowserProfileHttp(dependencies: Dependencies) {
  async function authenticated(
    request: Request,
    operation: (accessToken: string) => Promise<Response>,
    schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
    acceptedStatuses: readonly number[],
  ): Promise<Response> {
    const auth = dependencies.resolveAuthRuntime()
    if (auth === undefined) {
      return problem(503, 'PLACE_PUBLIC_PROFILE_UNAVAILABLE', 'Public Profile is temporarily unavailable', dependencies.createCorrelationRef(), true)
    }
    try {
      const session = await auth.bff.resolveSession(request)
      if (session === undefined) {
        return problem(401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required', dependencies.createCorrelationRef())
      }
      const response = await operation(session.tokens.accessToken)
      const value = await json(response)
      if (response.ok && acceptedStatuses.includes(response.status)) {
        const parsed = schema.safeParse(value)
        if (!parsed.success) throw new Error()
        return Response.json(parsed.data, { status: response.status, headers: privateHeaders })
      }
      const parsedProblem = problemSchema.safeParse(value)
      if (parsedProblem.success && [400, 401, 403, 404, 409, 503].includes(response.status)) {
        return problem(
          response.status,
          parsedProblem.data.code,
          parsedProblem.data.title,
          parsedProblem.data.correlationRef,
          parsedProblem.data.retryable,
        )
      }
    } catch {}
    return problem(503, 'PLACE_PUBLIC_PROFILE_UNAVAILABLE', 'Public Profile is temporarily unavailable', dependencies.createCorrelationRef(), true)
  }

  return {
    async report(handle: string, request: Request) {
      const params = publicProfileHandleParamsSchema.safeParse({ handle })
      let body
      try { body = publicProfileReportRequestSchema.safeParse(await request.json()) } catch { body = undefined }
      if (!params.success || body === undefined || !body.success) {
        return problem(400, 'PLACE_PUBLIC_PROFILE_REPORT_INVALID', 'Public Profile report is invalid', dependencies.createCorrelationRef())
      }
      return authenticated(
        request,
        (token) => dependencies.backend.report(token, params.data.handle, body.data, request.signal),
        publicProfileReportResultSchema,
        [200, 201],
      )
    },
    current(request: Request) {
      return authenticated(
        request,
        (token) => dependencies.backend.current(token, request.signal),
        publicProfileRecordSchema,
        [200],
      )
    },
    async set(request: Request) {
      let parsed
      try { parsed = setPublicProfileRequestSchema.safeParse(await request.json()) } catch { parsed = undefined }
      if (parsed === undefined || !parsed.success) {
        return problem(400, 'PLACE_PUBLIC_PROFILE_INVALID', 'Public Profile is invalid', dependencies.createCorrelationRef())
      }
      return authenticated(
        request,
        (token) => dependencies.backend.set(token, parsed.data, request.signal),
        publicProfileCommandResultSchema,
        [200, 201],
      )
    },
    notices(request: Request) {
      const query = publicProfileModerationNoticeQuerySchema.safeParse(queryValues(request))
      if (!query.success) {
        return problem(400, 'PLACE_PUBLIC_PROFILE_NOTICE_QUERY_INVALID', 'Public Profile notice query is invalid', dependencies.createCorrelationRef())
      }
      return authenticated(
        request,
        (token) => dependencies.backend.notices(token, query.data, request.signal),
        publicProfileModerationNoticesSchema,
        [200],
      )
    },
    acknowledgeNotice(noticeId: string, request: Request) {
      const params = publicProfileNoticeParamsSchema.safeParse({ noticeId })
      if (!params.success) {
        return problem(400, 'PLACE_PUBLIC_PROFILE_NOTICE_INVALID', 'Public Profile notice is invalid', dependencies.createCorrelationRef())
      }
      return authenticated(
        request,
        (token) => dependencies.backend.acknowledgeNotice(token, params.data.noticeId, request.signal),
        publicProfileNoticeAcknowledgementResultSchema,
        [200, 201],
      )
    },
    async appeal(request: Request) {
      let parsed
      try { parsed = publicProfileAppealRequestSchema.safeParse(await request.json()) } catch { parsed = undefined }
      if (parsed === undefined || !parsed.success) {
        return problem(400, 'PLACE_PUBLIC_PROFILE_APPEAL_INVALID', 'Public Profile appeal is invalid', dependencies.createCorrelationRef())
      }
      return authenticated(
        request,
        (token) => dependencies.backend.appeal(token, parsed.data, request.signal),
        publicProfileAppealResultSchema,
        [200, 201],
      )
    },
    async published(handle: string, request: Request) {
      const params = publicProfileHandleParamsSchema.safeParse({ handle })
      const query = publicProfileQuerySchema.safeParse(queryValues(request))
      if (!params.success || !query.success) {
        return noIndex(problem(400, 'PLACE_PUBLIC_PROFILE_REQUEST_INVALID', 'Public Profile request is invalid', dependencies.createCorrelationRef()))
      }
      try {
        const profile = await dependencies.backend.published(params.data.handle, query.data, request.signal)
        return noIndex(Response.json(profile, {
          headers: { ...privateHeaders, 'x-robots-tag': 'noindex, nofollow' },
        }))
      } catch (error) {
        const notFound = error instanceof PublicProfileNotFoundError
        return noIndex(problem(
          notFound ? 404 : 503,
          notFound ? 'PLACE_PUBLIC_PROFILE_NOT_FOUND' : 'PLACE_PUBLIC_PROFILE_UNAVAILABLE',
          notFound ? 'Public Profile not found' : 'Public Profile is temporarily unavailable',
          dependencies.createCorrelationRef(),
          !notFound,
        ))
      }
    },
  }
}

export const browserProfileHttp = createBrowserProfileHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createProfileBackendClient(),
  createCorrelationRef: randomUUID,
})
