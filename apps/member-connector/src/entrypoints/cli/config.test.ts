import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { loadMemberConnectorConfig } from './config.js'

const repositoryRoot = join(tmpdir(), 'place-source')
const profileRoot = join(tmpdir(), 'place-member-connector-profile')
const reportRoot = join(tmpdir(), 'place-member-connector-reports')

describe('member connector configuration', () => {
  it('loads bounded NAVER full-collection settings without a repository-local data path', () => {
    expect(loadMemberConnectorConfig('collect-naver', {
      PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: profileRoot,
      PLACE_NAVER_MEMBER_API_BASE_URL: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      PLACE_NAVER_MEMBER_SESSION_URL: 'https://pages.map.naver.com/save-pages/pc/all-list',
      PLACE_MEMBER_CONNECTOR_REQUEST_TIMEOUT_MILLISECONDS: '15000',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_RESPONSE_BYTES: '8388608',
      PLACE_MEMBER_CONNECTOR_FOLDER_PAGE_SIZE: '20',
      PLACE_MEMBER_CONNECTOR_BOOKMARK_PAGE_SIZE: '500',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_LISTS: '500',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_BOOKMARKS: '100000',
      PLACE_MEMBER_CONNECTOR_REQUEST_DELAY_MILLISECONDS: '100',
    }, repositoryRoot)).toEqual({
      command: 'collect-naver',
      providerKey: 'naver',
      profileRoot,
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      sessionUrl: 'https://pages.map.naver.com/save-pages/pc/all-list',
      requestTimeoutMilliseconds: 15_000,
      maximumResponseBytes: 8_388_608,
      folderPageSize: 20,
      bookmarkPageSize: 500,
      maximumLists: 500,
      maximumBookmarks: 100_000,
      requestDelayMilliseconds: 100,
    })
  })

  it('accepts only explicit Naver targets and private roots outside the repository', () => {
    expect(loadMemberConnectorConfig('observe-naver', {
      PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: profileRoot,
      PLACE_MEMBER_CONNECTOR_REPORT_ROOT: reportRoot,
      PLACE_NAVER_MEMBER_URL: 'https://map.naver.com/',
      PLACE_NAVER_OBSERVATION_ORIGINS: 'https://map.naver.com,https://pcmap-api.place.naver.com',
      PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS: '120000',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES: '65536',
    }, repositoryRoot)).toEqual({
      command: 'observe-naver',
      providerKey: 'naver',
      profileRoot,
      reportRoot,
      targetUrl: 'https://map.naver.com/',
      allowedOrigins: ['https://map.naver.com', 'https://pcmap-api.place.naver.com'],
      observationMilliseconds: 120_000,
      maximumBodyBytes: 65_536,
    })
  })

  it('allows only non-sensitive pagination query keys for an observation target', () => {
    const config = loadMemberConnectorConfig('observe-naver', {
      PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: profileRoot,
      PLACE_MEMBER_CONNECTOR_REPORT_ROOT: reportRoot,
      PLACE_NAVER_MEMBER_URL: 'https://pages.map.naver.com/save-pages/pc/all-list',
      PLACE_NAVER_OBSERVATION_REQUEST_URL: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/folders?start=0&limit=20&sort=lastUseTime&folderType=all',
      PLACE_NAVER_OBSERVATION_ORIGINS: 'https://pages.map.naver.com',
      PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS: '10000',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES: '1048576',
    }, repositoryRoot)
    expect(config).toMatchObject({
      command: 'observe-naver',
      requestUrl: expect.stringContaining('start=0'),
    })
  })

  it.each([
    { PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: join(repositoryRoot, '.profile') },
    { PLACE_MEMBER_CONNECTOR_REPORT_ROOT: join(repositoryRoot, '.reports') },
    { PLACE_NAVER_MEMBER_URL: 'https://user:password@map.naver.com/' },
    { PLACE_NAVER_MEMBER_URL: 'https://map.naver.com/?token=secret' },
    { PLACE_NAVER_OBSERVATION_ORIGINS: 'https://example.com' },
  ])('rejects repository-local state, URL credentials, query data, and non-Naver origins', (override) => {
    expect(() => loadMemberConnectorConfig('observe-naver', {
      PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: profileRoot,
      PLACE_MEMBER_CONNECTOR_REPORT_ROOT: reportRoot,
      PLACE_NAVER_MEMBER_URL: 'https://map.naver.com/',
      PLACE_NAVER_OBSERVATION_ORIGINS: 'https://map.naver.com',
      PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS: '120000',
      PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES: '65536',
      ...override,
    }, repositoryRoot)).toThrow('Member connector configuration is invalid')
  })
})
