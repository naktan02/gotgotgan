import { notFound } from 'next/navigation'

import styles from '@/features/publications/publication.module.css'
import { getPublicWriting, PublicationNotFoundError } from '@/platform/publications/publication-backend-client'

export const dynamic = 'force-dynamic'

export default async function PublishedWritingPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const { publicationId } = await params
  let writing
  try {
    writing = await getPublicWriting(publicationId)
  } catch (error) {
    if (error instanceof PublicationNotFoundError) notFound()
    throw error
  }
  return <main className={styles.page}><article className={styles.article}>
    <p className={styles.eyebrow}>{writing.kind === 'note' ? 'Shared note' : 'Shared entry'}</p>
    {writing.kind === 'entry' && <h1 className={styles.title}>{writing.title}</h1>}
    <p className={styles.description}>{writing.body}</p>
    <ul className={styles.list}>{writing.placeIds.map((placeId) => <li className={styles.item} key={placeId}>Place {placeId}</li>)}</ul>
  </article></main>
}
