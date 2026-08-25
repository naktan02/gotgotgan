import {
  assertWritingCommand,
  WritingCommandConflictError,
  type WritingCommand,
} from '../domain/model.js'
import { fingerprintWritingCommand } from './fingerprint.js'
import type { WritingStore } from './ports/writing-store.js'

type Input = Readonly<{
  commandId: string
  memberId: string
  command: WritingCommand
  occurredAt: string
  store: WritingStore
}>

export async function applyWritingCommand(input: Input) {
  assertWritingCommand(input.command)
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('occurredAt must be an ISO timestamp')
  const outcome = await input.store.apply({
    commandId: input.commandId,
    memberId: input.memberId,
    command: input.command,
    occurredAt: input.occurredAt,
    fingerprint: fingerprintWritingCommand({ memberId: input.memberId, command: input.command }),
  })
  if (outcome.status === 'conflict') throw new WritingCommandConflictError('commandId is already used')
  return outcome
}
