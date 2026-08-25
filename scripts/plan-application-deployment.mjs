const operationPattern = /^(activate|rollback)$/
const releaseRevisionPattern = /^place@[0-9a-f]{40}$/
const immutableImagePattern =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/

function required(environment, name, pattern) {
  const value = environment[name]
  if (value === undefined || !pattern.test(value)) {
    throw new Error('Application deployment input is invalid')
  }
  return value
}

function plan(environment) {
  const operation = required(
    environment,
    'PLACE_DEPLOYMENT_OPERATION',
    operationPattern,
  )
  const releaseRevision = required(
    environment,
    'PLACE_RELEASE_REVISION',
    releaseRevisionPattern,
  )
  const webImage = required(
    environment,
    'PLACE_WEB_IMAGE',
    immutableImagePattern,
  )
  const backendImage = required(
    environment,
    'PLACE_BACKEND_IMAGE',
    immutableImagePattern,
  )
  if (webImage === backendImage) {
    throw new Error('Application deployment input is invalid')
  }

  let replaces
  if (operation === 'rollback') {
    const deployedReleaseRevision = required(
      environment,
      'PLACE_DEPLOYED_RELEASE_REVISION',
      releaseRevisionPattern,
    )
    const deployedWebImage = required(
      environment,
      'PLACE_DEPLOYED_WEB_IMAGE',
      immutableImagePattern,
    )
    const deployedBackendImage = required(
      environment,
      'PLACE_DEPLOYED_BACKEND_IMAGE',
      immutableImagePattern,
    )
    if (
      deployedReleaseRevision === releaseRevision ||
      (deployedWebImage === webImage && deployedBackendImage === backendImage)
    ) {
      throw new Error('Application deployment input is invalid')
    }
    replaces = {
      releaseRevision: deployedReleaseRevision,
      images: { web: deployedWebImage, backend: deployedBackendImage },
    }
  }

  return {
    schemaVersion: 'place-application-deployment-plan.v1',
    deliveryState: 'source-only',
    operation,
    releaseRevision,
    images: { web: webImage, backend: backendImage },
    ...(replaces === undefined ? {} : { replaces }),
    publicProcess: 'web',
    database: {
      preparation: 'operator-pre-runtime',
      rollback: 'application-only',
    },
  }
}

try {
  process.stdout.write(`${JSON.stringify(plan(process.env), null, 2)}\n`)
} catch {
  process.stderr.write('Application deployment input is invalid\n')
  process.exitCode = 1
}
