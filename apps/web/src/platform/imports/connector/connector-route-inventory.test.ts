import { access } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const routeRoot = new URL('../../../app/api/', import.meta.url)

async function routeExists(relativePath: string): Promise<boolean> {
  try {
    await access(new URL(relativePath, routeRoot))
    return true
  } catch {
    return false
  }
}

describe('connector Web BFF route inventory', () => {
  it.each([
    'v2/transfers/connector-import-grants/route.ts',
    'v2/transfers/outbound-execution-grants/route.ts',
  ])('keeps the member-session grant route %s', async (route) => {
    expect(await routeExists(route)).toBe(true)
  })

  it.each([
    'connector/captures/route.ts',
    'connector/grants/route.ts',
    'v2/transfers/connector-captures/[operationId]/[manifestId]/route.ts',
    'v2/transfers/connector-captures/[operationId]/[manifestId]/chunks/route.ts',
    'v2/transfers/connector-captures/[operationId]/[manifestId]/complete/route.ts',
    'v2/transfers/outbound-execution-authorizations/route.ts',
    'v2/transfers/outbound-execution-attempt-intents/route.ts',
    'v2/transfers/outbound-execution-attempts/route.ts',
    'v2/transfers/outbound-execution-reconciliations/route.ts',
  ])('does not expose the removed or capability route %s', async (route) => {
    expect(await routeExists(route)).toBe(false)
  })
})
