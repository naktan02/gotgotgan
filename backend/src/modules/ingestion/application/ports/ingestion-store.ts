import type { IngestionRecord } from '../../domain/model.js'

export interface IngestionStore {
  append(record: IngestionRecord): Promise<'recorded' | 'replayed' | 'conflict'>
}
