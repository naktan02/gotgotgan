type WorkerCheck = Readonly<{
  process: 'acquisition-worker'
  service: 'place'
  state: 'source-only'
  capabilities: readonly ['durable-import-queue', 'naver-capture-parser', 'encrypted-capture-replay']
  liveAcquisition: 'integration-gated'
}>

function describeWorkerScaffold(): WorkerCheck {
  return {
    process: 'acquisition-worker',
    service: 'place',
    state: 'source-only',
    capabilities: [
      'durable-import-queue',
      'naver-capture-parser',
      'encrypted-capture-replay',
    ],
    liveAcquisition: 'integration-gated',
  }
}

if (process.argv.includes('--check')) {
  process.stdout.write(`${JSON.stringify(describeWorkerScaffold())}\n`)
} else {
  throw new Error('Live provider acquisition is integration-gated; run with --check only.')
}
