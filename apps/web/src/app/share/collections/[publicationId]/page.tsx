import { notFound } from 'next/navigation'

import styles from '@/features/publications/publication.module.css'
import { PublishedCollectionActions } from '@/features/publications/PublishedCollectionActions'
import { PublishedCollectionPlaces } from '@/features/publications/PublishedCollectionPlaces'
import { getPublicCollection, PublicationNotFoundError } from '@/platform/publications/publication-backend-client'

export const dynamic = 'force-dynamic'

export default async function PublishedCollectionPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const { publicationId } = await params
  let collection
  try {
    collection = await getPublicCollection(publicationId)
  } catch (error) {
    if (error instanceof PublicationNotFoundError) notFound()
    throw error
  }
  return <main className={styles.page}><article className={styles.article}>
    <p className={styles.eyebrow}>Shared collection</p>
    <h1 className={styles.title}>{collection.name}</h1>
    {collection.description && <p className={styles.description}>{collection.description}</p>}
    <PublishedCollectionActions name={collection.name} publicationId={collection.publicationId} />
    <PublishedCollectionPlaces places={collection.places} />
  </article></main>
}
