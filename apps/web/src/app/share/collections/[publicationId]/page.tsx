import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import styles from '@/features/publications/publication.module.css'
import { getPublicCollection, PublicationNotFoundError } from '@/platform/publications/publication-backend-client'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { PublishedCollectionWorkspace } from './PublishedCollectionWorkspace'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function PublishedCollectionPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const { publicationId } = await params
  let collection
  try {
    collection = await getPublicCollection(publicationId)
  } catch (error) {
    if (error instanceof PublicationNotFoundError) notFound()
    throw error
  }
  return <PlaceWorkspaceShell currentPage="explore" familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}>
    <div className={styles.sharedPage}>
    <PublishedCollectionWorkspace collection={collection} />
    </div>
  </PlaceWorkspaceShell>
}
