import type { Pool, PoolClient } from 'pg'

import type { PlaceMediaStore } from '../../application/ports/place-media-store.js'
import type {
  DisplayablePlaceMedia,
  MediaAttribution,
  MediaRightsRevision,
  PlaceMediaSource,
} from '../../domain/model.js'

type ExistingSource = Readonly<{ source_fingerprint: string }>
type RightsPointer = Readonly<{ current_rights_revision: number | string | null }>
type ExistingRights = Readonly<{ fingerprint: string }>
type DisplayableRow = Readonly<{
  canonical_place_id: string
  profile_revision: number | string
  media_id: string
  source_kind: 'provider-media' | 'internal-object'
  provider_key: string | null
  provider_media_identity: string | null
  internal_object_reference: string | null
  media_type: 'image'
  width: number | null
  height: number | null
  attribution_required: boolean
  valid_until: Date | string | null
  attributions: unknown
}>

function attributions(value: unknown): readonly MediaAttribution[] {
  if (!Array.isArray(value)) throw new Error('Stored media attribution is invalid.')
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || typeof (entry as { label?: unknown }).label !== 'string') {
      throw new Error('Stored media attribution is invalid.')
    }
    const uri = (entry as { uri?: unknown }).uri
    if (uri !== undefined && typeof uri !== 'string') throw new Error('Stored media attribution is invalid.')
    return { label: (entry as { label: string }).label, uri: uri ?? null }
  })
}

async function recordSourceWithClient(client: PoolClient, source: PlaceMediaSource) {
  const inserted = await client.query(
    `INSERT INTO media.place_media_sources (
       media_id, canonical_place_id, source_observation_id, source_assertion_id, source_kind,
       provider_key, provider_media_identity, internal_object_reference,
       media_type, width, height, content_fingerprint, observed_at,
       source_fingerprint, created_at
     ) VALUES (
       $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14,$15::timestamptz
     ) ON CONFLICT (media_id) DO NOTHING RETURNING media_id`,
    [source.mediaId, source.placeId, source.source.sourceObservationId, source.sourceAssertionId,
      source.source.kind,
      source.source.kind === 'provider-media' ? source.source.providerKey : null,
      source.source.kind === 'provider-media' ? source.source.providerMediaIdentity : null,
      source.source.kind === 'internal-object' ? source.source.objectReference : null,
      source.mediaType, source.size?.width ?? null, source.size?.height ?? null,
      source.contentFingerprint, source.observedAt, source.sourceFingerprint, source.createdAt],
  )
  if (inserted.rowCount === 1) return { status: 'recorded' as const, mediaId: source.mediaId }
  const existing = await client.query<ExistingSource>(
    'SELECT source_fingerprint FROM media.place_media_sources WHERE media_id = $1::uuid',
    [source.mediaId],
  )
  return existing.rows[0]?.source_fingerprint === source.sourceFingerprint
    ? { status: 'replayed' as const, mediaId: source.mediaId }
    : { status: 'rejected' as const, mediaId: source.mediaId, code: 'media-id-reused' as const }
}

export class PostgresPlaceMediaStore implements PlaceMediaStore {
  constructor(private readonly pool: Pool) {}

