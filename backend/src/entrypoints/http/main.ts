import { buildHttpApplication } from './app.js'
import {
  loadProductionHttpConfig,
  readHttpProcessMode,
  readHttpRuntimeConfig,
} from './config.js'
import { createProductionHttpRuntime } from './production-runtime.js'

const mode = readHttpProcessMode(process.env)
const runtime =
  mode === 'production'
    ? await createProductionHttpRuntime(
        await loadProductionHttpConfig(process.env),
      )
    : (() => {
        const application = buildHttpApplication()
        const listener = readHttpRuntimeConfig(process.env)
        return {
          listen: () => application.listen(listener),
          close: () => application.close(),
        }
      })()

const close = async (): Promise<void> => {
  await runtime.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

try {
  await runtime.listen()
} catch (error) {
  await runtime.close().catch(() => undefined)
  throw error
}
