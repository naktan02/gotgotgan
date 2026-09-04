import {
  loadTransferWorkerConfig,
  runTransferMaterialization,
} from './transfer-materialization-runtime.js'

const controller = new AbortController()
const stop = () => controller.abort()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

try {
  const result = await runTransferMaterialization(loadTransferWorkerConfig(process.env), {
    continuous: !process.argv.includes('--once'),
    signal: controller.signal,
  })
  process.stdout.write(`${JSON.stringify({ operation: 'transfer-materialization', ...result })}\n`)
} catch {
  process.stderr.write('Transfer materialization worker failed\n')
  process.exitCode = 1
} finally {
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}
