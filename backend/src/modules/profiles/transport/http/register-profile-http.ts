import type { FastifyInstance } from 'fastify'
import {
  publicProfileCommandResultSchema,
  publicProfileHandleParamsSchema,
  publicProfileProjectionSchema,
  publicProfileQuerySchema,
  publicProfileRecordSchema,
  setPublicProfileRequestSchema,
} from '@place/contracts/profiles'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import {
  InvalidPublicProfileCursorError,
  readPublishedProfile,
  setPublicProfile,
  type PublicCollectionDirectory,
  type PublicProfileStore,
} from '../../application/public-profiles.js'
import {
  InvalidPublicProfileError,
  PublicProfileConflictError,
  PublicProfileHandleImmutableError,
  PublicProfileHandleUnavailableError,
  PublicProfileVersionConflictError,
} from '../../domain/model.js'

export type ProfileHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: PublicProfileStore
  collections: PublicCollectionDirectory
  now: () => Date
}>

const noIndexHeaders = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
}

export function registerProfileHttpRoutes(
  application: FastifyInstance,
  dependencies: ProfileHttpDependencies,
): void {
  application.get('/v1/profiles/current', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.share')
    if (memberId === undefined) return
    try {
      const profile = await dependencies.store.getCurrent(memberId)
      if (profile === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOT_FOUND', 'Public Profile not found')
      }
      return reply.header('cache-control', 'no-store').status(200).send(publicProfileRecordSchema.parse({
        schemaVersion: 'public-profile-record.v1',
        ...profile,
      }))
    } catch {
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_UNAVAILABLE', 'Public Profile is temporarily unavailable', true)
    }
  })

  application.put('/v1/profiles/current', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.share')
    if (memberId === undefined) return
    const parsed = setPublicProfileRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_INVALID', 'Public Profile is invalid')
    }
    try {
      const outcome = await setPublicProfile({
        commandId: parsed.data.commandId,
        memberId,
        command: parsed.data.profile,
        occurredAt: dependencies.now().toISOString(),
        store: dependencies.store,
      })
      return reply.header('cache-control', 'no-store')
        .status(outcome.status === 'applied' ? 201 : 200)
        .send(publicProfileCommandResultSchema.parse({
          schemaVersion: 'public-profile-command-result.v1',
          status: outcome.status,
        }))
    } catch (error) {
      if (error instanceof PublicProfileHandleUnavailableError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_HANDLE_UNAVAILABLE', 'Public Handle is unavailable')
      }
      if (error instanceof PublicProfileHandleImmutableError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_HANDLE_IMMUTABLE', 'Public Handle cannot be changed')
      }
      if (error instanceof PublicProfileVersionConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_VERSION_CONFLICT', 'Public Profile changed concurrently', true)
      }
      if (error instanceof PublicProfileConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_COMMAND_CONFLICT', 'Public Profile command conflicts with an earlier request')
      }
      if (error instanceof InvalidPublicProfileError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_INVALID', 'Public Profile is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_UNAVAILABLE', 'Public Profile is temporarily unavailable', true)
    }
  })

  application.get('/v1/public/profiles/:handle', async (request, reply) => {
    for (const [name, value] of Object.entries(noIndexHeaders)) reply.header(name, value)
    const params = publicProfileHandleParamsSchema.safeParse(request.params)
    const query = publicProfileQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_REQUEST_INVALID', 'Public Profile request is invalid')
    }
    try {
      const profile = await readPublishedProfile({
        handle: params.data.handle,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        store: dependencies.store,
        collections: dependencies.collections,
      })
      if (profile === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOT_FOUND', 'Public Profile not found')
      }
      return reply.status(200).send(publicProfileProjectionSchema.parse(profile))
    } catch (error) {
      if (error instanceof InvalidPublicProfileCursorError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_REQUEST_INVALID', 'Public Profile request is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_UNAVAILABLE', 'Public Profile is temporarily unavailable', true)
    }
  })
}
