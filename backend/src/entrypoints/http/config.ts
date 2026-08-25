import { z } from 'zod'

const httpRuntimeSchema = z.object({
  PLACE_HTTP_HOST: z.string().min(1),
  PLACE_HTTP_PORT: z.coerce.number().int().min(1).max(65_535),
})

export type HttpRuntimeConfig = Readonly<{
  host: string
  port: number
}>

export function readHttpRuntimeConfig(environment: NodeJS.ProcessEnv): HttpRuntimeConfig {
  const parsed = httpRuntimeSchema.parse(environment)
  return { host: parsed.PLACE_HTTP_HOST, port: parsed.PLACE_HTTP_PORT }
}
