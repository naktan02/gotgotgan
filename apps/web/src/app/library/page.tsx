import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { PlaceLibraryWorkspace } from './PlaceLibraryWorkspace'

export const dynamic = 'force-dynamic'

export default async function LibraryPage({ searchParams }: Readonly<{
  searchParams: Promise<{ q?: string | string[]; collection?: string | string[]; scope?: string | string[] }>
}>) {
  const parameters = await searchParams
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
  const initialQuery = first(parameters.q)
  const initialCollectionId = first(parameters.collection)
  const initialScope = first(parameters.scope) === 'favorites' || initialQuery || initialCollectionId ? 'favorites' : 'directory'
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return (
    <PlaceWorkspaceShell
      currentPage="library"
      familyNavigation={familyNavigation}
    >
      <PlaceLibraryWorkspace initialQuery={initialQuery} initialCollectionId={initialCollectionId} initialScope={initialScope} />
    </PlaceWorkspaceShell>
  )
}
