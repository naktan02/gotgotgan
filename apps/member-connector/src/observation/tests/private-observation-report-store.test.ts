import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PrivateObservationReportStore } from '../adapters/filesystem/private-observation-report-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('private member-connector observation reports', () => {
  it('creates one non-overwriting local report without profile or provider values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'place-member-report-'))
    roots.push(root)
    const store = new PrivateObservationReportStore(root)
    const reportId = '01992d22-1000-7000-8000-000000000001'
    const report = {
      schemaVersion: 'place-member-connector-observation.v1' as const,
      providerKey: 'naver' as const,
      startedAt: '2026-08-26T15:00:00.000Z',
      finishedAt: '2026-08-26T15:00:05.000Z',
      responses: [],
    }

    await expect(store.write({ reportId, report })).resolves.toEqual({ reportId })
    const saved = await readFile(join(root, `${reportId}.json`), 'utf8')
    expect(JSON.parse(saved)).toEqual(report)
    expect(saved).not.toMatch(/profile|cookie|token|password/i)
    await expect(store.write({ reportId, report })).rejects.toThrow(
      'Observation report could not be written',
    )
  })
})
