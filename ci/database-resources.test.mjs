import assert from 'node:assert/strict'
import test from 'node:test'
import { databaseResourceLabels } from './database-resources.mjs'

test('only an explicit valid Delivery owner receives cleanup labels', () => {
  assert.deepEqual(databaseResourceLabels({}), [])
  for (const owner of ['', 'production', 'delivery-check-short', `delivery-check-${'a'.repeat(32)}\n`]) {
    assert.throws(() => databaseResourceLabels({ DELIVERY_CONTAINER_NAME: owner }))
  }
  const owner = `delivery-check-${'a'.repeat(32)}`
  assert.deepEqual(databaseResourceLabels({ DELIVERY_CONTAINER_NAME: owner }),
    ['--label', 'delivery.execution=check', '--label', `delivery.owner=${owner}`])
})
