import { z } from 'zod'

const browserMapStyleLayerSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
}).passthrough()

export const browserMapStyleSchema = z.object({
  version: z.literal(8),
  name: z.string().trim().min(1),
  sources: z.object({}).catchall(z.unknown()),
  layers: z.array(browserMapStyleLayerSchema).min(1),
}).passthrough()

export type BrowserMapStyle = z.infer<typeof browserMapStyleSchema>

export const processStatusSchema = z.object({
  schemaVersion: z.literal('place-process-status.v1'),
  service: z.enum(['place', 'place-web', 'place-admin-web']),
  state: z.enum(['ok', 'unavailable']),
}).strict()

export type ProcessStatus = z.infer<typeof processStatusSchema>
