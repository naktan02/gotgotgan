import type { Pool } from 'pg'

import {
  PostgresOidcStore as SharedPostgresOidcStore,
  type OidcStoreEncryption,
} from '@place/browser-auth'

import { placeWebBrowserAuthConfig } from './place-browser-auth-application.ts'

export type { OidcStoreEncryption } from '@place/browser-auth'

export class PostgresOidcStore extends SharedPostgresOidcStore {
  constructor(pool: Pool, encryption: OidcStoreEncryption) {
    super(pool, encryption, placeWebBrowserAuthConfig)
  }
}
