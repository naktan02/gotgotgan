import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { NaverSavedPlaceCollector } from '../../adapters/providers/naver/api/saved-place-collector.js'
import { PlaywrightAuthenticatedJsonSession } from '../../acquisition/adapters/playwright/playwright-authenticated-json-session.js'
import { PrivateObservationReportStore } from '../../observation/adapters/filesystem/private-observation-report-store.js'
import { PlaywrightMemberBrowser } from '../../observation/adapters/playwright/playwright-member-browser.js'
import { loadMemberConnectorConfig } from './config.js'
import { describeMemberConnector, runMemberConnectorCommand } from './run-command.js'

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

function selectedCommand(): '--check' | 'login-naver' | 'observe-naver' | 'collect-naver' {
  if (process.argv.length !== 3) throw new Error('Unsupported command')
  if (process.argv[2] === '--check') return '--check'
  if (process.argv[2] === '--login-naver') return 'login-naver'
  if (process.argv[2] === '--observe-naver') return 'observe-naver'
  if (process.argv[2] === '--collect-naver') return 'collect-naver'
  throw new Error('Unsupported command')
}

async function main(): Promise<void> {
  const command = selectedCommand()
  if (command === '--check') {
    process.stdout.write(`${JSON.stringify(describeMemberConnector())}\n`)
    return
  }
  const config = loadMemberConnectorConfig(command, process.env, repositoryRoot)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const browser = config.command === 'collect-naver'
      ? undefined
      : new PlaywrightMemberBrowser({
          profileRoot: config.profileRoot,
          observationMilliseconds: config.command === 'observe-naver'
            ? config.observationMilliseconds
            : 1,
        })
    const collector = config.command !== 'collect-naver'
      ? undefined
      : (() => {
          const savedPlaces = new NaverSavedPlaceCollector({
            apiBaseUrl: config.apiBaseUrl,
            folderPageSize: config.folderPageSize,
            bookmarkPageSize: config.bookmarkPageSize,
            maximumLists: config.maximumLists,
            maximumBookmarks: config.maximumBookmarks,
            maximumResponseBytes: config.maximumResponseBytes,
            delayMilliseconds: config.requestDelayMilliseconds,
          })
          const session = new PlaywrightAuthenticatedJsonSession({
            profileRoot: config.profileRoot,
            allowedOrigin: new URL(config.apiBaseUrl).origin,
            sessionUrl: config.sessionUrl,
            requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
          })
          return {
            collectAll: ({ signal }: Readonly<{ signal: AbortSignal }>) => session.use(
              (client) => savedPlaces.collectAll({ client, signal }),
            ),
          }
        })()
    const result = await runMemberConnectorCommand({
      config,
      ...(browser === undefined ? {} : { browser }),
      ...(collector === undefined ? {} : { collector }),
      ...(config.command === 'observe-naver'
        ? { reportStore: new PrivateObservationReportStore(config.reportRoot) }
        : {}),
      nextId: randomUUID,
      signal: controller.signal,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

const safeFailureMessages = new Set([
  'NAVER saved-place collection requires user action',
  'NAVER saved-place collection is temporarily unavailable',
  'NAVER saved-place response schema changed',
  'NAVER saved-place collection exceeded configured limits',
  'Authenticated member request is invalid',
  'Authenticated member response is too large',
])

await main().catch((error: unknown) => {
  const message = error instanceof Error && safeFailureMessages.has(error.message)
    ? `: ${error.message}`
    : ''
  process.stderr.write(`Place member connector command failed${message}\n`)
  process.exitCode = 1
})
