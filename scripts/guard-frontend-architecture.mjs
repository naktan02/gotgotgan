import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve('apps/web/src')
const layers = ['app', 'shells', 'features', 'domains', 'platform', 'shared']
const allowed = {
  app: new Set(['shells', 'features', 'domains', 'platform', 'shared']),
  shells: new Set(['features', 'domains', 'platform', 'shared']),
  features: new Set(['domains', 'platform', 'shared']),
  domains: new Set(['platform', 'shared']),
  platform: new Set(['shared']),
  shared: new Set(),
}
const forbiddenBuckets = ['components', 'services', 'stores', 'hooks']

async function files(directory) {
  const entries = await readdir(directory)
  const result = []
  for (const entry of entries) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...await files(target))
    else if (/\.(ts|tsx)$/.test(entry)) result.push(target)
  }
  return result
}

const violations = []
for (const bucket of forbiddenBuckets) {
  try {
    if ((await stat(path.join(root, bucket))).isDirectory()) {
      violations.push(`forbidden top-level frontend bucket: ${bucket}`)
    }
  } catch {}
}

for (const file of await files(root)) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const owner = relative.split('/')[0]
  if (!layers.includes(owner)) continue
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/from\s+['"]@\/(app|shells|features|domains|platform|shared)(?:\/[^'"]*)?['"]/g)) {
    const target = match[1]
    if (target !== owner && !allowed[owner].has(target)) {
      violations.push(`${relative}: ${owner} cannot import ${target}`)
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('Frontend architecture boundaries are valid.')
