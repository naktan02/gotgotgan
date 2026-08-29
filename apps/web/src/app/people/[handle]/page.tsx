import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PublishedProfile } from '@/features/public-profiles/public'
import {
  getPublicProfile,
  PublicProfileNotFoundError,
} from '@/platform/profiles/profile-backend-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function PublicProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  let profile
  try {
    profile = await getPublicProfile(handle)
  } catch (error) {
    if (error instanceof PublicProfileNotFoundError) notFound()
    throw error
  }
  return <main><PublishedProfile initial={profile} /></main>
}
