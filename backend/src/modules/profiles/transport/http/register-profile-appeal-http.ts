import type { FastifyInstance } from 'fastify'
import {
  publicProfileAppealParamsSchema,
  publicProfileAppealQueueQuerySchema,
  publicProfileAppealQueueSchema,
  publicProfileAppealRequestSchema,
  publicProfileAppealResolutionRequestSchema,
  publicProfileAppealResolutionResultSchema,
  publicProfileAppealResultSchema,
  publicProfileModerationNoticeQuerySchema,
  publicProfileModerationNoticesSchema,
  publicProfileNoticeAcknowledgementResultSchema,
  publicProfileNoticeParamsSchema,
} from '@place/contracts/profiles'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import {
  acknowledgePublicProfileOwnerNotice,
  listPendingPublicProfileAppeals,
  listPublicProfileOwnerNotices,
  resolvePublicProfileAppeal,
  submitPublicProfileAppeal,
  type PublicProfileAppealStore,
} from '../../application/public-profile-appeals.js'
import {
  InvalidPublicProfileAppealCursorError,
  InvalidPublicProfileAppealError,
  PublicProfileAppealAlreadyResolvedError,
  PublicProfileAppealConflictError,
  PublicProfileAppealTargetChangedError,
  PublicProfileAppealTargetNotFoundError,
} from '../../domain/appeals.js'

type ProfileAppealHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: PublicProfileAppealStore
  now: () => Date
}>

