import { z } from 'zod'

import { uuidSchema } from './content.js'

export const authorityRoleSchema = z.enum([
  'member',
  'reviewer',
  'administrator',
  'owner',
])

export const currentMembershipSchema = z.object({
  schemaVersion: z.literal('place-current-membership.v1'),
  membershipId: uuidSchema,
  authorityRole: authorityRoleSchema,
  userGrade: z.string().min(1),
  productTier: z.string().min(1),
}).strict()

export const membershipConsentSchema = z.object({
  document: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(128),
}).strict()

export const membershipOnboardingRequestSchema = z.object({
  acceptedConsents: z.array(membershipConsentSchema).min(1).max(32),
}).strict()

export const currentMembershipConsentsSchema = z.object({
  schemaVersion: z.literal('place-membership-consents.v1'),
  consents: z.array(membershipConsentSchema).min(1).max(32),
}).strict()

export const membershipOnboardingResultSchema = z.object({
  schemaVersion: z.literal('place-membership-onboarding-result.v1'),
  status: z.enum(['created', 'existing']),
  membershipId: uuidSchema,
  authorityRole: authorityRoleSchema,
  userGrade: z.string().min(1),
  productTier: z.string().min(1),
}).strict()

export const authorityRoleChangeRequestSchema = z.object({
  nextRole: z.enum(['member', 'reviewer', 'administrator']),
}).strict()

export const authorityRoleChangeResultSchema = z.object({
  schemaVersion: z.literal('place-authority-role-change-result.v1'),
  status: z.enum(['changed', 'unchanged']),
  membershipId: uuidSchema,
  previousRole: authorityRoleSchema.optional(),
  authorityRole: authorityRoleSchema,
}).strict()

export const problemSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  retryable: z.boolean(),
  correlationRef: z.string().min(1),
}).strict()
