import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const allowedWorkspaceContracts = new Set([
  '@place/contracts/connector',
  '@place/contracts/transfers',
])

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

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function isInside(root, target) {
  const relation = path.relative(root, target)
  return relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
}

function resolveImport(file, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return undefined
  const base = path.resolve(path.dirname(file), specifier)
  const candidates = specifier.endsWith('.js')
    ? [base.slice(0, -3) + '.ts']
    : [base, `${base}.ts`, path.join(base, 'index.ts')]
  return candidates.find((candidate) => knownFiles.has(candidate))
}

function layerOf(file) {
  if (file.includes('/tests/') || file.endsWith('.test.ts')) return 'tests'
  if (file.startsWith('entrypoints/')) return 'entrypoints'
  const parts = file.split('/')
  if (new Set(['domain', 'application', 'adapters']).has(parts[0])) return parts[0]
  if (!new Set(['observation', 'acquisition']).has(parts[0])) return undefined
  return new Set(['application', 'adapters', 'tests']).has(parts[1])
    ? parts[1]
    : undefined
}

function isProductionSource(file) {
  return !file.includes('/tests/') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')
}

function lineCount(source) {
  return source === '' ? 0 : source.split(/\r?\n/).length
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

export async function inspectMemberConnectorArchitecture(sourceRoot) {
  const root = path.resolve(sourceRoot)
  const files = await sourceFiles(root)
  const knownFiles = new Set(files.map((file) => path.resolve(file)))
  const violations = []
  const edges = new Map()
  const directProductionFiles = new Map()

  for (const file of files) {
    const importer = relative(root, file)
    const importerLayer = layerOf(importer)
    const targets = []
    const source = await readFile(file, 'utf8')

    if (isProductionSource(importer)) {
      if (lineCount(source) > 500) {
        violations.push(`${importer}: production source exceeds the 500-line layout review gate`)
      }
      const directory = path.posix.dirname(importer)
      directProductionFiles.set(directory, (directProductionFiles.get(directory) ?? 0) + 1)
    }

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (specifier.startsWith('@place/') && !allowedWorkspaceContracts.has(specifier)) {
        violations.push(`${importer}: member connector cannot import another Place workspace package`)
        continue
      }
      if (!specifier.startsWith('.')) continue

      const requestedTarget = path.resolve(path.dirname(file), specifier)
      if (!isInside(root, requestedTarget)) {
        violations.push(`${importer}: relative import escapes the connector source root`)
        continue
      }

      const targetFile = resolveImport(file, specifier, knownFiles)
      if (targetFile === undefined) continue
      const target = relative(root, targetFile)
      const targetLayer = layerOf(target)
      targets.push(target)

      if (importerLayer === 'adapters' && importer.startsWith('adapters/browser/electron/') &&
        target.startsWith('adapters/providers/')) {
        violations.push(`${importer}: desktop host must receive provider adapters through its application interface`)
      }

      if (
        !importer.startsWith('application/outbound-export/') &&
        target.startsWith('application/outbound-export/') &&
        target !== 'application/outbound-export/index.ts'
      ) {
        violations.push(`${importer}: outbound-export callers must use its public index interface`)
      }

      if (
        importerLayer === 'domain' &&
        targetLayer !== 'domain'
      ) {
        violations.push(`${importer}: domain cannot import application, adapters, tests, or entrypoints`)
      }
      if (
        importerLayer === 'application' &&
        !new Set(['domain', 'application']).has(targetLayer)
      ) {
        violations.push(`${importer}: application cannot import adapters, tests, or entrypoints`)
      }
      if (importerLayer === 'adapters' && new Set(['tests', 'entrypoints']).has(targetLayer)) {
        violations.push(`${importer}: adapters cannot import tests or entrypoints`)
      }
    }
    edges.set(importer, targets)
  }

  for (const [directory, count] of directProductionFiles) {
    if (count > 12) {
      violations.push(
        `${directory}: ${count} direct production sources exceed the 12-file layout review gate`,
      )
    }
  }

  for (const cycle of findCycles(edges)) {
    violations.push(`connector import cycle: ${cycle.join(' -> ')}`)
  }
  return [...new Set(violations)].sort()
}
