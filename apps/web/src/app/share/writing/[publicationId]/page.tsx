import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import styles from '@/features/publications/publication.module.css'
import { getPublicWriting, PublicationNotFoundError } from '@/platform/publications/publication-backend-client'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function PublishedWritingPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const { publicationId } = await params
  let writing
  try {
    writing = await getPublicWriting(publicationId)
  } catch (error) {
    if (error instanceof PublicationNotFoundError) notFound()
    throw error
  }
  return <PlaceWorkspaceShell currentPage="explore" familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}>
    <div className={styles.page}><article className={styles.article}>
    <p className={styles.eyebrow}>{writing.kind === 'note' ? '공유 메모' : '공유 글'}</p>
    {writing.kind === 'entry' && <h1 className={styles.title}>{writing.title}</h1>}
    <p className={styles.description}>{writing.body}</p>
    <p className={styles.count}>연결된 장소 {writing.placeIds.length}곳</p>
  </article></div>
  </PlaceWorkspaceShell>
}
