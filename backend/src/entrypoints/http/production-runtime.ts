import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  authorizeAndAudit,
  createRemoteOidcPrincipalVerifier,
  PostgresAccessStore,
  resolveAccessSubject,
  UnregisteredPrincipalError,
  type OidcPrincipalVerifierConfig,
  type PrincipalVerifier,
} from '../../modules/access/index.js'
import { PostgresLibraryStore, saveImportedPlace } from '../../modules/library/index.js'
import {
  materializeSuggestedPlace,
  PostgresIngestionStore,
  PostgresPlaceImports,
  recordSuggestionObservation,
  type CanonicalPlaceMaterializationPort,
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
    const placeImports = new PostgresPlaceImports(pool)
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
        now,
      },
      library: { authorizer: productAuthorizer, store: libraryStore, now },
      imports: {
        authorizer: productAuthorizer,
        requestStore: placeImports,
        managementStore: placeImports,
        connectionStore: placeImports,
        nextBatchId: randomUUID,
        nextJobId: randomUUID,
        now,
        review: {
          store: placeImports,
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
