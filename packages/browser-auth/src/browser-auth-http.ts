import type { OidcBff } from './oidc-bff.js'

export type BrowserAuthRuntime = Readonly<{
  bff: OidcBff
}>

export type BrowserAuthHttpDependencies = Readonly<{
  resolveRuntime: () => BrowserAuthRuntime | undefined
  createCorrelationRef: () => string
}>

async function secureResponse(
  response: Response,
  createCorrelationRef: () => string,
): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  headers.set('pragma', 'no-cache')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  if (headers.get('content-type')?.startsWith('application/problem+json')) {
    const problem: unknown = await response.json()
    if (typeof problem !== 'object' || problem === null || Array.isArray(problem)) {
      throw new Error('Browser authentication problem response is invalid')
    }
    headers.delete('content-length')
    return new Response(
      JSON.stringify({ ...problem, correlationRef: createCorrelationRef() }),
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function unavailableProblem(correlationRef: string): Response {
  return Response.json(
    {
      type: 'urn:place:error:browser-auth-unavailable',
      title: 'Browser authentication is temporarily unavailable',
      status: 503,
      code: 'PLACE_BROWSER_AUTH_UNAVAILABLE',
      retryable: true,
      correlationRef,
    },
    {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/problem+json',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export function createBrowserAuthHttp(dependencies: BrowserAuthHttpDependencies) {
  async function invoke(
    action: (runtime: BrowserAuthRuntime) => Promise<Response>,
  ): Promise<Response> {
    const runtime = dependencies.resolveRuntime()
    if (runtime === undefined) {
      return unavailableProblem(dependencies.createCorrelationRef())
    }
    try {
      return await secureResponse(
        await action(runtime),
        dependencies.createCorrelationRef,
      )
    } catch {
      return unavailableProblem(dependencies.createCorrelationRef())
    }
  }

  return {
    async start(): Promise<Response> {
      return invoke((runtime) => runtime.bff.start())
    },
    async callback(request: Request): Promise<Response> {
      return invoke((runtime) => runtime.bff.callback(request))
    },
    async logout(request: Request): Promise<Response> {
      return invoke((runtime) => runtime.bff.logout(request))
    },
  }
}
