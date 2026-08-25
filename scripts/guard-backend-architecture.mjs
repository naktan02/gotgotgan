import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const sourceRoot = path.resolve('backend/src')
const forbiddenBuckets = ['controllers', 'services', 'repositories']
const violations = []

async function files(directory) {
  const entries = await readdir(directory)
  const result = []
  for (const entry of entries) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...await files(target))
    else if (entry.endsWith('.ts')) result.push(target)
  }
  return result
}

for (const bucket of forbiddenBuckets) {
  try {
    if ((await stat(path.join(sourceRoot, bucket))).isDirectory()) {
      violations.push(`forbidden backend bucket: ${bucket}`)
    }
  } catch {}
}

for (const file of await files(sourceRoot)) {
  const relative = path.relative(sourceRoot, file).replaceAll('\\', '/')
  const source = await readFile(file, 'utf8')
  if (relative.startsWith('modules/') && /from\s+['"][^'"]*entrypoints\//.test(source)) {
    violations.push(`${relative}: a module cannot import a process entrypoint`)
  }
  if (/\/domain\//.test(`/${relative}`) && /from\s+['"][^'"]*\/(application|adapters|transport|platform)\//.test(source)) {
    violations.push(`${relative}: domain code cannot import an outer implementation layer`)
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Backend architecture boundaries are valid.\n')
