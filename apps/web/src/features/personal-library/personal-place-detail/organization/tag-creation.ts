import type { BrowserLibraryCommandRequest } from '@place/contracts/http'

// Creation and attachment are separate existing commands. Keep each original ID
// until its acknowledgement so a lost response cannot create a second tag.
export function createTagCreation(
  name: string,
  placeId: string,
  send: (request: BrowserLibraryCommandRequest) => Promise<unknown>,
) {
  const tagId = crypto.randomUUID()
  const commands: BrowserLibraryCommandRequest[] = [
    { commandId: crypto.randomUUID(), command: { kind: 'create-tag', tagId, name } },
    { commandId: crypto.randomUUID(), command: { kind: 'tag-place', tagId, placeId } },
  ]
  let acknowledged = 0
  return async () => {
    while (acknowledged < commands.length) {
      await send(commands[acknowledged]!)
      ++acknowledged
    }
  }
}
