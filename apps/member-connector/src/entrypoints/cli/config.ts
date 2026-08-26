import { isAbsolute, relative, resolve, sep } from 'node:path'

import { z } from 'zod'

const profileEnvironmentSchema = z.object({
  PLACE_MEMBER_CONNECTOR_PROFILE_ROOT: z.string().min(1),
})

const commonEnvironmentSchema = profileEnvironmentSchema.extend({
  PLACE_NAVER_MEMBER_URL: z.string().min(1),
})

const observationEnvironmentSchema = commonEnvironmentSchema.extend({
  PLACE_MEMBER_CONNECTOR_REPORT_ROOT: z.string().min(1),
  PLACE_NAVER_OBSERVATION_ORIGINS: z.string().min(1),
  PLACE_NAVER_OBSERVATION_REQUEST_URL: z.string().min(1).optional(),
  PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS: z.coerce
    .number().int().min(5_000).max(600_000),
  PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES: z.coerce
    .number().int().min(1_024).max(1_048_576),
})

const collectionEnvironmentSchema = profileEnvironmentSchema.extend({
  PLACE_NAVER_MEMBER_API_BASE_URL: z.string().min(1),
  PLACE_NAVER_MEMBER_SESSION_URL: z.string().min(1),
  PLACE_MEMBER_CONNECTOR_REQUEST_TIMEOUT_MILLISECONDS: z.coerce
    .number().int().min(1_000).max(120_000),
  PLACE_MEMBER_CONNECTOR_MAXIMUM_RESPONSE_BYTES: z.coerce
    .number().int().min(1_024).max(16_777_216),
  PLACE_MEMBER_CONNECTOR_FOLDER_PAGE_SIZE: z.coerce.number().int().min(1).max(100),
  PLACE_MEMBER_CONNECTOR_BOOKMARK_PAGE_SIZE: z.coerce.number().int().min(1).max(5_000),
  PLACE_MEMBER_CONNECTOR_MAXIMUM_LISTS: z.coerce.number().int().min(1).max(1_000),
  PLACE_MEMBER_CONNECTOR_MAXIMUM_BOOKMARKS: z.coerce.number().int().min(1).max(200_000),
  PLACE_MEMBER_CONNECTOR_REQUEST_DELAY_MILLISECONDS: z.coerce
    .number().int().min(0).max(10_000),
})

export type MemberConnectorConfig =
  | Readonly<{
      command: 'login-naver'
      providerKey: 'naver'
      profileRoot: string
      targetUrl: string
    }>
  | Readonly<{
      command: 'observe-naver'
      providerKey: 'naver'
      profileRoot: string
      reportRoot: string
      targetUrl: string
      requestUrl?: string
      allowedOrigins: readonly string[]
      observationMilliseconds: number
      maximumBodyBytes: number
    }>
  | Readonly<{
      command: 'collect-naver'
      providerKey: 'naver'
      profileRoot: string
      apiBaseUrl: string
      sessionUrl: string
      requestTimeoutMilliseconds: number
      maximumResponseBytes: number
      folderPageSize: number
      bookmarkPageSize: number
      maximumLists: number
      maximumBookmarks: number
      requestDelayMilliseconds: number
    }>

function configurationError(): Error {
  return new Error('Member connector configuration is invalid')
}

function outsideRepository(value: string, repositoryRoot: string): string {
  if (!isAbsolute(value)) throw configurationError()
  const absolute = resolve(value)
  const relation = relative(resolve(repositoryRoot), absolute)
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))) {
    throw configurationError()
  }
  return absolute
}

function naverUrl(value: string, allowSearch = false): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
    (!allowSearch && url.search !== '') || url.hash !== '' ||
    (hostname !== 'naver.com' && !hostname.endsWith('.naver.com'))
  ) throw configurationError()
  return url
}

function naverObservationUrl(value: string): URL {
  const url = naverUrl(value, true)
  if (url.search === '') return url
  const allowed = new Set(['start', 'limit', 'sort', 'folderType'])
  const entries = [...url.searchParams.entries()]
  if (
    entries.length === 0 || entries.some(([key]) => !allowed.has(key)) ||
    new Set(entries.map(([key]) => key)).size !== entries.length ||
    (url.searchParams.has('start') && !/^\d{1,9}$/.test(url.searchParams.get('start') ?? '')) ||
    (url.searchParams.has('limit') && !/^\d{1,5}$/.test(url.searchParams.get('limit') ?? '')) ||
    (url.searchParams.has('sort') && url.searchParams.get('sort') !== 'lastUseTime') ||
    (url.searchParams.has('folderType') && !new Set(['all', 'my']).has(url.searchParams.get('folderType') ?? ''))
  ) throw configurationError()
  return url
}

