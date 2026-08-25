type WorkerCheck = Readonly<{
  process: 'acquisition-worker'
  service: 'place'
  state: 'not-integrated'
}>

function describeWorkerScaffold(): WorkerCheck {
  return {
    process: 'acquisition-worker',
    service: 'place',
    state: 'not-integrated',
  }
}

if (process.argv.includes('--check')) {
  process.stdout.write(`${JSON.stringify(describeWorkerScaffold())}\n`)
} else {
  throw new Error('No acquisition job handlers exist in Stage 1; run with --check only.')
}
