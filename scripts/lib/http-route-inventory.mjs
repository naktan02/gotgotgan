import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])
const backendRoutePattern =
  /application\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
const webFunctionPattern =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
const webConstantPattern =
  /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g

async function filesBelow(directory, accept) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(target, accept))
    else if (accept(target)) files.push(target)
  }
  return files
}

function routeKey(method, pathname) {
  return `${method.toUpperCase()} ${pathname.replace(/:([^/]+)/g, '{$1}')}`
}

export async function collectBackendHttpRoutes(repositoryRoot) {
  const files = [
    ...await filesBelow(
      path.join(repositoryRoot, 'backend/src/entrypoints/http'),
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    ),
    ...await filesBelow(
      path.join(repositoryRoot, 'backend/src/modules'),
      (file) => file.replaceAll('\\', '/').includes('/transport/http/') &&
        file.endsWith('.ts') && !file.endsWith('.test.ts'),
    ),
  ]
  const routes = new Set()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(backendRoutePattern)) {
      routes.add(routeKey(match[1], match[2]))
    }
  }
  return routes
}

function webPath(appRoot, routeFile) {
  const directory = path.relative(appRoot, path.dirname(routeFile)).replaceAll('\\', '/')
  const segments = directory.split('/').filter(
    (segment) => segment !== '' && !segment.startsWith('(') && !segment.startsWith('@'),
  )
  return `/${segments.map((segment) => {
    const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment)
    return match === null ? segment : `{${match[1]}}`
  }).join('/')}`
}

export async function collectWebHttpRoutes(repositoryRoot) {
  const routes = new Set()
  for (const application of ['web', 'admin-web']) {
    const appRoot = path.join(repositoryRoot, `apps/${application}/src/app`)
    const files = await filesBelow(appRoot, (file) => path.basename(file) === 'route.ts')
    for (const file of files) {
      const pathname = webPath(appRoot, file)
      const source = await readFile(file, 'utf8')
      for (const pattern of [webFunctionPattern, webConstantPattern]) {
        for (const match of source.matchAll(pattern)) routes.add(routeKey(match[1], pathname))
      }
    }
  }
  return routes
}

export function collectOpenApiHttpRoutes(document) {
  const routes = new Set()
  for (const [pathname, item] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (methods.has(method)) routes.add(routeKey(method, pathname))
    }
  }
  return routes
}

export async function inspectHttpRouteInventory(repositoryRoot, document) {
  const actual = new Set([
    ...await collectBackendHttpRoutes(repositoryRoot),
    ...await collectWebHttpRoutes(repositoryRoot),
  ])
  const documented = collectOpenApiHttpRoutes(document)
  return {
    missingFromOpenApi: [...actual].filter((route) => !documented.has(route)).sort(),
    missingFromSource: [...documented].filter((route) => !actual.has(route)).sort(),
  }
}
