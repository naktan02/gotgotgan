import { describe, expect, it } from 'vitest'
import { clusterBadgeOffset, markerPresentation, visibleMarkerLabels } from './marker-presentation'

const classified = { id: 'ramen', label: '라멘 연구소', location: { latitude: 37, longitude: 127 },
  classification: { primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' }, rootTaxonomy: { key: 'food', label: '음식점' } } }
describe('adaptive map marker presentation', () => {
  it('moves only colliding cluster badges inside the screen and recomputes after a viewport change', () => {
    const viewport = { width: 390, height: 184 }
    expect(clusterBadgeOffset({ x: 100, y: 100 }, [{ x: 200, y: 100 }], viewport)).toEqual([0, 0])
    expect(clusterBadgeOffset({ x: 100, y: 100 }, [{ x: 100, y: 100 }], viewport)).toEqual([0, -38])
    expect(clusterBadgeOffset({ x: 100, y: 20 }, [{ x: 100, y: 20 }], viewport)).toEqual([0, 38])
    expect(clusterBadgeOffset({ x: 100, y: 170 }, [{ x: 100, y: 170 }], viewport)).toEqual([0, -38])
    expect(clusterBadgeOffset({ x: 100, y: 100 }, [], viewport)).toEqual([0, 0])
  })
  it('shows small dots remotely, distinct type icons nearby, and never infers unclassified icons', () => {
    expect(markerPresentation(classified, 'detail', 5, false).dot).toBe(true)
    expect(markerPresentation(classified, 'detail', 15, false).dot).toBe(false)
    expect(markerPresentation(classified, 'circle', 15, false).dot).toBe(true)
    expect(markerPresentation(classified, 'detail', 15, false).path).not.toBe(markerPresentation(classified, 'category', 15, false).path)
    expect(markerPresentation({ ...classified, classification: null }, 'detail', 15, false).dot).toBe(true)
  })
  it('prioritizes the selected label and suppresses only overlapping other labels', () => {
    const nearby = { ...classified, id: 'other' }
    expect([...visibleMarkerLabels([nearby, classified], 'ramen', 15, () => ({ x: 20, y: 20 }))]).toEqual(['ramen'])
    expect([...visibleMarkerLabels([nearby, classified], 'ramen', 5, () => ({ x: 20, y: 20 }))]).toEqual(['ramen'])
    expect(visibleMarkerLabels([nearby, classified], undefined, 15, (point) => ({ x: point.id === 'other' ? 0 : 300, y: 20 })).size).toBe(2)
  })
})
