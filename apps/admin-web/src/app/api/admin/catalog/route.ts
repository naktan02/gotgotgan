import { createAdminCatalogHttp } from '@/platform/catalog/catalog-http'
import { adminSessionHttp } from '@/platform/membership/admin-session-http'

const adminCatalogHttp = createAdminCatalogHttp({
  authorize: (request) => adminSessionHttp.current(request), backendOrigin: () => process.env.PLACE_BACKEND_ORIGIN,
})
export const POST = adminCatalogHttp.search
