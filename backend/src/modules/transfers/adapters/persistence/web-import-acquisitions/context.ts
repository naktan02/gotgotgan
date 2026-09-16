import type { Pool } from 'pg'

export class WebImportAcquisitionContext {
  constructor(
    readonly pool: Pool,
    readonly now: () => Date,
  ) {}
}
