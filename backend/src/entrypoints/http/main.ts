import { buildHttpApplication } from './app.js'
import { readHttpRuntimeConfig } from './config.js'

const config = readHttpRuntimeConfig(process.env)
const application = buildHttpApplication()

const close = async (): Promise<void> => {
  await application.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

await application.listen(config)