export function registerProfileAppealHttpRoutes(
  application: FastifyInstance,
  dependencies: ProfileAppealHttpDependencies,
): void {
  application.get('/v1/profiles/current/moderation-notices', async (request, reply) => {
    const ownerMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.appeal',
    )
    if (ownerMemberId === undefined) return
    const query = publicProfileModerationNoticeQuerySchema.safeParse(request.query)
    if (!query.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_NOTICE_QUERY_INVALID', 'Public Profile notice query is invalid')
    }
    try {
      const page = await listPublicProfileOwnerNotices({
        ownerMemberId,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        limit: query.data.limit,
        store: dependencies.store,
      })
      return reply.header('cache-control', 'no-store').status(200)
        .send(publicProfileModerationNoticesSchema.parse(page))
    } catch (error) {
      if (error instanceof InvalidPublicProfileAppealCursorError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_NOTICE_QUERY_INVALID', 'Public Profile notice query is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', 'Public Profile appeal is temporarily unavailable', true)
    }
  })

  application.put(
    '/v1/profiles/current/moderation-notices/:noticeId/acknowledgement',
    async (request, reply) => {
      const ownerMemberId = await requireProductMember(
        request,
        reply,
        dependencies.authorizer,
        'profiles.appeal',
      )
      if (ownerMemberId === undefined) return
      const params = publicProfileNoticeParamsSchema.safeParse(request.params)
      if (!params.success) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_NOTICE_INVALID', 'Public Profile notice is invalid')
      }
      try {
        const outcome = await acknowledgePublicProfileOwnerNotice({
          ownerMemberId,
          noticeId: params.data.noticeId,
          occurredAt: dependencies.now().toISOString(),
          store: dependencies.store,
        })
        return reply.header('cache-control', 'no-store')
          .status(outcome.status === 'acknowledged' ? 201 : 200)
          .send(publicProfileNoticeAcknowledgementResultSchema.parse({
            schemaVersion: 'public-profile-notice-acknowledgement.v1',
            ...outcome,
          }))
      } catch (error) {
        if (error instanceof PublicProfileAppealTargetNotFoundError) {
          return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOTICE_NOT_FOUND', 'Public Profile notice not found')
        }
        return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', 'Public Profile appeal is temporarily unavailable', true)
      }
    },
  )

  application.post('/v1/profiles/current/moderation-appeals', async (request, reply) => {
    const ownerMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.appeal',
    )
    if (ownerMemberId === undefined) return
    const parsed = publicProfileAppealRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_INVALID', 'Public Profile appeal is invalid')
    }
    try {
      const outcome = await submitPublicProfileAppeal({
        appealId: parsed.data.appealId,
        ownerMemberId,
        noticeId: parsed.data.noticeId,
        reason: parsed.data.reason,
        occurredAt: dependencies.now().toISOString(),
        store: dependencies.store,
      })
      return reply.header('cache-control', 'no-store')
        .status(outcome.status === 'recorded' ? 201 : 200)
        .send(publicProfileAppealResultSchema.parse({
          schemaVersion: 'public-profile-appeal-result.v1',
          status: outcome.status,
        }))
    } catch (error) {
      if (error instanceof InvalidPublicProfileAppealError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_INVALID', 'Public Profile appeal is invalid')
      }
      if (error instanceof PublicProfileAppealTargetNotFoundError) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_NOTICE_NOT_FOUND', 'Public Profile notice not found')
      }
      if (error instanceof PublicProfileAppealTargetChangedError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_TARGET_CHANGED', 'Public Profile moderation changed', true)
      }
      if (error instanceof PublicProfileAppealConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_CONFLICT', 'Public Profile appeal conflicts with an earlier request')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', 'Public Profile appeal is temporarily unavailable', true)
    }
  })

  application.get('/v1/administration/public-profile-appeals', async (request, reply) => {
    const actorMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.moderate',
    )
    if (actorMemberId === undefined) return
    const query = publicProfileAppealQueueQuerySchema.safeParse(request.query)
    if (!query.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_QUERY_INVALID', 'Public Profile appeal query is invalid')
    }
    try {
      const page = await listPendingPublicProfileAppeals({
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        limit: query.data.limit,
        store: dependencies.store,
      })
      return reply.header('cache-control', 'no-store').status(200)
        .send(publicProfileAppealQueueSchema.parse(page))
    } catch (error) {
      if (error instanceof InvalidPublicProfileAppealCursorError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_QUERY_INVALID', 'Public Profile appeal query is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', 'Public Profile appeal is temporarily unavailable', true)
    }
  })

  application.put('/v1/administration/public-profile-appeals/:appealId', async (request, reply) => {
    const actorMemberId = await requireProductMember(
      request,
      reply,
      dependencies.authorizer,
      'profiles.moderate',
    )
    if (actorMemberId === undefined) return
    const params = publicProfileAppealParamsSchema.safeParse(request.params)
    const parsed = publicProfileAppealResolutionRequestSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_RESOLUTION_INVALID', 'Public Profile appeal resolution is invalid')
    }
    try {
      const outcome = await resolvePublicProfileAppeal({
        resolutionId: parsed.data.resolutionId,
        actorMemberId,
        appealId: params.data.appealId,
        command: parsed.data.resolution,
        occurredAt: dependencies.now().toISOString(),
        store: dependencies.store,
      })
      return reply.header('cache-control', 'no-store')
        .status(outcome.status === 'applied' ? 201 : 200)
        .send(publicProfileAppealResolutionResultSchema.parse({
          schemaVersion: 'public-profile-appeal-resolution-result.v1',
          status: outcome.status,
        }))
    } catch (error) {
      if (error instanceof InvalidPublicProfileAppealError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_PROFILE_APPEAL_RESOLUTION_INVALID', 'Public Profile appeal resolution is invalid')
      }
      if (error instanceof PublicProfileAppealTargetNotFoundError) {
        return sendProductProblem(request, reply, 404, 'PLACE_PUBLIC_PROFILE_APPEAL_NOT_FOUND', 'Public Profile appeal not found')
      }
      if (error instanceof PublicProfileAppealTargetChangedError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_TARGET_CHANGED', 'Public Profile moderation changed', true)
      }
      if (error instanceof PublicProfileAppealAlreadyResolvedError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_ALREADY_RESOLVED', 'Public Profile appeal is already resolved')
      }
      if (error instanceof PublicProfileAppealConflictError) {
        return sendProductProblem(request, reply, 409, 'PLACE_PUBLIC_PROFILE_APPEAL_RESOLUTION_CONFLICT', 'Public Profile appeal resolution conflicts with an earlier request')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_PUBLIC_PROFILE_APPEAL_UNAVAILABLE', 'Public Profile appeal is temporarily unavailable', true)
    }
  })
}
