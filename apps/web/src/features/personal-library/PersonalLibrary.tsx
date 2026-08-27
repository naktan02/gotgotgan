'use client'

import { PersonalLibraryView } from './PersonalLibraryView'
import { usePersonalLibraryWorkflow } from './personal-library-workflow'

export function PersonalLibrary() {
  return <PersonalLibraryView workflow={usePersonalLibraryWorkflow()} />
}
