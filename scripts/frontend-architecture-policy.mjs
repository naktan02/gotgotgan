import { defineFrontendArchitecturePolicy } from '@naktan02/frontend-architecture'

export const frontendArchitecturePolicy = defineFrontendArchitecturePolicy({
  crossOwnerPublicSegments: {
    domains: [],
    features: ['public'],
  },
  sameLayerDependencies: {
    platform: {
      imports: ['auth'],
      library: ['auth', 'backend-http'],
      membership: ['auth'],
      'process-readiness': ['auth', 'imports', 'membership'],
      publications: ['backend-http'],
      search: ['backend-http'],
      visits: ['auth', 'backend-http'],
      writing: ['auth', 'backend-http'],
    },
  },
  shellFeaturePublicSegments: ['public'],
})
