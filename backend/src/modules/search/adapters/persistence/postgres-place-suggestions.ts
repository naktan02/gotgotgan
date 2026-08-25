import { createHash } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import type {
  PlaceSuggestionSource,
  SuggestionSourceBatch,
} from '../../application/ports/place-suggestion-source.js'
import type { PlaceSuggestionStore } from '../../application/ports/place-suggestion-store.js'
import type {
  PlaceSuggestionCandidate,
  PlaceSuggestionQuery,
  StoredPlaceSuggestion,
  SuggestionImpression,
  SuggestionSession,
} from '../../domain/suggestions.js'

type SuggestionRow = Readonly<{
  suggestion_id: string
  session_id: string
  candidate_key: string
  identity_kind: 'canonical' | 'provider'
  canonical_place_id: string | null
  provider_key: 'naver' | 'kakao' | 'google' | null
  provider_place_id: string | null
  source_key: string
  source_label: string
  external_uri: string | null
  details_available: boolean
  attributions: readonly Readonly<{ label: string; uri?: string }>[]
  display_name: string
  area_label: string | null
  category_label: string | null
  latitude: number | null
  longitude: number | null
  observed_at: string | Date
  observation_id: string | null
  candidate_id: string | null
  decision_id: string | null
  proposed_place_id: string | null
  created_at: string | Date
  expires_at: string | Date
  selected_at: string | Date | null
  materialized_at: string | Date | null
}>

type LocalSuggestionRow = Readonly<{
  candidate_key: string
  identity_kind: 'canonical' | 'provider'
  canonical_place_id: string | null
  provider_key: 'naver' | 'kakao' | 'google' | null
  provider_place_id: string | null
  source_key: string
  source_label: string
  external_uri: string | null
  details_available: boolean
  attributions: readonly Readonly<{ label: string; uri?: string }>[]
  display_name: string
  area_label: string | null
  category_label: string | null
  latitude: number | null
  longitude: number | null
  observed_at: string | Date
}>

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function rowCandidate(row: LocalSuggestionRow | SuggestionRow): PlaceSuggestionCandidate {
  const identity = row.identity_kind === 'canonical'
    ? { kind: 'canonical' as const, placeId: row.canonical_place_id! }
    : {
      kind: 'provider' as const,
      providerKey: row.provider_key!,
      ...(row.provider_place_id === null ? {} : { providerPlaceId: row.provider_place_id }),
    }
  return {
    candidateKey: row.candidate_key,
    identity,
    source: {
      key: row.source_key,
      label: row.source_label,
      ...(row.external_uri === null ? {} : { externalUri: row.external_uri }),
      detailsAvailable: row.details_available,
      attributions: row.attributions,
    },
    name: row.display_name,
    areaLabel: row.area_label,
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    categoryLabel: row.category_label,
    observedAt: iso(row.observed_at),
  }
}

function storedSuggestion(row: SuggestionRow): StoredPlaceSuggestion {
  return {
    suggestionId: row.suggestion_id,
    sessionId: row.session_id,
    candidate: rowCandidate(row),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    ...(row.observation_id === null ? {} : { observationId: row.observation_id }),
    ...(row.candidate_id === null ? {} : { candidateId: row.candidate_id }),
    ...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
    ...(row.proposed_place_id === null ? {} : { proposedPlaceId: row.proposed_place_id }),
    ...(row.selected_at === null ? {} : { selectedAt: iso(row.selected_at) }),
    ...(row.materialized_at === null ? {} : { materializedAt: iso(row.materialized_at) }),
  }
}

