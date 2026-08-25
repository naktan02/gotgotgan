import * as openid from 'openid-client'

import type { OidcProvider } from './oidc-bff'

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
  discovery: (issuer, clientId, metadata, authentication) =>
    openid.discovery(
      issuer,
      clientId,
      metadata,
      authentication as openid.ClientAuth,
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

export async function createOpenidClientProvider(
  config: Readonly<{
    issuer: string
    clientId: string
    clientSecret: string
    now: () => Date
  }>,
  driver: OpenidClientDriver = defaultDriver,
): Promise<OidcProvider> {
  const issuer = new URL(config.issuer)
  if (
    issuer.protocol !== 'https:' ||
    issuer.username !== '' ||
    issuer.password !== '' ||
    issuer.hash !== '' ||
    config.clientId === '' ||
    config.clientSecret === ''
  ) {
    throw new Error('Invalid OIDC provider configuration')
  }

  const authentication = driver.clientSecretBasic(config.clientSecret)
  const configuration = await driver.discovery(
    issuer,
    config.clientId,
    undefined,
    authentication,
  )

  return {
    async buildAuthorizationUrl(request) {
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
      const tokens = await driver.authorizationCodeGrant(
        configuration,
        new URL(request.currentUrl),
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
