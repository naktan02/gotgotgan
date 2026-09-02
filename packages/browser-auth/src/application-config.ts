export type BrowserAuthApplicationConfig = Readonly<{
  storageNamespace: string
  environmentPrefix: string
  transactionCookieName: string
  sessionCookieName: string
  lifecycleKey: string
}>

const storageNamespacePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const environmentPrefixPattern = /^[A-Z][A-Z0-9_]{0,63}$/
const hostCookieNamePattern = /^__Host-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const lifecycleKeyPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

function invalidApplicationConfig(): Error {
  return new Error('Browser authentication application configuration is invalid')
}

export function defineBrowserAuthApplication(
  config: BrowserAuthApplicationConfig,
): BrowserAuthApplicationConfig {
  if (
    config.storageNamespace.length > 128 ||
    !storageNamespacePattern.test(config.storageNamespace) ||
    !environmentPrefixPattern.test(config.environmentPrefix) ||
    !hostCookieNamePattern.test(config.transactionCookieName) ||
    !hostCookieNamePattern.test(config.sessionCookieName) ||
    config.transactionCookieName === config.sessionCookieName ||
    config.lifecycleKey.length > 128 ||
    !lifecycleKeyPattern.test(config.lifecycleKey)
  ) {
    throw invalidApplicationConfig()
  }
  return Object.freeze({ ...config })
}

export function browserAuthEnvironmentName(
  application: BrowserAuthApplicationConfig,
  suffix: string,
): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(suffix)) throw invalidApplicationConfig()
  return `${application.environmentPrefix}_${suffix}`
}
