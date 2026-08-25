import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

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
const allowedPlatformDependencies = new Map([
  ['membership', new Set(['auth'])],
  ['process-readiness', new Set(['auth', 'membership'])],
  ['publications', new Set(['backend-http'])],
  ['search', new Set(['backend-http'])],
])
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g

async function sourceFiles(directory) {
  const entries = await readdir(directory)
  const result = []
  for (const entry of entries) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...await sourceFiles(target))
    else if (/\.(ts|tsx)$/.test(entry)) result.push(target)
  }
  return result
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function resolveImport(root, file, specifier, knownFiles) {
  let base
  if (specifier.startsWith('@/')) base = path.resolve(root, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(file), specifier)
  else return undefined
  const candidates = /\.(ts|tsx)$/.test(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.find((candidate) => knownFiles.has(candidate))
}

function findCycles(edges) {
  const cycles = []
  const visited = new Set()
  const active = new Set()
  const stack = []
  function visit(node) {
    if (active.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node])
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    active.add(node)
    stack.push(node)
    for (const target of edges.get(node) ?? []) visit(target)
    stack.pop()
    active.delete(node)
  }
  for (const node of edges.keys()) visit(node)
  return cycles
}

export async function inspectFrontendArchitecture(root) {
  const violations = []
  for (const bucket of forbiddenBuckets) {
    try {
      if ((await stat(path.join(root, bucket))).isDirectory()) {
        violations.push(`forbidden top-level frontend bucket: ${bucket}`)
      }
    } catch {}
  }
  const files = await sourceFiles(root)
  const knownFiles = new Set(files.map((file) => path.resolve(file)))
  const edges = new Map()
  for (const file of files) {
    const importer = relative(root, file)
    const importerParts = importer.split('/')
    const owner = importerParts[0]
    const targets = []
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const targetFile = resolveImport(root, file, match[1], knownFiles)
      if (targetFile === undefined) continue
      const target = relative(root, targetFile)
      targets.push(target)
      const targetParts = target.split('/')
      const targetLayer = targetParts[0]
      if (layers.includes(owner) && layers.includes(targetLayer)) {
        if (targetLayer !== owner && !allowed[owner].has(targetLayer)) {
          violations.push(`${importer}: ${owner} cannot import ${targetLayer}`)
        }
        if (
          owner === targetLayer &&
          new Set(['features', 'domains']).has(owner) &&
          importerParts[1] !== targetParts[1]
        ) {
          const publicFeatureImport = owner === 'features' && targetParts[2] === 'public'
          if (!publicFeatureImport) {
            violations.push(`${importer}: ${owner.slice(0, -1)} owners cannot import each other's internals`)
          }
        }
        if (
          owner === 'platform' &&
          targetLayer === 'platform' &&
          importerParts[1] !== targetParts[1] &&
          !allowedPlatformDependencies.get(importerParts[1])?.has(targetParts[1])
        ) {
          violations.push(
            `${importer}: platform owner ${importerParts[1]} cannot import ${targetParts[1]}`,
          )
        }
        if (owner === 'shells' && targetLayer === 'features' && targetParts[2] !== 'public') {
          violations.push(`${importer}: shells may import only a feature's public contract`)
        }
      }
    }
    edges.set(importer, targets)
  }
  for (const cycle of findCycles(edges)) violations.push(`frontend import cycle: ${cycle.join(' -> ')}`)
  return [...new Set(violations)].sort()
}
