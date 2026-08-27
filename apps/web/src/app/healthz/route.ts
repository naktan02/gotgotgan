import { processStatusSchema } from '@place/contracts/http'

export function GET(): Response {
  return Response.json(processStatusSchema.parse({
    schemaVersion: 'place-process-status.v1',
    service: 'place-web',
    state: 'ok',
  }))
}
