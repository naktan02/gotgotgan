import { describe, expect, it } from 'vitest'

import {
  AreaHierarchyCycleError,
  AreaParentUnavailableError,
  AreaVersionConflictError,
  InvalidAreaNodeError,
  listCurrentAreas,
  publishAreaNode,
  readAreaPath,
  type AreaCatalogStore,
  type AreaNodeVersion,
} from '../index.js'

const seoul: AreaNodeVersion = {
  key: 'area_kr-seoul',
  version: 1,
  parentKey: 'area_kr',
  countryCode: 'KR',
  kind: 'administrative-area',
  names: [{ languageTag: 'ko', name: '서울특별시' }, { languageTag: 'en', name: 'Seoul' }],
  defaultLanguageTag: 'ko',
  active: true,
  effectiveAt: '2026-09-03T00:00:00.000Z',
  fingerprint: 'a'.repeat(64),
}

function store(outcome: Awaited<ReturnType<AreaCatalogStore['publish']>>): AreaCatalogStore {
  return {
    publish: async () => outcome,
    listCurrent: async () => [{
      key: seoul.key, version: 1, parentKey: seoul.parentKey, countryCode: 'KR',
      kind: 'administrative-area', names: seoul.names, defaultLanguageTag: 'ko',
    }],
    readCurrentPath: async () => [],
  }
}

describe('provider-neutral Area catalog', () => {
  it('publishes and replays a valid localized Area version', async () => {
    await expect(publishAreaNode(seoul, store('published'))).resolves.toBe('published')
    await expect(publishAreaNode(seoul, store('replayed'))).resolves.toBe('replayed')
    await expect(listCurrentAreas(store('published'))).resolves.toMatchObject({
      schemaVersion: 'place-areas.v1', nodes: [{ key: 'area_kr-seoul' }],
    })
  })

  it.each([
    ['conflict', AreaVersionConflictError],
    ['parent-unavailable', AreaParentUnavailableError],
    ['cycle', AreaHierarchyCycleError],
  ] as const)('maps %s persistence outcome to a domain error', async (outcome, error) => {
    await expect(publishAreaNode(seoul, store(outcome))).rejects.toBeInstanceOf(error)
  })

  it('rejects invalid hierarchy and locale definitions before persistence', async () => {
    await expect(publishAreaNode({
      ...seoul,
      key: 'area_kr',
      parentKey: 'area_kr',
      kind: 'country',
    }, store('published'))).rejects.toBeInstanceOf(InvalidAreaNodeError)
    await expect(readAreaPath('서울', store('published')))
      .rejects.toBeInstanceOf(AreaParentUnavailableError)
    await expect(publishAreaNode({
      ...seoul,
      parentKey: null,
    }, store('published'))).rejects.toBeInstanceOf(InvalidAreaNodeError)
  })
})
