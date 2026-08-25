import { describe, expect, it } from 'vitest'

import { readHttpRuntimeConfig } from '../src/entrypoints/http/config.js'

describe('HTTP runtime configuration', () => {
  it('requires deployment-owned host and port values', () => {
    expect(() => readHttpRuntimeConfig({})).toThrow()
  })

  it('parses injected values without a repository address default', () => {
    expect(readHttpRuntimeConfig({ PLACE_HTTP_HOST: 'loopback.invalid', PLACE_HTTP_PORT: '4312' }))
      .toEqual({ host: 'loopback.invalid', port: 4312 })
  })
})
