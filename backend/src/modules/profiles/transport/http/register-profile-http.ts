import type { FastifyInstance } from 'fastify'
import {
  publicProfileCommandResultSchema,
  publicProfileHandleParamsSchema,
  publicProfileModerationRecordSchema,
  publicProfileModerationRequestSchema,
  publicProfileModerationResultSchema,
  publicProfileProjectionSchema,
  publicProfileQuerySchema,
  publicProfileReportQueueQuerySchema,
  publicProfileReportQueueSchema,
  publicProfileReportRequestSchema,
  publicProfileReportResultSchema,
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
  listPendingPublicProfileReports,
  moderatePublicProfile,
  readPublicProfileModeration,
  reportPublicProfile,
  type PublicProfileSafetyStore,
} from '../../application/public-profile-safety.js'
import type { PublicProfileAppealStore } from '../../application/public-profile-appeals.js'
import {
  InvalidPublicProfileError,
  PublicProfileConflictError,
  PublicProfileHandleImmutableError,
  PublicProfileHandleUnavailableError,
  PublicProfileVersionConflictError,
} from '../../domain/model.js'
import {
  InvalidPublicProfileModerationError,
  PublicProfileModerationAppealPendingError,
  InvalidPublicProfileReportCursorError,
  PublicProfileModerationConflictError,
  PublicProfileModerationTargetNotFoundError,
  PublicProfileModerationVersionConflictError,
  PublicProfileReportConflictError,
  PublicProfileReportTargetNotFoundError,
  PublicProfileSelfReportError,
} from '../../domain/safety.js'
import { registerProfileAppealHttpRoutes } from './register-profile-appeal-http.js'

export type ProfileHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: PublicProfileStore
  safety: PublicProfileSafetyStore
  appeals: PublicProfileAppealStore
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
  registerProfileAppealHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    store: dependencies.appeals,
    now: dependencies.now,
  })

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

  application.post('/v1/public/profiles/:handle/reports', async (request, reply) => {
    const reporterMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.report',
    )
    if (reporterMemberId === undefined) return
    const params = publicProfileHandleParamsSchema.safeParse(request.params)
    const parsed = publicProfileReportRequestSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_REPORT_INVALID', 'Public Profile report is invalid')
    }
    try {
      const outcome = await reportPublicProfile({
        reportId: parsed.data.reportId,
        reporterMemberId,
        handle: params.data.handle,
        reason: parsed.data.reason,
        occurredAt: dependencies.now().toISOString(),
        store: dependencies.safety,
      })
      return reply.header('cache-control', 'no-store')
        .status(outcome.status === 'recorded' ? 201 : 200)
        .send(publicProfileReportResultSchema.parse({
          schemaVersion: 'public-profile-report-result.v1',
          status: outcome.status,
        }))
    } catch (error) {
      if (error instanceof PublicProfileReportTargetNotFoundError) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOT_FOUND', 'Public Profile not found')
      }
      if (error instanceof PublicProfileSelfReportError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_REPORT_NOT_ALLOWED', 'Public Profile report is not allowed')
      }
      if (error instanceof PublicProfileReportConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_REPORT_CONFLICT', 'Public Profile report conflicts with an earlier request')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_REPORT_UNAVAILABLE', 'Public Profile report is temporarily unavailable', true)
    }
  })

  application.get('/v1/administration/public-profile-reports', async (request, reply) => {
    const actorMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.moderate',
    )
    if (actorMemberId === undefined) return
    const query = publicProfileReportQueueQuerySchema.safeParse(request.query)
    if (!query.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_REPORT_QUERY_INVALID', 'Public Profile report query is invalid')
    }
    try {
      const page = await listPendingPublicProfileReports({
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        limit: query.data.limit,
        now: dependencies.now().toISOString(),
        store: dependencies.safety,
      })
      return reply.header('cache-control', 'no-store').status(200)
        .send(publicProfileReportQueueSchema.parse(page))
    } catch (error) {
      if (error instanceof InvalidPublicProfileReportCursorError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_REPORT_QUERY_INVALID', 'Public Profile report query is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_MODERATION_UNAVAILABLE', 'Public Profile moderation is temporarily unavailable', true)
    }
  })

  application.get('/v1/administration/public-profiles/:handle/moderation', async (request, reply) => {
    const actorMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.moderate',
    )
    if (actorMemberId === undefined) return
    const params = publicProfileHandleParamsSchema.safeParse(request.params)
    if (!params.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_MODERATION_INVALID', 'Public Profile moderation request is invalid')
    }
    try {
      const moderation = await readPublicProfileModeration({
        handle: params.data.handle,
        store: dependencies.safety,
      })
      if (moderation === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOT_FOUND', 'Public Profile not found')
      }
      return reply.header('cache-control', 'no-store').status(200)
        .send(publicProfileModerationRecordSchema.parse(moderation))
    } catch {
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_MODERATION_UNAVAILABLE', 'Public Profile moderation is temporarily unavailable', true)
    }
  })

  application.put('/v1/administration/public-profiles/:handle/moderation', async (request, reply) => {
    const actorMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.moderate',
    )
    if (actorMemberId === undefined) return
    const params = publicProfileHandleParamsSchema.safeParse(request.params)
    const parsed = publicProfileModerationRequestSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_MODERATION_INVALID', 'Public Profile moderation request is invalid')
    }
    try {
      const outcome = await moderatePublicProfile({
        decisionId: parsed.data.decisionId,
        actorMemberId,
        handle: params.data.handle,
        command: parsed.data.moderation,
        occurredAt: dependencies.now().toISOString(),
        store: dependencies.safety,
      })
      return reply.header('cache-control', 'no-store')
        .status(outcome.status === 'applied' ? 201 : 200)
        .send(publicProfileModerationResultSchema.parse({
          schemaVersion: 'public-profile-moderation-result.v1',
          status: outcome.status,
        }))
    } catch (error) {
      if (error instanceof InvalidPublicProfileModerationError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_MODERATION_INVALID', 'Public Profile moderation request is invalid')
      }
      if (error instanceof PublicProfileModerationTargetNotFoundError) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOT_FOUND', 'Public Profile not found')
      }
      if (error instanceof PublicProfileModerationVersionConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_MODERATION_VERSION_CONFLICT', 'Public Profile moderation changed concurrently', true)
      }
      if (error instanceof PublicProfileModerationAppealPendingError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_PENDING', 'Public Profile appeal must be resolved first', true)
      }
      if (error instanceof PublicProfileModerationConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_MODERATION_CONFLICT', 'Public Profile moderation conflicts with an earlier request')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_MODERATION_UNAVAILABLE', 'Public Profile moderation is temporarily unavailable', true)
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
