import * as openid from 'openid-client'

import type { ReadyOidcProvider } from './oidc-bff'

type DriverTokenResponse = Readonly<{
  access_token: string
  refresh_token?: string
  expiresIn(): number | undefined
}>

export type OpenidClientDriver = Readonly<{
  clientSecretBasic(secret: string): unknown
  discovery(
    issuer: URL,
    clientId: string,
    metadata: undefined,
    authentication: unknown,
    options?: Readonly<{ execute: readonly unknown[] }>,
  ): Promise<unknown>
  buildAuthorizationUrl(configuration: unknown, parameters: Record<string, string>): URL
  authorizationCodeGrant(
    configuration: unknown,
    currentUrl: URL,
    checks: Readonly<{
      pkceCodeVerifier: string
      expectedState: string
      expectedNonce: string
      idTokenExpected: true
    }>,
    tokenEndpointParameters: Readonly<{ redirect_uri: string }>,
  ): Promise<DriverTokenResponse>
}>

const defaultDriver: OpenidClientDriver = {
  clientSecretBasic: (secret) => openid.ClientSecretBasic(secret),
  discovery: (issuer, clientId, metadata, authentication, options) =>
    openid.discovery(
      issuer,
      clientId,
      metadata,
      authentication as openid.ClientAuth,
      options as openid.DiscoveryRequestOptions | undefined,
    ),
  buildAuthorizationUrl: (configuration, parameters) =>
    openid.buildAuthorizationUrl(configuration as openid.Configuration, parameters),
  authorizationCodeGrant: (configuration, currentUrl, checks, tokenEndpointParameters) =>
    openid.authorizationCodeGrant(
      configuration as openid.Configuration,
      currentUrl,
      checks,
      tokenEndpointParameters,
    ),
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' || hostname === '[::1]'
}

export async function createOpenidClientProvider(
  config: Readonly<{
    issuer: string
    clientId: string
    clientSecret: string
    allowInsecureLocalHttp?: boolean
    now: () => Date
  }>,
  driver: OpenidClientDriver = defaultDriver,
): Promise<ReadyOidcProvider> {
  const issuer = new URL(config.issuer)
  const useInsecureLocalHttp = config.allowInsecureLocalHttp === true &&
    issuer.protocol === 'http:' && isLocalHost(issuer.hostname)
  if (
    (
      issuer.protocol !== 'https:' &&
      !useInsecureLocalHttp
    ) ||
    issuer.username !== '' ||
    issuer.password !== '' ||
    issuer.hash !== '' ||
    config.clientId === '' ||
    config.clientSecret === ''
  ) {
    throw new Error('Invalid OIDC provider configuration')
  }

  const authentication = driver.clientSecretBasic(config.clientSecret)
  let configurationPromise: Promise<unknown> | undefined
  const discover = (): Promise<unknown> => {
    configurationPromise ??= driver.discovery(
      issuer,
      config.clientId,
      undefined,
      authentication,
      useInsecureLocalHttp
        ? { execute: [openid.allowInsecureRequests] }
        : undefined,
    ).catch((error: unknown) => {
      configurationPromise = undefined
      throw error
    })
    return configurationPromise
  }

  return {
    async ready() {
      await discover()
    },
    async buildAuthorizationUrl(request) {
      const configuration = await discover()
      return driver.buildAuthorizationUrl(configuration, {
        redirect_uri: request.callbackUrl,
        scope: request.scopes.join(' '),
        state: request.state,
        nonce: request.nonce,
        code_challenge: request.pkceChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
      }).href
    },
    async exchangeAuthorizationCode(request) {
      const configuration = await discover()
      const currentUrl = new URL(request.currentUrl)
      const callbackResponseUrl = new URL(request.callbackUrl)
      callbackResponseUrl.search = currentUrl.search
      const tokens = await driver.authorizationCodeGrant(
        configuration,
        callbackResponseUrl,
        {
          pkceCodeVerifier: request.pkceVerifier,
          expectedState: request.state,
          expectedNonce: request.nonce,
          idTokenExpected: true,
        },
        { redirect_uri: request.callbackUrl },
      )
      const expiresIn = tokens.expiresIn()
      if (expiresIn === undefined || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('OIDC token expiry is missing or invalid')
      }
      return {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
        expiresAt: new Date(config.now().getTime() + expiresIn * 1000).toISOString(),
      }
    },
  }
}
