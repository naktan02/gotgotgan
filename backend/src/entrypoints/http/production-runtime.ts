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
import { PostgresLibraryStore, saveImportedPlace } from '../../modules/library/index.js'
import {
  materializeSuggestedPlace,
  createConnectorImportReceiver,
  EncryptedFileCaptureArtifactStore,
  PostgresConnectorImports,
  PostgresImportQueue,
  PostgresImportReview,
  PostgresIngestionStore,
  recordSuggestionObservation,
  type CanonicalPlaceMaterializationPort,
  type ConnectorCaptureParser,
} from '../../modules/ingestion/index.js'
import {
  applyCanonicalResolution,
  PostgresCanonicalResolutionStore,
} from '../../modules/places/index.js'
import {
  createProviderPlaceDetailReader,
  GoogleOfficialPlaceDetails,
  GoogleOfficialPlaceSearch,
  KakaoOfficialPlaceSearch,
  NaverOfficialPlaceSearch,
  OfficialProviderHttpClient,
  parseNaverSavedPlaceCapture,
  type ProviderPlaceDetails,
  type ProviderPlaceSearch,
  type ProviderPlaceSuggestions,
} from '../../modules/providers/index.js'
import {
  createPlaceSearch,
  createPlaceSuggestionMaterialization,
  createPlaceSuggestionSelection,
  createPlaceSuggestions,
  PostgresLocalSearch,
  PostgresPlaceSuggestions,
  projectLocalPlace,
} from '../../modules/search/index.js'
import { PostgresTaxonomyStore } from '../../modules/taxonomy/index.js'
import { PostgresVisitStore } from '../../modules/visits/index.js'
import { PostgresWritingStore } from '../../modules/writing/index.js'
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
    const writingStore = new PostgresWritingStore(pool)
    const localSearch = new PostgresLocalSearch(pool)
    const placeSuggestions = new PostgresPlaceSuggestions(pool)
    const ingestionStore = new PostgresIngestionStore(pool)
    const connectorImports = new PostgresConnectorImports(pool)
    const importQueue = new PostgresImportQueue(pool)
    const importReview = new PostgresImportReview(pool)
    const canonicalStore = new PostgresCanonicalResolutionStore(pool)
    const canonicalMaterialization: CanonicalPlaceMaterializationPort = {
      resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
      apply: (attempt) => applyCanonicalResolution({ ...attempt, store: canonicalStore }),
    }
    const providerHttp = new OfficialProviderHttpClient()
    const providerSearchSources: ProviderPlaceSearch[] = []
    const providerSuggestionSources: ProviderPlaceSuggestions[] = []
    const providerDetailReaders: ProviderPlaceDetails[] = []
    if (config.providers?.naver !== undefined) {
      const naver = new NaverOfficialPlaceSearch(config.providers.naver, providerHttp, now)
      providerSearchSources.push(naver)
      providerSuggestionSources.push(naver)
    }
    if (config.providers?.kakao !== undefined) {
      const kakao = new KakaoOfficialPlaceSearch(config.providers.kakao, providerHttp, now)
      providerSearchSources.push(kakao)
      providerSuggestionSources.push(kakao)
    }
    if (config.providers?.google !== undefined) {
      const google = new GoogleOfficialPlaceSearch(config.providers.google, providerHttp, now)
      providerSearchSources.push(google)
      providerSuggestionSources.push(google)
      providerDetailReaders.push(
        new GoogleOfficialPlaceDetails(config.providers.google, providerHttp, now),
      )
    }
    const suggest = createPlaceSuggestions({
      sources: [placeSuggestions, ...providerSuggestionSources],
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
      library: { authorizer: productAuthorizer, store: libraryStore, now },
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
        managementStore: importReview,
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
      ...(providerDetailReaders.length === 0 ? {} : {
        providers: {
          getDetail: createProviderPlaceDetailReader(providerDetailReaders),
          supportedProviders: providerDetailReaders.map((reader) => reader.providerKey),
        },
      }),
      search: {
        authorizer: productAuthorizer,
        search: createPlaceSearch({ sources: [localSearch, ...providerSearchSources] }),
        suggestions: {
          suggest,
          select: selectSuggestion,
          materialize: materializeSuggestion,
        },
      },
      taxonomy: { store: taxonomyStore },
      visits: { authorizer: productAuthorizer, store: visitStore, now },
      writing: { authorizer: productAuthorizer, store: writingStore, now },
      readiness: async () => {
        await pool.query('SELECT 1')
        return true
      },
    })

    const close = (): Promise<void> => {
      closePromise ??= (async () => {
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
    await pool.end().catch(() => undefined)
    throw error
  }
}