function observationOrigins(value: string): readonly string[] {
  const origins = value.split(',').map((entry) => entry.trim())
  if (origins.length === 0 || origins.length > 16 || origins.some((entry) => entry === '')) {
    throw configurationError()
  }
  const normalized = origins.map((entry) => {
    const url = naverUrl(entry)
    if (url.pathname !== '/' || entry !== url.origin) throw configurationError()
    return url.origin
  })
  if (new Set(normalized).size !== normalized.length) throw configurationError()
  return normalized
}

function naverApiBaseUrl(value: string): string {
  const url = naverUrl(value)
  if (!url.pathname.endsWith('/')) throw configurationError()
  return url.toString()
}

export function loadMemberConnectorConfig(
  command: 'login-naver' | 'observe-naver' | 'collect-naver',
  environment: NodeJS.ProcessEnv,
  repositoryRoot: string,
): MemberConnectorConfig {
  try {
    if (command === 'login-naver') {
      const values = commonEnvironmentSchema.parse(environment)
      return {
        command,
        providerKey: 'naver',
        profileRoot: outsideRepository(values.PLACE_MEMBER_CONNECTOR_PROFILE_ROOT, repositoryRoot),
        targetUrl: naverUrl(values.PLACE_NAVER_MEMBER_URL).toString(),
      }
    }
    if (command === 'collect-naver') {
      const values = collectionEnvironmentSchema.parse(environment)
      const apiBaseUrl = naverApiBaseUrl(values.PLACE_NAVER_MEMBER_API_BASE_URL)
      const sessionUrl = naverUrl(values.PLACE_NAVER_MEMBER_SESSION_URL).toString()
      if (new URL(apiBaseUrl).origin !== new URL(sessionUrl).origin) throw configurationError()
      return {
        command,
        providerKey: 'naver',
        profileRoot: outsideRepository(values.PLACE_MEMBER_CONNECTOR_PROFILE_ROOT, repositoryRoot),
        apiBaseUrl,
        sessionUrl,
        requestTimeoutMilliseconds: values.PLACE_MEMBER_CONNECTOR_REQUEST_TIMEOUT_MILLISECONDS,
        maximumResponseBytes: values.PLACE_MEMBER_CONNECTOR_MAXIMUM_RESPONSE_BYTES,
        folderPageSize: values.PLACE_MEMBER_CONNECTOR_FOLDER_PAGE_SIZE,
        bookmarkPageSize: values.PLACE_MEMBER_CONNECTOR_BOOKMARK_PAGE_SIZE,
        maximumLists: values.PLACE_MEMBER_CONNECTOR_MAXIMUM_LISTS,
        maximumBookmarks: values.PLACE_MEMBER_CONNECTOR_MAXIMUM_BOOKMARKS,
        requestDelayMilliseconds: values.PLACE_MEMBER_CONNECTOR_REQUEST_DELAY_MILLISECONDS,
      }
    }
    const values = observationEnvironmentSchema.parse(environment)
    const profileRoot = outsideRepository(
      values.PLACE_MEMBER_CONNECTOR_PROFILE_ROOT,
      repositoryRoot,
    )
    const reportRoot = outsideRepository(values.PLACE_MEMBER_CONNECTOR_REPORT_ROOT, repositoryRoot)
    const profileToReport = relative(profileRoot, reportRoot)
    const reportToProfile = relative(reportRoot, profileRoot)
    if (
      profileToReport === '' ||
      (!profileToReport.startsWith(`..${sep}`) && !isAbsolute(profileToReport)) ||
      (!reportToProfile.startsWith(`..${sep}`) && !isAbsolute(reportToProfile))
    ) throw configurationError()
    const targetUrl = naverObservationUrl(values.PLACE_NAVER_MEMBER_URL).toString()
    const requestUrl = values.PLACE_NAVER_OBSERVATION_REQUEST_URL === undefined
      ? undefined
      : naverObservationUrl(values.PLACE_NAVER_OBSERVATION_REQUEST_URL).toString()
    if (requestUrl !== undefined && new URL(requestUrl).origin !== new URL(targetUrl).origin) {
      throw configurationError()
    }
    return {
      command,
      providerKey: 'naver',
      profileRoot,
      reportRoot,
      targetUrl,
      ...(requestUrl === undefined ? {} : { requestUrl }),
      allowedOrigins: observationOrigins(values.PLACE_NAVER_OBSERVATION_ORIGINS),
      observationMilliseconds: values.PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS,
      maximumBodyBytes: values.PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES,
    }
  } catch {
    throw configurationError()
  }
}
