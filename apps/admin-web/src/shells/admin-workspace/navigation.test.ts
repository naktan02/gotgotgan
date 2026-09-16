import { describe, expect, it } from 'vitest'

import { adminNavigation } from './navigation'

describe('administrator navigation delivery states', () => {
  it('exposes the dashboard and read-only catalog with real Backend Interfaces', () => {
    const items = adminNavigation.flatMap((group) => group.items)
    expect(items.filter((item) => item.enabled).map((item) => item.label)).toEqual([
      '접근 및 Capability',
      '장소 데이터',
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
