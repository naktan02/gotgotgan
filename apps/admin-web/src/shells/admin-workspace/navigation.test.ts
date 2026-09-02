import { describe, expect, it } from 'vitest'

import { adminNavigation } from './navigation'

describe('administrator navigation delivery states', () => {
  it('exposes only the access dashboard until owning Backend Interfaces exist', () => {
    const items = adminNavigation.flatMap((group) => group.items)
    expect(items.filter((item) => item.enabled).map((item) => item.label)).toEqual([
      '접근 및 Capability',
    ])
    expect(
      items.filter((item) => !item.enabled).every(
        (item) => item.detail === 'Backend Interface 미구현',
      ),
    ).toBe(true)
  })

  it('does not add Family Services to the administrator app', () => {
    expect(JSON.stringify(adminNavigation)).not.toContain('패밀리')
  })
})
