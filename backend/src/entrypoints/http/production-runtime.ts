import { randomBytes, randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  authorizeAndAudit,
  createRemotePlatformEntitlementSource,
  createRemoteOidcPrincipalVerifier,
  PostgresAccessStore,
  resolveAccessSubject,
  synchronizePlatformOwner,
  UnregisteredPrincipalError,
  type OidcPrincipalVerifierConfig,
  type PrincipalVerifier,
} from '../../modules/access/index.js'
import {
  InvalidLibraryCursorError,
  PostgresLibraryQueries,
  PostgresLibraryStore,
  saveImportedPlace,
} from '../../modules/library/index.js'
import {
  materializeSuggestedPlace,
  createConnectorImportReceiver,
  EncryptedFileCaptureArtifactStore,
  PostgresConnectorImports,
  PostgresImportManagement,
  PostgresImportQueries,
  PostgresImportQueue,
  PostgresImportReview,
  PostgresIngestionStore,
  recordSuggestionObservation,
  type CanonicalPlaceMaterializationPort,
  type ConnectorCaptureParser,
} from '../../modules/ingestion/index.js'
import {
  applyCanonicalResolution,
  createPlaceDetailReader,
  PostgresCanonicalResolutionStore,
} from '../../modules/places/index.js'
import {
  parseNaverSavedPlaceCapture,
} from '../../modules/providers/index.js'
import {
  InvalidPublicProfileCursorError,
  PostgresPublicProfileAppealStore,
  PostgresPublicProfileSafetyStore,
  PostgresPublicProfileStore,
} from '../../modules/profiles/index.js'
import {
  createCatalogPlaceSearch,
  createPlaceSearch,
  createPlaceSuggestionMaterialization,
  createPlaceSuggestionSelection,
  createPlaceSuggestions,
  PostgresLocalSearch,
  PostgresPlaceSuggestions,
  projectLocalPlace,
} from '../../modules/search/index.js'
import { PostgresAreaCatalog } from '../../modules/areas/index.js'
import { PostgresTaxonomyStore } from '../../modules/taxonomy/index.js'
import { PostgresVisitQueries, PostgresVisitStore } from '../../modules/visits/index.js'
import { PostgresWritingQueries, PostgresWritingStore } from '../../modules/writing/index.js'
import type { ProductAuthorizer } from '../../platform/http/product-authorization.js'
import { buildHttpApplication } from './app.js'
import type { ProductionHttpConfig } from './config.js'

type ProductionRuntimeDependencies = Readonly<{
  createPrincipalVerifier?: (config: OidcPrincipalVerifierConfig) => PrincipalVerifier
  nextMembershipId?: () => string
  now?: () => Date
}>

