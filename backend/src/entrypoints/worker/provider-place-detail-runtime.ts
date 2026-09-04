import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  createProviderPlaceDetailWorker,
  PostgresIngestionStore,
  PostgresProviderPlaceDetails,
  type IngestionStore,
  type ProviderPlaceDetailJobStore,
} from '../../modules/ingestion/index.js'
import {
  NaverTraceForgePlaceDetailSource,
  TraceForgeRunnerClient,
  type ForgeRecipeClient,
} from '../../modules/providers/index.js'
import type { ProviderDetailConfig } from './config.js'

export type { ProviderDetailConfig } from './config.js'

type ProviderDetailResources = Readonly<{
  ingestionStore: IngestionStore
  store: ProviderPlaceDetailJobStore
  close(): Promise<void>
}>

type RuntimeDependencies = Readonly<{
  createClient?: (config: ProviderDetailConfig) => Promise<ForgeRecipeClient & { close(): Promise<void> }>
  createResources?: (config: ProviderDetailConfig) => Promise<ProviderDetailResources>
  now?: () => Date
  workerId?: string
}>

async function createProductionResources(
  config: ProviderDetailConfig,
): Promise<ProviderDetailResources> {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  try {
    await pool.query('SELECT 1')
    return {
      ingestionStore: new PostgresIngestionStore(pool),
      store: new PostgresProviderPlaceDetails(pool),
      close: () => pool.end(),
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

async function createProductionClient(
  config: ProviderDetailConfig,
): Promise<TraceForgeRunnerClient> {
  return new TraceForgeRunnerClient({
    packFiles: [config.traceforge.naverPackFile],
    profilePrefix: 'naver-anonymous-',
    profileRoot: config.traceforge.profileRoot,
    runnerFile: config.traceforge.runnerFile,
  })
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function runProviderPlaceDetails(
  config: ProviderDetailConfig,
  input: Readonly<{ continuous: boolean; signal?: AbortSignal }>,
  dependencies: RuntimeDependencies = {},
) {
  const resources = await (dependencies.createResources?.(config) ?? createProductionResources(config))
  let client: (ForgeRecipeClient & { close(): Promise<void> }) | undefined
  try {
    client = await (dependencies.createClient?.(config) ?? createProductionClient(config))
    const worker = createProviderPlaceDetailWorker({
      workerId: dependencies.workerId ?? `place-provider-detail:${randomUUID()}`,
      store: resources.store,
      ingestionStore: resources.ingestionStore,
      sources: [new NaverTraceForgePlaceDetailSource({
        client,
        packId: 'naver',
        packVersion: config.traceforge.naverPackVersion,
        parserVersion: 'naver-place-detail-dom.v1',
        recipeId: 'map-place-detail-dom',
        ...(dependencies.now ? { now: dependencies.now } : {}),
      })],
      now: dependencies.now ?? (() => new Date()),
      leaseMilliseconds: config.leaseMilliseconds,
      maximumAttempts: config.maximumAttempts,
      retryBaseMilliseconds: config.retryBaseMilliseconds,
    })
    const signal = input.signal ?? new AbortController().signal
    let processed = 0
    let scheduled = 0
    const scheduleStale = async () => {
      const scheduledAt = (dependencies.now ?? (() => new Date()))()
      scheduled += await resources.store.scheduleStale({
        providerKeys: ['naver'],
        staleBefore: new Date(
          scheduledAt.getTime() - config.freshnessMilliseconds,
        ).toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        limit: config.refreshBatchSize,
      })
    }
    await scheduleStale()
    while (!signal.aborted && (input.continuous || processed < config.maximumJobs)) {
      const result = await worker.runOne(signal)
      if (result.status !== 'idle') {
        processed += 1
        continue
      }
      if (!input.continuous) return { processed, scheduled, stopped: 'idle' as const }
      await wait(config.idleMilliseconds, signal)
      if (!signal.aborted) await scheduleStale()
    }
    return {
      processed,
      scheduled,
      stopped: signal.aborted ? 'aborted' as const : 'limit' as const,
    }
  } finally {
    const failures: unknown[] = []
    if (client !== undefined) {
      try {
        await client.close()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await resources.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Provider detail runtime cleanup failed')
  }
}
