import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PublicProfileSettingsView } from './PublicProfileSettings'
import type { PublicProfileSettingsWorkflow } from './public-profile-settings'

function workflow(overrides: Partial<PublicProfileSettingsWorkflow> = {}): PublicProfileSettingsWorkflow {
  return {
    loadState: 'ready', profile: undefined, handle: '', displayName: '', visibility: 'hidden', saving: false, error: undefined,
    setHandle: () => undefined, setDisplayName: () => undefined, setVisibility: () => undefined,
    save: () => undefined, retry: async () => undefined, reload: async () => undefined,
    ...overrides,
  }
}

describe('public profile settings labels and states', () => {
  it('uses the actual profile route and public nickname without legacy branding', () => {
    const markup = renderToStaticMarkup(<PublicProfileSettingsView workflow={workflow()} />)
    expect(markup).toContain('프로필 주소')
    expect(markup).toContain('공개 닉네임')
    expect(markup).toContain('/people/')
    expect(markup).toContain('아직 공개 프로필이 없습니다.')
    expect(markup).not.toContain('place/people/')
    expect(markup).not.toContain('공개 핸들')
    expect(markup).not.toContain('표시 이름')
    expect(markup).not.toContain('내 공개 프로필 보기')
  })

  it.each([
    ['authentication-required', '로그인이 필요합니다.'],
    ['forbidden', '관리할 권한이 없습니다.'],
    ['unavailable', '프로필이 없다는 뜻은 아닙니다.'],
  ] as const)('keeps %s distinct from a missing profile', (loadState, message) => {
    const markup = renderToStaticMarkup(<PublicProfileSettingsView workflow={workflow({ loadState })} />)
    expect(markup).toContain(message)
    expect(markup).not.toContain('아직 공개 프로필이 없습니다.')
    expect(markup).not.toContain('<form')
  })

  it('keeps an existing address immutable and links only to its confirmed public route', () => {
    const markup = renderToStaticMarkup(<PublicProfileSettingsView workflow={workflow({
      handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
      profile: { schemaVersion: 'public-profile-record.v1', handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
        createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' },
    })} />)
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*id="public-handle"/)
    expect(markup).toContain('href="/people/ramen-log"')
  })
})
