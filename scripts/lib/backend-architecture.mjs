import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const forbiddenBuckets = ['controllers', 'services', 'repositories']
const moduleLayers = new Set(['domain', 'application', 'adapters', 'transport', 'tests'])
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g

async function sourceFiles(directory) {
  const entries = await readdir(directory)
  const result = []
  for (const entry of entries) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...await sourceFiles(target))
    else if (entry.endsWith('.ts')) result.push(target)
  }
  return result
}

function normalizedRelative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function resolveRelativeImport(file, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return undefined
  const base = path.resolve(path.dirname(file), specifier)
  const candidates = specifier.endsWith('.js')
    ? [base.slice(0, -3) + '.ts']
    : [base, `${base}.ts`, path.join(base, 'index.ts')]
  return candidates.find((candidate) => knownFiles.has(candidate))
}

function importsOf(source) {
  return [...source.matchAll(importPattern)].map((match) => match[1])
}

function moduleParts(relative) {
  const parts = relative.split('/')
  if (parts[0] !== 'modules' || parts.length < 3) return undefined
  return { module: parts[1], layer: moduleLayers.has(parts[2]) ? parts[2] : 'public' }
}

function layerViolation(importer, target) {
  if (importer.layer === 'domain' && target.layer !== 'domain') {
    return 'domain code cannot import an outer implementation layer'
  }
  if (
    importer.layer === 'application' &&
    !new Set(['domain', 'application']).has(target.layer)
  ) {
    return 'application code cannot import adapters, transport, tests, or module composition'
  }
  if (
    importer.layer === 'transport' &&
    !new Set(['domain', 'application', 'transport']).has(target.layer)
  ) {
    return 'transport code cannot import outbound adapters, tests, or module composition'
  }
  return undefined
}

function findCycles(edges) {
  const cycles = []
  const visited = new Set()
  const active = new Set()
  const stack = []

  function visit(node) {
    if (active.has(node)) {
      const start = stack.indexOf(node)
      cycles.push([...stack.slice(start), node])
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

export async function inspectBackendArchitecture(sourceRoot) {
  const violations = []
  for (const bucket of forbiddenBuckets) {
    try {
      if ((await stat(path.join(sourceRoot, bucket))).isDirectory()) {
        violations.push(`forbidden backend bucket: ${bucket}`)
      }
    } catch {}
  }

  const files = await sourceFiles(sourceRoot)
  const knownFiles = new Set(files.map((file) => path.resolve(file)))
  const edges = new Map()

  for (const file of files) {
    const relative = normalizedRelative(sourceRoot, file)
    const source = await readFile(file, 'utf8')
    const targets = []
    for (const specifier of importsOf(source)) {
      const targetFile = resolveRelativeImport(file, specifier, knownFiles)
      if (targetFile === undefined) continue
      const targetRelative = normalizedRelative(sourceRoot, targetFile)
      targets.push(targetRelative)
      const importerModule = moduleParts(relative)
      const targetModule = moduleParts(targetRelative)

      if (importerModule !== undefined && targetRelative.startsWith('entrypoints/')) {
        violations.push(`${relative}: a module cannot import a process entrypoint`)
      }
      if (
        importerModule !== undefined &&
        targetModule !== undefined &&
        importerModule.module !== targetModule.module
      ) {
        violations.push(
          `${relative}: business modules cannot directly import module ${targetModule.module}; use a consumer-owned port and entrypoint composition`,
        )
      }
      if (importerModule !== undefined && targetModule?.module === importerModule.module) {
        const reason = layerViolation(importerModule, targetModule)
        if (reason !== undefined) violations.push(`${relative}: ${reason}`)
      }
      if (
        relative.startsWith('entrypoints/') &&
        targetModule !== undefined &&
        targetRelative !== `modules/${targetModule.module}/index.ts`
      ) {
        violations.push(`${relative}: entrypoints may import only a module's public index.ts`)
      }
      if (relative.startsWith('platform/') && targetModule !== undefined) {
        violations.push(`${relative}: platform code cannot depend on a business module`)
      }
    }
    edges.set(relative, targets)
  }

  for (const cycle of findCycles(edges)) {
    violations.push(`relative import cycle: ${cycle.join(' -> ')}`)
  }
  return [...new Set(violations)].sort()
}