export async function createProductionHttpRuntime(
  config: ProductionHttpConfig,
  dependencies: ProductionRuntimeDependencies = {},
) {
  const principalVerifier = (
    dependencies.createPrincipalVerifier ?? createRemoteOidcPrincipalVerifier
  )(config.authentication.oidc)
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  let closePromise: Promise<void> | undefined
  let profileReportCleanupTimer: NodeJS.Timeout | undefined

  try {
    await pool.query('SELECT 1')
    const store = new PostgresAccessStore(pool)
    const now = dependencies.now ?? (() => new Date())
    const platformEntitlementSource = config.platformAccess === undefined
      ? undefined
      : createRemotePlatformEntitlementSource({
          endpoint: config.platformAccess.endpoint,
          jwksUri: config.platformAccess.jwksUri,
          assertionIssuer: config.platformAccess.assertionIssuer,
          audience: config.platformAccess.audience,
          timeoutMs: config.platformAccess.timeoutMilliseconds,
        })
    const productAuthorizer: ProductAuthorizer = async (authorization, permission) => {
      const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1]
      if (token === undefined) return { status: 'authentication-required' }
      let principal
      try {
        principal = await principalVerifier.verify(token)
      } catch {
        return { status: 'authentication-required' }
      }
      try {
        if (platformEntitlementSource !== undefined) {
          const evidence = await platformEntitlementSource.evaluate({
            accessToken: token,
            principal,
          })
          await synchronizePlatformOwner({ principal, evidence, store, now })
        }
        const subject = await resolveAccessSubject(principal, store)
        const decision = await authorizeAndAudit({ subject, request: { permission }, auditSink: store, now })
        return decision.allowed && subject.kind === 'member'
          ? { status: 'authorized', memberId: subject.membership.id }
          : { status: 'access-denied' }
      } catch (error) {
        if (error instanceof UnregisteredPrincipalError) return { status: 'access-denied' }
        throw error
      }
    }
    const libraryStore = new PostgresLibraryStore(pool)
    const visitStore = new PostgresVisitStore(pool)
    const visitQueries = new PostgresVisitQueries(pool)
    const writingStore = new PostgresWritingStore(pool)
    const writingQueries = new PostgresWritingQueries(pool)
    const localSearch = new PostgresLocalSearch(pool)
    const toLibraryPlaceSummary = (document: Awaited<ReturnType<typeof localSearch.getPlaceDocuments>>[number]) => ({
      placeId: document.placeId,
      name: document.name,
      areaLabel: document.areaLabel,
      location: { latitude: document.latitude, longitude: document.longitude },
      primaryTaxonomy: document.primaryTaxonomy,
      taxonomyKeys: document.taxonomyKeys,
      evidence: {
        status: document.evidenceStatus,
        projectedAt: document.projectedAt,
      },
    })
    const libraryQueries = new PostgresLibraryQueries(
      pool,
      async (placeIds) => (await localSearch.getPlaceDocuments(placeIds)).map(toLibraryPlaceSummary),
      async (input) => {
        const read = await localSearch.getPlaceDocumentsInBounds(input.placeIds, input.bounds)
        return {
          places: read.documents.map(toLibraryPlaceSummary),
          unprojectedPlaceCount: read.unprojectedPlaceCount,
        }
      },
    )
    const publicProfileStore = new PostgresPublicProfileStore(pool)
    const publicProfileSafetyStore = new PostgresPublicProfileSafetyStore(pool)
    const publicProfileAppealStore = new PostgresPublicProfileAppealStore(pool)
    const placeSuggestions = new PostgresPlaceSuggestions(pool)
    const ingestionStore = new PostgresIngestionStore(pool)
    const connectorImports = new PostgresConnectorImports(pool)
    const importQueue = new PostgresImportQueue(pool)
    const importManagement = new PostgresImportManagement(pool)
    const importQueries = new PostgresImportQueries(pool)
    const importReview = new PostgresImportReview(pool)
    const canonicalStore = new PostgresCanonicalResolutionStore(pool)
    const readPlaceDetail = createPlaceDetailReader({
      canonical: canonicalStore,
      readDocument: async (placeId) => {
        const document = await localSearch.getPlaceDocument(placeId)
        return document === undefined ? undefined : {
          placeId: document.placeId,
          name: document.name,
          areaLabel: document.areaLabel,
          location: {
            latitude: document.latitude,
            longitude: document.longitude,
          },
          primaryTaxonomy: document.primaryTaxonomy,
          taxonomyKeys: document.taxonomyKeys,
          evidenceStatus: document.evidenceStatus,
          projectedAt: document.projectedAt,
        }
      },
      readPersonal: async (memberId, placeId) => {
        const [preferences, visits] = await Promise.all([
          libraryStore.getPlacePreferences(memberId, placeId),
          visitStore.summarize(memberId, placeId),
        ])
        return {
          ...(preferences === undefined ? {} : { preferences }),
          visits,
        }
      },
    })
    const canonicalMaterialization: CanonicalPlaceMaterializationPort = {
      resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
      apply: (attempt) => applyCanonicalResolution({ ...attempt, store: canonicalStore }),
    }
    const suggest = createPlaceSuggestions({
      sources: [placeSuggestions],
      store: placeSuggestions,
      nextId: randomUUID,
      now,
    })
    const selectSuggestion = createPlaceSuggestionSelection({
      store: placeSuggestions,
      now,
      recordObservation: async (input) => (
        await recordSuggestionObservation(input, ingestionStore)
      ).status,
    })
    const materializeSuggestion = createPlaceSuggestionMaterialization({
      store: placeSuggestions,
      now,
      materialize: async (input) => {
        const result = await materializeSuggestedPlace({
          input,
          ingestionStore,
          canonical: canonicalMaterialization,
        })
        if (input.location !== null) {
          await projectLocalPlace({
            placeId: result.canonicalPlaceId,
            sourceVersion: 1,
            name: input.name,
            areaLabel: input.areaLabel,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            primaryTaxonomy: null,
            taxonomyKeys: [],
            evidenceStatus: 'unverified',
            projectedAt: input.acquiredAt,
          }, localSearch)
        }
        return result
      },
    })
    const taxonomyStore = new PostgresTaxonomyStore(pool)
    const areaCatalog = new PostgresAreaCatalog(pool)
    const connector = config.connector === undefined
      ? undefined
      : createConnectorImportReceiver({
          store: connectorImports,
          artifacts: new EncryptedFileCaptureArtifactStore({
            ...config.connector.artifacts,
            now,
          }),
          parsers: [{
            providerKey: 'naver',
            parserVersion: 'naver-saved-place.v1',
            acquisitionKind: 'browser-network',
            parse: (input) => {
              const parsed = parseNaverSavedPlaceCapture(input)
              return parsed.kind === 'page' ? parsed : { kind: 'rejected' as const }
            },
          } satisfies ConnectorCaptureParser],
          config: config.connector,
          nextId: randomUUID,
          nextToken: () => randomBytes(32).toString('base64url'),
          now,
        })
    const application = buildHttpApplication({
      access: {
        principalVerifier,
        membershipDirectory: store,
        auditSink: store,
        onboarding: {
          policy: config.membershipPolicy,
          store,
          nextMembershipId: dependencies.nextMembershipId ?? randomUUID,
        },
        authorityManagement: { store },
        ...(platformEntitlementSource === undefined ? {} : {
          platformAccess: { source: platformEntitlementSource, store },
        }),
        now,
      },
      library: {
        authorizer: productAuthorizer,
        store: libraryStore,
        queries: libraryQueries,
        now,
      },
      ...(connector === undefined ? {} : {
        connector: {
          authorizer: productAuthorizer,
          receiver: connector,
          maximumCaptureRequestBytes:
            config.connector!.limits.maximumBatchBytes * 2 + 65_536,
        },
      }),
      imports: {
        authorizer: productAuthorizer,
        requestStore: importQueue,
        managementStore: importManagement,
        queries: importQueries,
        connectionStore: connectorImports,
        nextBatchId: randomUUID,
        nextJobId: randomUUID,
        now,
        review: {
          store: importReview,
          ingestionStore,
          canonical: canonicalMaterialization,
          library: {
            saveImportedPlace: (input) => saveImportedPlace({ ...input, store: libraryStore }),
          },
        },
      },
      places: {
        authorizer: productAuthorizer,
        read: readPlaceDetail,
      },
      profiles: {
        authorizer: productAuthorizer,
        store: publicProfileStore,
        safety: publicProfileSafetyStore,
        appeals: publicProfileAppealStore,
        collections: async (input) => {
          try {
            return await libraryQueries.listPublicCollectionsByOwner(input)
          } catch (error) {
            if (error instanceof InvalidLibraryCursorError) {
              throw new InvalidPublicProfileCursorError('Public Profile cursor is invalid')
            }
            throw error
          }
        },
        now,
      },
      search: {
        authorizer: productAuthorizer,
        search: createPlaceSearch({ sources: [localSearch] }),
        catalog: createCatalogPlaceSearch({
          source: localSearch,
          vocabulary: {
            listAreas: () => areaCatalog.listCurrent(),
            listTaxonomies: async () => (await taxonomyStore.listCurrent())
              .filter((node) => node.active)
              .map(({ key, version, parentKey, label, kind }) => ({
                key, version, parentKey, label, kind,
              })),
          },
        }),
        suggestions: {
          suggest,
          select: selectSuggestion,
          materialize: materializeSuggestion,
        },
      },
      taxonomy: { store: taxonomyStore },
      visits: {
        authorizer: productAuthorizer,
        store: visitStore,
        queries: visitQueries,
        now,
      },
      writing: {
        authorizer: productAuthorizer,
        store: writingStore,
        queries: writingQueries,
        now,
      },
      readiness: async () => {
        await pool.query('SELECT 1')
        return true
      },
    })

    const cleanupExpiredProfileReports = async () => {
      await publicProfileSafetyStore.deleteExpiredReports({
        now: now().toISOString(),
        limit: 500,
      })
    }
    await cleanupExpiredProfileReports()
    profileReportCleanupTimer = setInterval(() => {
      void cleanupExpiredProfileReports().catch(() => undefined)
    }, 60 * 60 * 1_000)
    profileReportCleanupTimer.unref()

    const close = (): Promise<void> => {
      closePromise ??= (async () => {
        if (profileReportCleanupTimer !== undefined) {
          clearInterval(profileReportCleanupTimer)
          profileReportCleanupTimer = undefined
        }
        await application.close()
        await pool.end()
      })()
      return closePromise
    }

    return {
      application,
      listen: () => application.listen(config.listener),
      close,
    }
  } catch (error) {
    if (profileReportCleanupTimer !== undefined) clearInterval(profileReportCleanupTimer)
    await pool.end().catch(() => undefined)
    throw error
  }
}
