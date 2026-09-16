import { createHash } from 'node:crypto'

import type {
  ForgeRecipeClient,
  ForgeRecipeResult,
} from '../traceforge/runner-client.js'

export type NaverTraceForgePlaceDetailSourceOptions = Readonly<{
  client: ForgeRecipeClient
  now?: () => Date
  packId: string
  packVersion: string
  parserVersion: string
  recipeId: string
}>

type ProviderDetailFailureCode =
  | 'provider-rate-limited'
  | 'provider-unavailable'
  | 'provider-interaction-required'
  | 'provider-parser-drift'

type ProviderPlaceDetailResult =
  | Readonly<{
      kind: 'available'
      detail: Readonly<{
        acquisitionKind: 'browser-dom'
        payloadChecksum: string
        parserVersion: string
        observedAt: string
        name: string
        address: string | null
        categoryLabel: null
        location: null
        attributes: Readonly<Record<string, unknown>>
        confidence: number
      }>
    }>
  | Readonly<{
      kind: 'failure'
      code: ProviderDetailFailureCode
      retryable: boolean
    }>

export class NaverTraceForgePlaceDetailSource {
  readonly providerKey = 'naver' as const
  readonly #client: ForgeRecipeClient
  readonly #now: () => Date
  readonly #packId: string
  readonly #packVersion: string
  readonly #parserVersion: string
  readonly #recipeId: string

  constructor(options: NaverTraceForgePlaceDetailSourceOptions) {
    if (
      !identifier(options.packId) ||
      !version(options.packVersion) ||
      !identifier(options.recipeId) ||
      !identifier(options.parserVersion)
    ) throw new Error('NAVER TraceForge detail source configuration is invalid.')
    this.#client = options.client
    this.#now = options.now ?? (() => new Date())
    this.#packId = options.packId
    this.#packVersion = options.packVersion
    this.#parserVersion = options.parserVersion
    this.#recipeId = options.recipeId
  }

  async fetch(input: Readonly<{
    providerPlaceId: string
    signal: AbortSignal
  }>): Promise<ProviderPlaceDetailResult> {
    if (input.signal.aborted) return providerFailure('provider-unavailable', true)
    let result: ForgeRecipeResult
    try {
      result = await this.#client.run({
        inputs: { 'place-id': input.providerPlaceId },
        packId: this.#packId,
        packVersion: this.#packVersion,
        recipeId: this.#recipeId,
        version: 1,
      }, input.signal)
    } catch {
      return providerFailure('provider-unavailable', true)
    }
    if (input.signal.aborted) return providerFailure('provider-unavailable', true)
    if (result.state !== 'succeeded') return mapFailure(result.code)

    const detail = readDetail(result.outputs)
    if (detail === undefined) return providerFailure('provider-parser-drift', false)
    const observedAt = this.#now().toISOString()
    const normalized = {
      address: detail.address,
      contentLines: detail.contentLines,
      homepage: detail.homepage,
      images: detail.images,
      name: detail.name,
      openingDetail: detail.openingDetail,
      openingStatus: detail.openingStatus,
      phone: detail.phone,
      primaryImage: detail.primaryImage,
      summary: detail.summary,
    }
    return {
      kind: 'available',
      detail: {
        acquisitionKind: 'browser-dom',
        payloadChecksum: checksum(normalized),
        parserVersion: this.#parserVersion,
        observedAt,
        name: detail.name,
        address: detail.address,
        categoryLabel: null,
        location: null,
        attributes: normalized,
        confidence: detail.address === null ? 0.7 : 0.85,
      },
    }
  }
}

type NormalizedDetail = Readonly<{
  address: string | null
  contentLines: readonly string[]
  homepage: string | null
  images: readonly string[]
  name: string
  openingDetail: string | null
  openingStatus: string | null
  phone: string | null
  primaryImage: string | null
  summary: string | null
}>

function readDetail(outputs: Readonly<Record<string, unknown>>): NormalizedDetail | undefined {
  const name = boundedString(outputs.name, 1, 300)
  if (name === undefined) return undefined
  const address = nullableString(outputs.address, 500)
  const openingStatus = nullableString(outputs['opening-status'], 256)
  const openingDetail = nullableString(outputs['opening-detail'], 256)
  const rawPhone = nullableString(outputs.phone, 256)
  const phone = rawPhone?.replace(/\s*복사$/, '') || null
  const homepage = nullableUrl(outputs.homepage)
  const primaryImage = nullableUrl(outputs['primary-image'])
  const summary = nullableString(outputs.summary, 1_024)
  const images = stringList(outputs.images, 100, 2_048, true)
  const contentLines = stringList(outputs['content-lines'], 256, 1_024, false)
  if (
    address === undefined ||
    openingStatus === undefined ||
    openingDetail === undefined ||
    rawPhone === undefined ||
    homepage === undefined ||
    primaryImage === undefined ||
    summary === undefined ||
    images === undefined ||
    contentLines === undefined
  ) return undefined
  return {
    address,
    contentLines,
    homepage,
    images,
    name,
    openingDetail,
    openingStatus,
    phone,
    primaryImage,
    summary,
  }
}

function mapFailure(code: string): ProviderPlaceDetailResult {
  if (code === 'rate-limited') return providerFailure('provider-rate-limited', true)
  if (['source-unavailable', 'timed-out'].includes(code)) {
    return providerFailure('provider-unavailable', true)
  }
  if (code === 'challenge-required') {
    return providerFailure('provider-interaction-required', false)
  }
  if (['access-denied', 'state-change-not-approved'].includes(code)) {
    return providerFailure('provider-unavailable', false)
  }
  return providerFailure('provider-parser-drift', false)
}

function providerFailure(
  code: ProviderDetailFailureCode,
  retryable: boolean,
): ProviderPlaceDetailResult {
  return { code, kind: 'failure', retryable }
}

function boundedString(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
    ? value
    : undefined
}

function nullableString(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null) return null
  return boundedString(value, 1, maximum)
}

function nullableUrl(value: unknown): string | null | undefined {
  const text = nullableString(value, 2_048)
  if (text === undefined || text === null) return text
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) ? text : undefined
  } catch {
    return undefined
  }
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  urls: boolean,
): readonly string[] | undefined {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximumItems) return undefined
  const result: string[] = []
  for (const item of value) {
    const text = boundedString(item, 1, maximumLength)
    if (text === undefined) return undefined
    if (urls && nullableUrl(text) === undefined) return undefined
    result.push(text)
  }
  return result
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]))
  }
  return value
}

function identifier(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(value)
}

function version(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(value)
}
