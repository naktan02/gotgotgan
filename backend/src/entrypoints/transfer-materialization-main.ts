import {
  runTransferMaterialization,
} from './transfer-materialization-runtime.js'
import { loadTransferMaterializationConfig } from './worker/config.js'

type TransferMaterializationCheck = Readonly<{
  process: 'transfer-materialization-worker'
  service: 'place'
  state: 'source-only'
  capability: 'approved-transfer-materialization'
}>

function describeWorker(): TransferMaterializationCheck {
  return {
    process: 'transfer-materialization-worker',
    service: 'place',
    state: 'source-only',
    capability: 'approved-transfer-materialization',
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    process.stdout.write(`${JSON.stringify(describeWorker())}\n`)
    return
  }

  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const config = await loadTransferMaterializationConfig(process.env)
    const result = await runTransferMaterialization(config, {
      continuous: !process.argv.includes('--once'),
      signal: controller.signal,
    })
    process.stdout.write(`${JSON.stringify({ operation: 'transfer-materialization', ...result })}\n`)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

await main().catch(() => {
  process.stderr.write('Transfer materialization worker failed\n')
  process.exitCode = 1
})
