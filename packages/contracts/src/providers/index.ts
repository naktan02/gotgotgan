import { z } from 'zod'

export const providerKeySchema = z.enum(['naver', 'kakao', 'google'])
