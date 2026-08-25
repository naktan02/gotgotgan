import { expect, test, type APIResponse } from '@playwright/test'

async function expectUnavailable(response: APIResponse): Promise<void> {
  expect(response.status()).toBe(503)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(await response.json()).toEqual({
    type: 'urn:place:error:membership-web-unavailable',
    title: 'Membership is temporarily unavailable',
    status: 503,
    code: 'PLACE_MEMBERSHIP_WEB_UNAVAILABLE',
    retryable: true,
    correlationRef: expect.any(String),
  })
}

test('browser membership fails closed while the server runtime is inactive', async ({
  request,
}) => {
  await expectUnavailable(await request.get('/api/membership-consents/current'))
  await expectUnavailable(
    await request.post('/api/memberships/onboarding', {
      data: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      },
    }),
  )

  expect((await request.post('/api/membership-consents/current')).status()).toBe(405)
  expect((await request.get('/api/memberships/onboarding')).status()).toBe(405)
})
