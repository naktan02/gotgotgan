import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'

import { CatalogHomeApplication } from './CatalogHomeApplication'

export const dynamic = 'force-dynamic'

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ q?: string | string[] }> }>) {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  const value = (await searchParams).q
  const initialQuery = Array.isArray(value) ? value[0] : value
  return <CatalogHomeApplication familyNavigation={familyNavigation} initialQuery={initialQuery} />
}
