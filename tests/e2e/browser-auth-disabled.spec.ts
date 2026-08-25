import { expect, test, type APIResponse } from '@playwright/test'

async function expectUnavailable(response: APIResponse): Promise<void> {
  expect(response.status()).toBe(503)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(await response.json()).toEqual({
    type: 'urn:place:error:browser-auth-unavailable',
    title: 'Browser authentication is temporarily unavailable',
    status: 503,
    code: 'PLACE_BROWSER_AUTH_UNAVAILABLE',
    retryable: true,
    correlationRef: expect.any(String),
  })
}

test('browser authentication fails closed while the source-only runtime is inactive', async ({
  request,
}) => {
  await expectUnavailable(await request.get('/api/auth/oidc/start'))
  await expectUnavailable(
    await request.get('/api/auth/oidc/callback?code=untrusted-code'),
  )
  await expectUnavailable(await request.post('/api/auth/logout'))

  const unsafeLogout = await request.get('/api/auth/logout')
  expect(unsafeLogout.status()).toBe(405)
})
