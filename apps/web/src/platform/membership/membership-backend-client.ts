export type MembershipBackendClientConfig = Readonly<{
  origin: string
  timeoutMilliseconds: number
  request?: typeof fetch
}>

export function createMembershipBackendClient(config: MembershipBackendClientConfig) {
  let origin: URL
  try {
    origin = new URL(config.origin)
  } catch {
    throw new Error('Membership backend configuration is invalid')
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== '' ||
    !Number.isInteger(config.timeoutMilliseconds) ||
    config.timeoutMilliseconds <= 0 ||
    config.timeoutMilliseconds > 60_000
  ) {
    throw new Error('Membership backend configuration is invalid')
  }
  const request = config.request ?? fetch
  const signal = () => AbortSignal.timeout(config.timeoutMilliseconds)
  return {
    currentConsents(): Promise<Response> {
      return request(new URL('/v1/membership-consents/current', origin), {
        cache: 'no-store',
        redirect: 'error',
        signal: signal(),
      })
    },
    onboard(accessToken: string, body: unknown): Promise<Response> {
      return request(new URL('/v1/memberships/onboarding', origin), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: signal(),
      })
    },
  }
}
