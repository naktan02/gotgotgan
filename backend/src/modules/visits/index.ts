export {
  InvalidVisitError,
  VisitIdConflictError,
  type VisitRecord,
  type VisitSummary,
} from './domain/model.js'
export { recordVisit } from './application/record-visit.js'
export type { VisitQueries } from './application/visit-queries.js'
export type { VisitStore } from './application/ports/visit-store.js'
export { PostgresVisitQueries } from './adapters/persistence/postgres-visit-queries.js'
export { PostgresVisitStore } from './adapters/persistence/postgres-visit-store.js'
export {
  InvalidVisitCursorError,
  InvalidVisitQueryError,
  type VisitHistoryPage,
} from './domain/queries.js'
export {
  registerVisitsHttpRoutes,
  type VisitsHttpDependencies,
} from './transport/http/register-visits-http.js'