  async recordSource(source: PlaceMediaSource) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await recordSourceWithClient(client, source)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if ((error as { code?: string }).code === '23503') {
        const constraint = (error as { constraint?: string }).constraint
        return {
          status: 'rejected' as const,
          mediaId: source.mediaId,
          code: constraint === 'place_media_sources_source_observation_id_fkey' ||
            constraint === 'place_media_sources_source_assertion_id_source_fact_kind_fkey'
            ? 'evidence-unavailable' as const
            : 'place-unavailable' as const,
        }
      }
      if ((error as { code?: string }).code === '23505') {
        return { status: 'rejected' as const, mediaId: source.mediaId, code: 'source-identity-reused' as const }
      }
      if (
        (error as { code?: string }).code === '23514' &&
        (error as { message?: string }).message?.includes('eligible media assertion')
      ) {
        return { status: 'rejected' as const, mediaId: source.mediaId, code: 'evidence-unavailable' as const }
      }
      throw error
    } finally {
      client.release()
    }
  }

  async decideRights(rights: MediaRightsRevision) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const source = await client.query<RightsPointer>(
        `SELECT current_rights_revision FROM media.place_media_sources
         WHERE media_id = $1::uuid FOR UPDATE`,
        [rights.mediaId],
      )
      if (source.rows[0] === undefined) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, mediaId: rights.mediaId, code: 'media-unavailable' as const }
      }
      const current = source.rows[0].current_rights_revision === null
        ? null
        : Number(source.rows[0].current_rights_revision)
      const existing = await client.query<ExistingRights>(
        `SELECT fingerprint FROM media.media_rights_revisions
         WHERE media_id = $1::uuid AND revision = $2`,
        [rights.mediaId, rights.revision],
      )
      if (existing.rows[0] !== undefined) {
        await client.query('COMMIT')
        return existing.rows[0].fingerprint === rights.fingerprint
          ? { status: 'replayed' as const, mediaId: rights.mediaId, revision: rights.revision }
          : { status: 'rejected' as const, mediaId: rights.mediaId, code: 'revision-reused' as const }
      }
      if (current !== rights.expectedPreviousRevision) {
        await client.query('ROLLBACK')
        return {
          status: 'rejected' as const,
          mediaId: rights.mediaId,
          code: 'revision-conflict' as const,
          ...(current === null ? {} : { currentRevision: current }),
        }
      }
      await client.query(
        `INSERT INTO media.media_rights_revisions (
           media_id, revision, state, allowed_surfaces, basis, attribution_required,
           license_uri, valid_from, valid_until, decided_by_kind,
           decided_by_reference, decided_at, fingerprint
         ) VALUES (
           $1::uuid,$2,$3,$4::text[],$5,$6,$7,$8::timestamptz,$9::timestamptz,
           $10,$11,$12::timestamptz,$13
         )`,
        [rights.mediaId, rights.revision, rights.state, rights.allowedSurfaces,
          rights.basis, rights.attributionRequired, rights.licenseUri, rights.validFrom,
          rights.validUntil, rights.decidedBy.kind, rights.decidedBy.reference,
          rights.decidedAt, rights.fingerprint],
      )
      for (const [ordinal, attribution] of rights.attributions.entries()) {
        await client.query(
          `INSERT INTO media.media_rights_attributions (
             media_id, rights_revision, ordinal, label, uri
           ) VALUES ($1::uuid,$2,$3,$4,$5)`,
          [rights.mediaId, rights.revision, ordinal, attribution.label, attribution.uri],
        )
      }
      await client.query(
        'SELECT media.activate_media_rights($1::uuid,$2)',
        [rights.mediaId, rights.revision],
      )
      await client.query('COMMIT')
      return { status: 'decided' as const, mediaId: rights.mediaId, revision: rights.revision }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async listDisplayable(input: Parameters<PlaceMediaStore['listDisplayable']>[0]): Promise<readonly DisplayablePlaceMedia[]> {
    const result = await this.pool.query<DisplayableRow>(
      `SELECT canonical_place_id, profile_revision, media_id, source_kind,
              provider_key, provider_media_identity, internal_object_reference,
              media_type, width, height, attribution_required, valid_until, attributions
       FROM media.current_displayable_place_media
       WHERE canonical_place_id = $1::uuid
         AND $2 = ANY(allowed_surfaces)
         AND (valid_until IS NULL OR valid_until > $3::timestamptz)
       ORDER BY ordinal, media_id
       LIMIT $4`,
      [input.placeId, input.surface, input.at, input.limit],
    )
    return result.rows.map((row) => ({
      mediaReferenceId: row.media_id,
      placeId: row.canonical_place_id,
      profileRevision: Number(row.profile_revision),
      mediaType: row.media_type,
      rightsState: row.attribution_required
        ? 'attribution-required' as const
        : 'display-allowed' as const,
      size: row.width === null || row.height === null
        ? null
        : { width: row.width, height: row.height },
      validUntil: row.valid_until === null
        ? null
        : new Date(row.valid_until).toISOString(),
      requiredAttributions: attributions(row.attributions),
      deliverySource: row.source_kind === 'provider-media'
        ? {
            kind: 'provider-media' as const,
            providerKey: row.provider_key!,
            providerMediaIdentity: row.provider_media_identity!,
          }
        : {
            kind: 'internal-object' as const,
            objectReference: row.internal_object_reference!,
          },
    }))
  }
}
