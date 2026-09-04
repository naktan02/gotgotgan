'use client'

import { PersonalLibraryView } from './PersonalLibraryView'
import { usePersonalLibraryWorkflow } from './personal-library-workflow'
import type { PlaceMapRenderer } from '@/platform/maps/public'

export function PersonalLibrary({ mapRenderer }: Readonly<{ mapRenderer: PlaceMapRenderer }>) {
  return <PersonalLibraryView mapRenderer={mapRenderer} workflow={usePersonalLibraryWorkflow()} />
}
