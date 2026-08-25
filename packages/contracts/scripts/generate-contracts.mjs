import { readFile, writeFile } from 'node:fs/promises'

import { buildContractArtifacts } from '../dist/generate.js'

const checkOnly = process.argv.includes('--check')
const failures = []

for (const [relativePath, generated] of buildContractArtifacts()) {
  const target = new URL(`../${relativePath}`, import.meta.url)
  if (checkOnly) {
    const current = await readFile(target, 'utf8').catch(() => undefined)
    if (current !== generated) failures.push(relativePath)
  } else {
    await writeFile(target, generated, 'utf8')
  }
}

if (failures.length > 0) {
  throw new Error(`Generated contract artifacts are stale: ${failures.join(', ')}`)
}
