import type { Pool, PoolClient } from 'pg'

import type { WritingStore } from '../../application/ports/writing-store.js'
import type {
  PublishedWriting,
  MemberWriting,
  WritingAttempt,
  WritingCommandOutcome,
} from '../../domain/model.js'

type Receipt = Readonly<{
  command_fingerprint: string
  outcome: 'applied' | 'not-found' | 'version-conflict'
}>

export class PostgresWritingStore implements WritingStore {
  constructor(private readonly pool: Pool) {}

  async apply(attempt: WritingAttempt): Promise<WritingCommandOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('place.writing.v1:' || $1, 0))", [attempt.commandId])
      const prior = await client.query<Receipt>(
        'SELECT command_fingerprint, outcome FROM writing.command_receipts WHERE command_id = $1',
        [attempt.commandId],
      )
      if (prior.rows[0] !== undefined) {
        await client.query('COMMIT')
        return prior.rows[0].command_fingerprint === attempt.fingerprint
          ? { status: 'replayed' }
          : { status: 'conflict' }
      }

      const result = await this.applyCommand(client, attempt)
      await client.query(
        `INSERT INTO writing.command_receipts
          (command_id, membership_id, command_kind, command_fingerprint, outcome,
           document_id, document_version, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [attempt.commandId, attempt.memberId, attempt.command.kind, attempt.fingerprint,
          result.status, attempt.command.documentId,
          result.status === 'applied' ? result.version : null, attempt.occurredAt],
      )
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async applyCommand(
    client: PoolClient,
    attempt: WritingAttempt,
  ): Promise<
    | Readonly<{ status: 'applied'; documentId: string; version: number }>
    | Readonly<{ status: 'not-found' | 'version-conflict' }>
  > {
    const command = attempt.command
    const note = command.kind === 'create-note' || command.kind === 'update-note'
    const documentKind = note ? 'note' : 'entry'
    const title = note ? null : command.title
    const placeIds = note ? [command.placeId] : command.placeIds
    const publicationId = command.publicationId ?? null
    let version: number

    if (command.kind === 'create-note' || command.kind === 'create-entry') {
      const inserted = await client.query<{ version: string }>(
        `INSERT INTO writing.documents
          (id, owner_membership_id, kind, title, body, visibility, publication_id, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
         ON CONFLICT (id) DO NOTHING RETURNING version`,
        [command.documentId, attempt.memberId, documentKind, title, command.body,
          command.visibility, publicationId, attempt.occurredAt],
      )
      if (inserted.rows[0] === undefined) return { status: 'version-conflict' }
      version = Number(inserted.rows[0].version)
    } else {
      const updated = await client.query<{ version: string }>(
        `UPDATE writing.documents SET title = $4, body = $5, visibility = $6,
            publication_id = $7, version = version + 1, updated_at = $8
         WHERE id = $1 AND owner_membership_id = $2 AND kind = $3 AND version = $9
         RETURNING version`,
        [command.documentId, attempt.memberId, documentKind, title, command.body,
          command.visibility, publicationId, attempt.occurredAt, command.expectedVersion],
      )
      if (updated.rows[0] === undefined) {
        const exists = await client.query(
          'SELECT 1 FROM writing.documents WHERE id = $1 AND owner_membership_id = $2',
          [command.documentId, attempt.memberId],
        )
        return { status: exists.rowCount === 0 ? 'not-found' : 'version-conflict' }
      }
      version = Number(updated.rows[0].version)
      await client.query('DELETE FROM writing.document_place_links WHERE document_id = $1', [command.documentId])
    }

    for (const [position, placeId] of placeIds.entries()) {
      await client.query(
        `INSERT INTO writing.document_place_links (document_id, canonical_place_id, position)
         VALUES ($1,$2,$3)`,
        [command.documentId, placeId, position],
      )
    }
    await client.query(
      `INSERT INTO writing.document_revisions
        (document_id, version, title, body, visibility, publication_id, canonical_place_ids, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [command.documentId, version, title, command.body, command.visibility,
        publicationId, placeIds, attempt.occurredAt],
    )
    return { status: 'applied', documentId: command.documentId, version }
  }

  async getPublished(publicationId: string): Promise<PublishedWriting | undefined> {
    const document = await this.pool.query<{
      kind: 'note' | 'entry'
      title: string | null
      body: string
      visibility: 'unlisted' | 'public'
      updated_at: Date
      place_ids: string[]
    }>(
      `SELECT d.kind, d.title, d.body, d.visibility, d.updated_at,
              array_agg(l.canonical_place_id ORDER BY l.position) AS place_ids
       FROM writing.documents d JOIN writing.document_place_links l ON l.document_id = d.id
       WHERE d.publication_id = $1 AND d.visibility IN ('unlisted', 'public')
       GROUP BY d.id`,
      [publicationId],
    )
    const row = document.rows[0]
    if (row === undefined) return undefined
    const common = {
      publicationId,
      visibility: row.visibility,
      body: row.body,
      placeIds: row.place_ids,
      updatedAt: row.updated_at.toISOString(),
    }
    return row.kind === 'entry'
      ? { kind: 'entry', ...common, title: row.title! }
      : { kind: 'note', ...common, placeIds: common.placeIds as [string] }
  }

  async listMemberWriting(memberId: string): Promise<readonly MemberWriting[]> {
    const result = await this.pool.query<{
      id: string
      kind: 'note' | 'entry'
      title: string | null
      body: string
      visibility: 'private' | 'unlisted' | 'public'
      publication_id: string | null
      version: string
      updated_at: Date
      place_ids: string[]
    }>(
      `SELECT d.id, d.kind, d.title, d.body, d.visibility, d.publication_id, d.version, d.updated_at,
              array_agg(l.canonical_place_id ORDER BY l.position) AS place_ids
       FROM writing.documents d JOIN writing.document_place_links l ON l.document_id = d.id
       WHERE d.owner_membership_id = $1 GROUP BY d.id ORDER BY d.updated_at DESC, d.id`,
      [memberId],
    )
    return result.rows.map((row) => ({
      documentId: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      visibility: row.visibility,
      publicationId: row.publication_id,
      version: Number(row.version),
      placeIds: row.place_ids,
      updatedAt: row.updated_at.toISOString(),
    }))
  }
}