function discoveryKey(candidate: PlaceSuggestionCandidate): string {
  const identity = candidate.identity.kind === 'provider' && candidate.identity.providerPlaceId !== undefined
    ? [candidate.identity.providerKey, candidate.identity.providerPlaceId]
    : [candidate.source.key, candidate.candidateKey, candidate.name, candidate.areaLabel, candidate.location]
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

function searchText(candidate: PlaceSuggestionCandidate): string {
  return [candidate.name, candidate.areaLabel, candidate.categoryLabel]
    .filter((value): value is string => value !== null)
    .join(' ').normalize('NFKC').toLocaleLowerCase()
}

async function readSuggestion(
  client: PoolClient,
  suggestionId: string,
  at: string,
  lock: boolean,
): Promise<SuggestionRow | undefined> {
  const result = await client.query<SuggestionRow>(
    `SELECT
       impression.*,
       CASE WHEN impression.location IS NULL THEN NULL ELSE ST_Y(impression.location) END AS latitude,
       CASE WHEN impression.location IS NULL THEN NULL ELSE ST_X(impression.location) END AS longitude
     FROM search.suggestion_impressions AS impression
     JOIN search.suggestion_sessions AS session ON session.id = impression.session_id
     WHERE impression.suggestion_id = $1::uuid
       AND impression.expires_at > $2::timestamptz
       AND session.expires_at > $2::timestamptz
       AND session.closed_at IS NULL
     ${lock ? 'FOR UPDATE OF impression' : ''}`,
    [suggestionId, at],
  )
  return result.rows[0]
}

export class PostgresPlaceSuggestions implements PlaceSuggestionSource, PlaceSuggestionStore {
  readonly sourceKey = 'local'

  constructor(private readonly pool: Pool) {}

  async openSession(input: Readonly<{
    requestedSessionId?: string
    newSession: SuggestionSession
    now: string
  }>): Promise<SuggestionSession> {
    if (input.requestedSessionId !== undefined) {
      const reused = await this.pool.query<{
        id: string; created_at: string | Date; expires_at: string | Date
      }>(
        `UPDATE search.suggestion_sessions
         SET last_used_at = $2::timestamptz,
             expires_at = GREATEST(expires_at, $3::timestamptz)
         WHERE id = $1::uuid AND expires_at > $2::timestamptz AND closed_at IS NULL
         RETURNING id, created_at, expires_at`,
        [input.requestedSessionId, input.now, input.newSession.expiresAt],
      )
      const row = reused.rows[0]
      if (row !== undefined) {
        return { id: row.id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) }
      }
    }
    await this.pool.query(
      `INSERT INTO search.suggestion_sessions (id, created_at, last_used_at, expires_at)
       VALUES ($1::uuid, $2::timestamptz, $2::timestamptz, $3::timestamptz)`,
      [input.newSession.id, input.newSession.createdAt, input.newSession.expiresAt],
    )
    return input.newSession
  }

  async recordImpressions(input: Readonly<{
    sessionId: string
    impressions: readonly SuggestionImpression[]
  }>): Promise<readonly StoredPlaceSuggestion[]> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'SELECT 1 FROM search.suggestion_sessions WHERE id = $1::uuid FOR UPDATE',
        [input.sessionId],
      )
      const stored: StoredPlaceSuggestion[] = []
      for (const impression of input.impressions) {
        const prior = await client.query<{ suggestion_id: string }>(
          `SELECT suggestion_id FROM search.suggestion_impressions
           WHERE session_id = $1::uuid AND candidate_key = $2`,
          [input.sessionId, impression.candidate.candidateKey],
        )
        const candidate = impression.candidate
        if (prior.rows[0] === undefined) {
          const key = candidate.identity.kind === 'provider' ? discoveryKey(candidate) : null
          if (candidate.identity.kind === 'provider') {
            await client.query(
              `INSERT INTO search.discovery_candidates (
                 discovery_key, candidate_key, provider_key, provider_place_id,
                 source_key, source_label, external_uri, details_available, attributions,
                 display_name, area_label, category_label, search_text, location,
                 observed_at, first_seen_at, last_seen_at, expires_at
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,
                 CASE WHEN $14::double precision IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint($15, $14), 4326) END,
                 $16::timestamptz,$17::timestamptz,$17::timestamptz,$18::timestamptz
               )
               ON CONFLICT (discovery_key) DO UPDATE SET
                 candidate_key = EXCLUDED.candidate_key,
                 provider_place_id = EXCLUDED.provider_place_id,
                 source_key = EXCLUDED.source_key,
                 source_label = EXCLUDED.source_label,
                 external_uri = EXCLUDED.external_uri,
                 details_available = EXCLUDED.details_available,
                 attributions = EXCLUDED.attributions,
                 display_name = EXCLUDED.display_name,
                 area_label = EXCLUDED.area_label,
                 category_label = EXCLUDED.category_label,
                 search_text = EXCLUDED.search_text,
                 location = EXCLUDED.location,
                 observed_at = EXCLUDED.observed_at,
                 last_seen_at = EXCLUDED.last_seen_at,
                 expires_at = GREATEST(search.discovery_candidates.expires_at, EXCLUDED.expires_at),
                 impression_count = search.discovery_candidates.impression_count + 1`,
              [
                key, candidate.candidateKey, candidate.identity.providerKey,
                candidate.identity.providerPlaceId ?? null, candidate.source.key,
                candidate.source.label, candidate.source.externalUri ?? null,
                candidate.source.detailsAvailable, JSON.stringify(candidate.source.attributions),
                candidate.name, candidate.areaLabel, candidate.categoryLabel, searchText(candidate),
                candidate.location?.latitude ?? null, candidate.location?.longitude ?? null,
                candidate.observedAt, impression.createdAt, impression.expiresAt,
              ],
            )
          }
          await client.query(
            `INSERT INTO search.suggestion_impressions (
               suggestion_id, session_id, candidate_key, identity_kind,
               canonical_place_id, provider_key, provider_place_id, discovery_key,
               source_key, source_label, external_uri, details_available, attributions,
               display_name, area_label, category_label, location, observed_at,
               observation_id, candidate_id, decision_id, proposed_place_id,
               created_at, expires_at
             ) VALUES (
               $1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
               $14,$15,$16,
               CASE WHEN $17::double precision IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($18, $17), 4326) END,
               $19::timestamptz,$20::uuid,$21::uuid,$22::uuid,$23::uuid,
               $24::timestamptz,$25::timestamptz
             )`,
            [
              impression.suggestionId, input.sessionId, candidate.candidateKey,
              candidate.identity.kind,
              candidate.identity.kind === 'canonical' ? candidate.identity.placeId : null,
              candidate.identity.kind === 'provider' ? candidate.identity.providerKey : null,
              candidate.identity.kind === 'provider'
                ? candidate.identity.providerPlaceId ?? null
                : null,
              key,
              candidate.source.key, candidate.source.label, candidate.source.externalUri ?? null,
              candidate.source.detailsAvailable, JSON.stringify(candidate.source.attributions),
              candidate.name, candidate.areaLabel, candidate.categoryLabel,
              candidate.location?.latitude ?? null, candidate.location?.longitude ?? null,
              candidate.observedAt, impression.observationId ?? null,
              impression.candidateId ?? null, impression.decisionId ?? null,
              impression.proposedPlaceId ?? null, impression.createdAt, impression.expiresAt,
            ],
          )
        } else {
          await client.query(
            `UPDATE search.suggestion_impressions
             SET expires_at = GREATEST(expires_at, $2::timestamptz)
             WHERE suggestion_id = $1::uuid`,
            [prior.rows[0].suggestion_id, impression.expiresAt],
          )
        }
        const row = await readSuggestion(
          client,
          prior.rows[0]?.suggestion_id ?? impression.suggestionId,
          impression.createdAt,
          false,
        )
        if (row !== undefined) stored.push(storedSuggestion(row))
      }
      await client.query('COMMIT')
      return stored
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async suggest(query: Omit<PlaceSuggestionQuery, 'sessionId'> & Readonly<{
    sessionId: string
  }>): Promise<SuggestionSourceBatch> {
    const normalized = query.query.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    const area = query.areaText?.normalize('NFKC').trim().toLocaleLowerCase() ?? null
    const bounds = query.bounds
    const result = await this.pool.query<LocalSuggestionRow>(
      `WITH candidates AS (
         SELECT
           'canonical:' || place_id::text AS candidate_key,
           'canonical'::text AS identity_kind,
           place_id AS canonical_place_id,
           NULL::text AS provider_key,
           NULL::text AS provider_place_id,
           'local'::text AS source_key,
           'Place'::text AS source_label,
           NULL::text AS external_uri,
           false AS details_available,
           '[]'::jsonb AS attributions,
           display_name,
           area_label,
           primary_taxonomy_label AS category_label,
           location,
           projected_at AS observed_at,
           search_text,
           2.0 + similarity(search_text, $1) AS score
         FROM search.place_documents
         WHERE (search_text % $1 OR search_text LIKE '%' || $1 || '%')
           AND ($3::double precision IS NULL OR location && ST_MakeEnvelope($3,$4,$5,$6,4326))
         UNION ALL
         SELECT
           candidate_key,
           'provider'::text,
           NULL::uuid,
           provider_key,
           provider_place_id,
           source_key,
           source_label,
           external_uri,
           details_available,
           attributions,
           display_name,
           area_label,
           category_label,
           location,
           observed_at,
           search_text,
           similarity(search_text, $1)
             + CASE WHEN display_name ILIKE $1 || '%' THEN 1.0 ELSE 0 END
             + CASE WHEN $2::text IS NOT NULL AND area_label ILIKE '%' || $2 || '%' THEN 0.5 ELSE 0 END
         FROM search.discovery_candidates
         WHERE expires_at > CURRENT_TIMESTAMP
           AND (search_text % $1 OR search_text LIKE '%' || $1 || '%')
           AND ($3::double precision IS NULL OR location IS NULL OR location && ST_MakeEnvelope($3,$4,$5,$6,4326))
       )
       SELECT
         candidate_key, identity_kind, canonical_place_id, provider_key, provider_place_id,
         source_key, source_label, external_uri, details_available, attributions,
         display_name, area_label, category_label,
         CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location) END AS latitude,
         CASE WHEN location IS NULL THEN NULL ELSE ST_X(location) END AS longitude,
         observed_at
       FROM candidates
       ORDER BY score DESC, display_name ASC, candidate_key ASC
       LIMIT $7`,
      [
        normalized, area, bounds?.west ?? null, bounds?.south ?? null,
        bounds?.east ?? null, bounds?.north ?? null, query.limit,
      ],
    )
    return { status: 'complete', items: result.rows.map(rowCandidate) }
  }

  async select(suggestionId: string, selectedAt: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const row = await readSuggestion(client, suggestionId, selectedAt, true)
      if (row === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      const first = row.selected_at === null
      if (first) {
        await client.query(
          `UPDATE search.suggestion_impressions SET selected_at = $2::timestamptz
           WHERE suggestion_id = $1::uuid`,
          [suggestionId, selectedAt],
        )
        await client.query(
          `UPDATE search.discovery_candidates
           SET selection_count = selection_count + 1
           WHERE discovery_key = (
             SELECT discovery_key FROM search.suggestion_impressions WHERE suggestion_id = $1::uuid
           )`,
          [suggestionId],
        )
      }
      await client.query('COMMIT')
      return {
        status: first ? 'recorded' as const : 'replayed' as const,
        suggestion: storedSuggestion({ ...row, selected_at: row.selected_at ?? selectedAt }),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markMaterialized(suggestionId: string, materializedAt: string) {
    const result = await this.pool.query(
      `UPDATE search.suggestion_impressions
       SET materialized_at = $2::timestamptz
       WHERE suggestion_id = $1::uuid AND expires_at > $2::timestamptz
         AND materialized_at IS NULL
       RETURNING suggestion_id`,
      [suggestionId, materializedAt],
    )
    return result.rows[0] === undefined ? 'replayed' as const : 'recorded' as const
  }

  async cleanupExpired(now: string, limit: number) {
    const suggestions = await this.pool.query(
      `DELETE FROM search.suggestion_impressions
       WHERE suggestion_id IN (
         SELECT suggestion_id FROM search.suggestion_impressions
         WHERE expires_at <= $1::timestamptz ORDER BY expires_at, suggestion_id LIMIT $2
       )`,
      [now, limit],
    )
    const sessions = await this.pool.query(
      `DELETE FROM search.suggestion_sessions
       WHERE id IN (
         SELECT session.id FROM search.suggestion_sessions AS session
         WHERE session.expires_at <= $1::timestamptz
           AND NOT EXISTS (
             SELECT 1 FROM search.suggestion_impressions AS impression
             WHERE impression.session_id = session.id
           )
         ORDER BY session.expires_at, session.id LIMIT $2
       )`,
      [now, limit],
    )
    const discoveries = await this.pool.query(
      `DELETE FROM search.discovery_candidates
       WHERE discovery_key IN (
         SELECT discovery_key FROM search.discovery_candidates
         WHERE expires_at <= $1::timestamptz ORDER BY expires_at, discovery_key LIMIT $2
       )`,
      [now, limit],
    )
    return {
      sessions: sessions.rowCount ?? 0,
      suggestions: suggestions.rowCount ?? 0,
      discoveries: discoveries.rowCount ?? 0,
    }
  }
}
