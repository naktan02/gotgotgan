export const areaKinds = [
  'country',
  'administrative-area',
  'locality',
  'neighborhood',
  'custom',
] as const

export type AreaKind = (typeof areaKinds)[number]

export type AreaName = Readonly<{
  languageTag: string
  name: string
}>

export type AreaNodeVersion = Readonly<{
  key: string
  version: number
  parentKey: string | null
  countryCode: string
  kind: AreaKind
  names: readonly AreaName[]
  defaultLanguageTag: string
  active: boolean
  effectiveAt: string
  fingerprint: string
}>

export type AreaNode = Omit<AreaNodeVersion, 'active' | 'effectiveAt' | 'fingerprint'>

export class InvalidAreaNodeError extends Error {
  override readonly name = 'InvalidAreaNodeError'
}

export class AreaVersionConflictError extends Error {
  override readonly name = 'AreaVersionConflictError'
}

export class AreaParentUnavailableError extends Error {
  override readonly name = 'AreaParentUnavailableError'
}

export class AreaHierarchyCycleError extends Error {
  override readonly name = 'AreaHierarchyCycleError'
}

const languageTagPattern = /^(?:und|[A-Za-z]{2,3})(?:-[A-Za-z0-9]{2,8})*$/
const fingerprintPattern = /^[a-f0-9]{64}$/
const areaKeyPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/

export function assertAreaNodeVersion(node: AreaNodeVersion): void {
  const languages = node.names.map((name) => name.languageTag.toLowerCase())
  if (
    !areaKeyPattern.test(node.key) ||
    !Number.isInteger(node.version) || node.version < 1 ||
    node.parentKey === node.key ||
    (node.parentKey !== null && !areaKeyPattern.test(node.parentKey)) ||
    !/^[A-Z]{2}$/.test(node.countryCode) ||
    !areaKinds.includes(node.kind) ||
    node.names.length < 1 || node.names.length > 32 ||
    new Set(languages).size !== languages.length ||
    !languageTagPattern.test(node.defaultLanguageTag) ||
    !languages.includes(node.defaultLanguageTag.toLowerCase()) ||
    node.names.some(({ languageTag, name }) => (
      !languageTagPattern.test(languageTag) ||
      name.trim().length < 1 || name.length > 160
    )) ||
    !Number.isFinite(Date.parse(node.effectiveAt)) ||
    !fingerprintPattern.test(node.fingerprint)
  ) {
    throw new InvalidAreaNodeError('Area node version is invalid.')
  }
  if ((node.kind === 'country') !== (node.parentKey === null)) {
    throw new InvalidAreaNodeError('Only a country Area may omit its parent.')
  }
}
