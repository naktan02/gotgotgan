import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const forbiddenFolders = new Set(['common', 'helpers', 'misc', 'utils'])
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g

async function files(directory) {
  const result = []
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name)
    if ((await stat(target)).isDirectory()) result.push(...await files(target))
    else if (name.endsWith('.ts')) result.push(target)
  }
  return result
}

function relative(file) { return path.relative(root, file).replaceAll('\\', '/') }
function production(file) {
  return !file.includes('/tests/') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')
}

const violations = []
const directProductionFiles = new Map()
for (const file of await files(root)) {
  const name = relative(file)
  const parts = name.split('/')
  if (parts.some((part) => forbiddenFolders.has(part))) {
    violations.push(`${name}: generic horizontal folder is forbidden`)
  }
  const source = await readFile(file, 'utf8')
  if (production(name)) {
    const lines = source === '' ? 0 : source.split(/\r?\n/u).length
    if (lines > 500) violations.push(`${name}: production source exceeds 500 lines`)
    const directory = path.posix.dirname(name)
    directProductionFiles.set(directory, (directProductionFiles.get(directory) ?? 0) + 1)
  }
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1]
    if (specifier.includes('import-snapshot/') && !specifier.endsWith('import-snapshot/index.js') &&
      !name.startsWith('application/import-snapshot/')) {
      violations.push(`${name}: import-snapshot callers must use its public index`)
    }
    if (specifier.includes('outbound-export/') && !specifier.endsWith('outbound-export/index.js') &&
      !name.startsWith('application/outbound-export/')) {
      violations.push(`${name}: outbound-export callers must use its public index`)
    }
  }
}

for (const [directory, count] of directProductionFiles) {
  if (count > 12) violations.push(`${directory}: ${count} direct production files exceed the limit`)
}

if (violations.length > 0) throw new Error([...new Set(violations)].sort().join('\n'))
process.stdout.write('Member Connector deep-module layout is valid.\n')
