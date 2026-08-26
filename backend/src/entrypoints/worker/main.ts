type WorkerCheck = Readonly<{
  process: 'acquisition-worker'
  service: 'place'
  state: 'source-only'
  capabilities: readonly [
    'durable-import-queue',
    'cache-first-place-fulfillment',
    'naver-capture-parser',
    'encrypted-capture-replay',
    'capture-expiry-sweep',
  ]
  liveAcquisition: 'integration-gated'
}>

function describeWorkerScaffold(): WorkerCheck {
  return {
    process: 'acquisition-worker',
    service: 'place',
    state: 'source-only',
    capabilities: [
      'durable-import-queue',
      'cache-first-place-fulfillment',
      'naver-capture-parser',
      'encrypted-capture-replay',
      'capture-expiry-sweep',
    ],
    liveAcquisition: 'integration-gated',
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    process.stdout.write(`${JSON.stringify(describeWorkerScaffold())}\n`)
    return
  }
  if (process.argv.includes('--sweep-expired-captures')) {
    const [{ loadCaptureSweepConfig }, { runCaptureExpirySweep }] = await Promise.all([
      import('./config.js'),
      import('./capture-sweep-runtime.js'),
    ])
    const result = await runCaptureExpirySweep(await loadCaptureSweepConfig(process.env))
    process.stdout.write(`${JSON.stringify({ operation: 'capture-expiry-sweep', ...result })}\n`)
    if (result.failed > 0) throw new Error('Capture expiry sweep did not complete')
    return
  }
  throw new Error('Live provider acquisition is integration-gated')
}

await main().catch(() => {
  process.stderr.write('Place worker command failed\n')
  process.exitCode = 1
})
