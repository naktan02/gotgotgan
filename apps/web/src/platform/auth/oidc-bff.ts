export type OidcTransaction = Readonly<{
  id: string
  state: string
  nonce: string
  pkceVerifier: string
  expiresAt: string
}>

export type OidcAuthorizationRequest = Readonly<{
  callbackUrl: string
  scopes: readonly string[]
  state: string
  nonce: string
  pkceChallenge: string
}>

export type OidcTokenSet = Readonly<{
  accessToken: string
  refreshToken?: string
  expiresAt: string
}>

export type OidcProvider = Readonly<{
  buildAuthorizationUrl(request: OidcAuthorizationRequest): Promise<string>
  exchangeAuthorizationCode(request: Readonly<{
    callbackUrl: string
    currentUrl: string
    state: string
    nonce: string
    pkceVerifier: string
  }>): Promise<OidcTokenSet>
}>

export type ReadyOidcProvider = OidcProvider & Readonly<{
  ready(): Promise<void>
}>

export type OidcTransactionStore = Readonly<{
  create(transaction: OidcTransaction): Promise<void>
  take(id: string): Promise<OidcTransaction | undefined>
}>

export type BrowserSession = Readonly<{
  id: string
  tokens: OidcTokenSet
  expiresAt: string
}>

export type BrowserSessionStore = Readonly<{
  create(session: BrowserSession): Promise<void>
  find(id: string): Promise<BrowserSession | undefined>
  delete(id: string): Promise<void>
}>

export type OidcBffConfig = Readonly<{
  callbackUrl: string
  postLoginPath: string
  scopes: readonly string[]
  transactionTtlSeconds: number
  sessionTtlSeconds: number
  allowInsecureLocalHttp?: boolean
}>

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' || hostname === '[::1]'
}

function isAllowedUrl(url: URL, allowInsecureLocalHttp: boolean): boolean {
  return url.protocol === 'https:' ||
    (allowInsecureLocalHttp && url.protocol === 'http:' && isLocalHost(url.hostname))
}

function validateConfig(config: OidcBffConfig): void {
  let callback: URL
  try {
    callback = new URL(config.callbackUrl)
  } catch {
    throw new Error('Invalid OIDC BFF configuration')
  }
  const positiveInteger = (value: number) => Number.isInteger(value) && value > 0
  if (
    !isAllowedUrl(callback, config.allowInsecureLocalHttp === true) ||
    callback.username !== '' ||
    callback.password !== '' ||
    callback.hash !== '' ||
    !config.postLoginPath.startsWith('/') ||
    config.postLoginPath.startsWith('//') ||
    !config.scopes.includes('openid') ||
    !positiveInteger(config.transactionTtlSeconds) ||
    !positiveInteger(config.sessionTtlSeconds)
  ) {
    throw new Error('Invalid OIDC BFF configuration')
  }
}

