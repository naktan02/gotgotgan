import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g
const allowedDependencies = new Map([
  ['primitives', new Set()],
  ['providers', new Set(['primitives'])],
  ['http', new Set(['primitives'])],
  ['search', new Set(['primitives', 'providers'])],
  ['imports', new Set(['primitives', 'providers'])],
  ['connector', new Set(['primitives', 'providers'])],
  ['place-reference', new Set(['primitives'])],
  ['places', new Set(['primitives'])],
  ['library', new Set(['primitives', 'places'])],
  ['visits', new Set(['primitives'])],
  ['writing', new Set(['primitives'])],
])

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

function owner(relative) {
  const first = relative.split('/')[0]
  if (first === 'primitives.ts') return 'primitives'
  return first.endsWith('.ts') ? 'composition' : first
}

function resolveRelativeImport(file, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return undefined
  const base = path.resolve(path.dirname(file), specifier)
  const candidates = specifier.endsWith('.js')
    ? [base.slice(0, -3) + '.ts']
    : [base, `${base}.ts`, path.join(base, 'index.ts')]
  return candidates.find((candidate) => knownFiles.has(candidate))
}

export async function inspectContractsArchitecture(sourceRoot) {
  const files = await sourceFiles(sourceRoot)
  const knownFiles = new Set(files.map((file) => path.resolve(file)))
  const violations = []

  for (const file of files) {
    const relative = normalizedRelative(sourceRoot, file)
    const sourceOwner = owner(relative)
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const targetFile = resolveRelativeImport(file, match[1], knownFiles)
      if (targetFile === undefined) continue
      const targetRelative = normalizedRelative(sourceRoot, targetFile)
      const targetOwner = owner(targetRelative)
      if (sourceOwner === targetOwner || sourceOwner === 'composition') continue
      if (relative === 'http/openapi.ts') continue
      if (!allowedDependencies.get(sourceOwner)?.has(targetOwner)) {
        violations.push(
          `${relative}: contract owner ${sourceOwner} cannot import ${targetOwner}; move shared primitives to their owning leaf`,
        )
      }
    }
  }

  return [...new Set(violations)].sort()
}
