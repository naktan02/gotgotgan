import { seedProductTaxonomy } from '../../modules/taxonomy/index.js'
import { withDatabaseOwner } from '../../platform/database/prepare-database.js'

try {
  const result = await withDatabaseOwner(seedProductTaxonomy)
  process.stdout.write(`Product taxonomy: ${result.published} published, ${result.replayed} unchanged.\n`)
} catch {
  process.stderr.write('Product taxonomy provisioning failed; existing definitions were not overwritten.\n')
  process.exitCode = 1
}
