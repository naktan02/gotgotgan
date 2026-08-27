import type { PoolClient } from 'pg'

import type { LibraryAttempt } from '../../domain/model.js'
import { applyCollectionWrite } from './postgres-library-collection-writes.js'
import { applyPreferenceWrite } from './postgres-library-preference-writes.js'
import { applyTagWrite } from './postgres-library-tag-writes.js'

type WriteOutcome = 'applied' | 'not-found' | 'forbidden'

export function applyPostgresLibraryCommand(
  client: PoolClient,
  attempt: LibraryAttempt,
): Promise<WriteOutcome> {
  const command = attempt.command
  if (command.kind === 'set-place-preferences') {
    return applyPreferenceWrite(client, attempt, command)
  }
  if (
    command.kind === 'create-tag' || command.kind === 'rename-tag' ||
    command.kind === 'delete-tag' || command.kind === 'tag-place' ||
    command.kind === 'untag-place'
  ) {
    return applyTagWrite(client, attempt, command)
  }
  return applyCollectionWrite(client, attempt, command)
}
