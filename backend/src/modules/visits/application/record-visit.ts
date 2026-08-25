import { assertVisitTime, VisitIdConflictError } from '../domain/model.js'
import { fingerprintVisit } from './fingerprint.js'
import type { VisitStore } from './ports/visit-store.js'

type Input = Readonly<{
  id: string
  memberId: string
  placeId: string
  visitedAt: string
  recordedAt: string
  evidence?: Readonly<Record<string, unknown>> | undefined
  store: VisitStore
}>

export async function recordVisit(input: Input) {
  assertVisitTime(input.visitedAt, input.recordedAt)
  const content = {
    memberId: input.memberId,
    placeId: input.placeId,
    visitedAt: input.visitedAt,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
  }
  const outcome = await input.store.append({
    id: input.id,
    ...content,
    recordedAt: input.recordedAt,
    fingerprint: fingerprintVisit(content),
  })
  if (outcome === 'conflict') throw new VisitIdConflictError('visit id is already used')
  return { status: 'recorded' as const }
}
