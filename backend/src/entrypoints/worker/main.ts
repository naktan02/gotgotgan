type WorkerCheck = Readonly<{
  process: 'acquisition-worker'
  service: 'place'
  state: 'source-only'
  capabilities: readonly [
    'durable-import-queue',
    'cache-first-place-fulfillment',
    'source-snapshot-place-materialization',
    'provider-detail-pending-state',
    'provider-detail-job-orchestration',
    'traceforge-runner-provider-detail',
    'naver-capture-parser',
    'encrypted-capture-replay',
    'capture-expiry-sweep',
    'naver-shared-link-acquisition',
  ]
  liveAcquisition: 'configuration-gated'
}>

function describeWorkerScaffold(): WorkerCheck {
  return {
    process: 'acquisition-worker',
    service: 'place',
    state: 'source-only',
    capabilities: [
      'durable-import-queue',
      'cache-first-place-fulfillment',
      'source-snapshot-place-materialization',
      'provider-detail-pending-state',
      'provider-detail-job-orchestration',
      'traceforge-runner-provider-detail',
      'naver-capture-parser',
      'encrypted-capture-replay',
      'capture-expiry-sweep',
      'naver-shared-link-acquisition',
    ],
    liveAcquisition: 'configuration-gated',
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
  if (
    process.argv.includes('--process-web-import-acquisitions') ||
    process.argv.includes('--run-web-import-acquisitions')
  ) {
    const continuous = process.argv.includes('--run-web-import-acquisitions')
    const [{ loadWebImportAcquisitionConfig }, { runWebImportAcquisitions }] = await Promise.all([
      import('./config.js'),
      import('./web-import-acquisition-runtime.js'),
    ])
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      const result = await runWebImportAcquisitions(
        await loadWebImportAcquisitionConfig(process.env),
        { continuous, signal: controller.signal },
      )
      process.stdout.write(`${JSON.stringify({ operation: 'web-import-acquisition', ...result })}\n`)
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    return
  }
  if (
    process.argv.includes('--materialize-imported-places') ||
    process.argv.includes('--run-import-materialization')
  ) {
    const continuous = process.argv.includes('--run-import-materialization')
    const [{ loadImportMaterializationConfig }, { runImportMaterialization }] = await Promise.all([
      import('./config.js'),
      import('./import-materialization-runtime.js'),
    ])
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      const result = await runImportMaterialization(
        await loadImportMaterializationConfig(process.env),
        { continuous, signal: controller.signal },
      )
      process.stdout.write(`${JSON.stringify({ operation: 'import-materialization', ...result })}\n`)
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    return
  }
  if (
    process.argv.includes('--process-provider-place-details') ||
    process.argv.includes('--run-provider-place-details')
  ) {
    const continuous = process.argv.includes('--run-provider-place-details')
    const [{ loadProviderDetailConfig }, { runProviderPlaceDetails }] = await Promise.all([
      import('./config.js'),
      import('./provider-place-detail-runtime.js'),
    ])
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      const result = await runProviderPlaceDetails(
        await loadProviderDetailConfig(process.env),
        { continuous, signal: controller.signal },
      )
      process.stdout.write(`${JSON.stringify({ operation: 'provider-place-details', ...result })}\n`)
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    return
  }
  throw new Error('Live provider acquisition is integration-gated')
}

await main().catch(() => {
  process.stderr.write('Place worker command failed\n')
  process.exitCode = 1
})
