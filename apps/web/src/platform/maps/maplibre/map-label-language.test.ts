import { createExpression } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { koreanFirstNameField } from './map-label-language'

// OpenFreeMap Bright's country, city, POI and road-name layers share this expression.
const brightNameField = ['case', ['has', 'name:nonlatin'],
  ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
  ['coalesce', ['get', 'name_en'], ['get', 'name']]]

describe('Korean-first map labels', () => {
  it('prefers available Korean, then the local name, then English at every scale', () => {
    const parsed = createExpression(koreanFirstNameField(brightNameField), 'text-field')
    expect(parsed.result).toBe('success')
    if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
    const cases = [
      [{ 'name:ko': '대한민국', name: 'South Korea', name_en: 'South Korea' }, '대한민국'],
      [{ 'name:ko': '', name: '서울', 'name:latin': 'Seoul', 'name:nonlatin': '서울' }, '서울'],
      [{ name: '東京都', name_en: 'Tokyo' }, '東京都'],
      [{ name: '', 'name:nonlatin': '성수동', name_en: 'Seongsu' }, '성수동'],
      [{ 'name:en': 'Seoul' }, 'Seoul'],
      [{ name_en: 'Seoul' }, 'Seoul'],
      [{ 'name:latin': 'Seoul' }, 'Seoul'],
      [{}, ''],
    ] as const
    for (const zoom of [0, 4, 8, 12, 16, 20]) {
      for (const [properties, expected] of cases) {
        expect(parsed.value.evaluate({ zoom }, { type: 'Point', properties })).toBe(expected)
      }
    }
  })

  it('keeps road refs, codes and custom mixed labels intact', () => {
    for (const field of [
      ['to-string', ['get', 'ref']], ['get', 'iata'],
      ['concat', ['get', 'name'], ' (', ['get', 'ref'], ')'],
      '고정 안내', '{ref}', undefined,
    ]) expect(koreanFirstNameField(field)).toBe(field)
  })

  it('also localizes simple name fields without adding bilingual duplicates', () => {
    expect(koreanFirstNameField(['get', 'name'])).toEqual(koreanFirstNameField(brightNameField))
    expect(koreanFirstNameField('{name:latin}\n{name:nonlatin}')).toEqual(koreanFirstNameField(brightNameField))
  })
})
