import { z } from 'zod'

export const processStatusSchema = z.object({
  schemaVersion: z.literal('place-process-status.v1'),
  service: z.enum(['place', 'place-web', 'place-admin-web']),
  state: z.enum(['ok', 'unavailable']),
}).strict()

export type ProcessStatus = z.infer<typeof processStatusSchema>
