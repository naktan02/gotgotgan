import {
  assertLibraryCommand,
  LibraryCommandConflictError,
  type LibraryCommand,
} from '../domain/model.js'
import { fingerprintLibraryCommand } from './fingerprint.js'
import type { LibraryStore } from './ports/library-store.js'

type Input = Readonly<{
  commandId: string
  memberId: string
  command: LibraryCommand
  occurredAt: string
  store: LibraryStore
}>

export async function applyLibraryCommand(input: Input) {
  assertLibraryCommand(input.command)
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('occurredAt must be an ISO timestamp')
  const outcome = await input.store.apply({
    commandId: input.commandId,
    memberId: input.memberId,
    command: input.command,
    occurredAt: input.occurredAt,
    fingerprint: fingerprintLibraryCommand({ memberId: input.memberId, command: input.command }),
  })
  if (outcome.status === 'conflict') throw new LibraryCommandConflictError('commandId is already used')
  return outcome
}