export function createOidcBff(dependencies: Readonly<{
  config: OidcBffConfig
  provider: OidcProvider
  transactionStore: OidcTransactionStore
  sessionStore: BrowserSessionStore
  randomValue: () => string
  calculatePkceChallenge: (verifier: string) => Promise<string>
  now: () => Date
}>) {
  validateConfig(dependencies.config)

  function invalidTransactionResponse(): Response {
    const headers = new Headers({ 'content-type': 'application/problem+json' })
    headers.append(
      'set-cookie',
      '__Host-place_oidc_tx=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    return new Response(
      JSON.stringify({
        type: 'urn:place:error:oidc-transaction-invalid',
        title: 'Login transaction is invalid or expired',
        status: 400,
        code: 'PLACE_OIDC_TRANSACTION_INVALID',
        retryable: true,
      }),
      { status: 400, headers },
    )
  }

  function rejectedCallbackResponse(): Response {
    const headers = new Headers({ 'content-type': 'application/problem+json' })
    headers.append(
      'set-cookie',
      '__Host-place_oidc_tx=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    return new Response(
      JSON.stringify({
        type: 'urn:place:error:oidc-callback-rejected',
        title: 'Login callback was rejected',
        status: 400,
        code: 'PLACE_OIDC_CALLBACK_REJECTED',
        retryable: true,
      }),
      { status: 400, headers },
    )
  }

  function cookieValue(request: Request, name: string): string | undefined {
    for (const item of (request.headers.get('cookie') ?? '').split(';')) {
      const [key, ...value] = item.trim().split('=')
      if (key === name) return value.join('=') || undefined
    }
    return undefined
  }

  return {
    async start(): Promise<Response> {
      const id = dependencies.randomValue()
      const state = dependencies.randomValue()
      const nonce = dependencies.randomValue()
      const pkceVerifier = dependencies.randomValue()
      const pkceChallenge = await dependencies.calculatePkceChallenge(pkceVerifier)
      const transaction: OidcTransaction = {
        id,
        state,
        nonce,
        pkceVerifier,
        expiresAt: new Date(
          dependencies.now().getTime() + dependencies.config.transactionTtlSeconds * 1000,
        ).toISOString(),
      }
      await dependencies.transactionStore.create(transaction)
      const authorizationUrl = await dependencies.provider.buildAuthorizationUrl({
        callbackUrl: dependencies.config.callbackUrl,
        scopes: dependencies.config.scopes,
        state,
        nonce,
        pkceChallenge,
      })
      const headers = new Headers({ location: authorizationUrl })
      headers.append(
        'set-cookie',
        `__Host-place_oidc_tx=${id}; Max-Age=${dependencies.config.transactionTtlSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      )
      return new Response(null, { status: 302, headers })
    },
    async callback(request: Request): Promise<Response> {
      const transactionId = cookieValue(request, '__Host-place_oidc_tx')
      const transaction =
        transactionId === undefined
          ? undefined
          : await dependencies.transactionStore.take(transactionId)
      if (
        transaction === undefined ||
        new Date(transaction.expiresAt).getTime() <= dependencies.now().getTime()
      ) {
        return invalidTransactionResponse()
      }
      let tokens
      try {
        tokens = await dependencies.provider.exchangeAuthorizationCode({
          callbackUrl: dependencies.config.callbackUrl,
          currentUrl: request.url,
          state: transaction.state,
          nonce: transaction.nonce,
          pkceVerifier: transaction.pkceVerifier,
        })
      } catch {
        return rejectedCallbackResponse()
      }
      const sessionId = dependencies.randomValue()
      const configuredExpiry =
        dependencies.now().getTime() + dependencies.config.sessionTtlSeconds * 1000
      const tokenExpiry = new Date(tokens.expiresAt).getTime()
      if (!Number.isFinite(tokenExpiry) || tokenExpiry <= dependencies.now().getTime()) {
        return rejectedCallbackResponse()
      }
      const expiresAt = new Date(Math.min(configuredExpiry, tokenExpiry)).toISOString()
      await dependencies.sessionStore.create({ id: sessionId, tokens, expiresAt })
      const maxAge = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - dependencies.now().getTime()) / 1000),
      )
      const headers = new Headers({ location: dependencies.config.postLoginPath })
      headers.append(
        'set-cookie',
        `__Host-place_session=${sessionId}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      )
      headers.append(
        'set-cookie',
        '__Host-place_oidc_tx=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      )
      return new Response(null, { status: 303, headers })
    },
    async logout(request: Request): Promise<Response> {
      const sessionId = cookieValue(request, '__Host-place_session')
      if (sessionId !== undefined) await dependencies.sessionStore.delete(sessionId)
      const headers = new Headers({ location: dependencies.config.postLoginPath })
      headers.append(
        'set-cookie',
        '__Host-place_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      )
      return new Response(null, { status: 303, headers })
    },
    async resolveSession(request: Request): Promise<BrowserSession | undefined> {
      const sessionId = cookieValue(request, '__Host-place_session')
      if (sessionId === undefined) return undefined
      const session = await dependencies.sessionStore.find(sessionId)
      if (
        session !== undefined &&
        new Date(session.expiresAt).getTime() <= dependencies.now().getTime()
      ) {
        await dependencies.sessionStore.delete(sessionId)
        return undefined
      }
      return session
    },
  }
}
