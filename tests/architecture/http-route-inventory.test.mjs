import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { inspectHttpRouteInventory } from '../../scripts/lib/http-route-inventory.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = []

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'place-http-routes-'))
  roots.push(root)
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('the generated OpenAPI inventory matches every Backend and browser-app route', async () => {
  const document = JSON.parse(await readFile(
    path.join(repositoryRoot, 'packages/contracts/http/openapi.v1.json'),
    'utf8',
  ))
  assert.deepEqual(await inspectHttpRouteInventory(repositoryRoot, document), {
    missingFromOpenApi: [],
    missingFromSource: [],
  })
})

test('reports undocumented source routes and stale documented routes', async () => {
  const root = await fixture({
    'backend/src/entrypoints/http/app.ts':
      "application.get('/healthz', handler); application.post('/v1/jobs/:jobId', handler)",
    'apps/web/src/app/api/jobs/[jobId]/route.ts':
      'export async function GET() { return new Response() }',
    'apps/admin-web/src/app/api/admin/session/route.ts':
      'export const GET = async () => new Response()',
  })
  const result = await inspectHttpRouteInventory(root, {
    paths: {
      '/healthz': { get: {} },
      '/v1/stale': { get: {} },
    },
  })
  assert.deepEqual(result, {
    missingFromOpenApi: [
      'GET /api/admin/session',
      'GET /api/jobs/{jobId}',
      'POST /v1/jobs/{jobId}',
    ],
    missingFromSource: ['GET /v1/stale'],
  })
})
