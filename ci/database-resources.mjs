/** Keep disposable databases discoverable when a trusted Delivery worker exits early. */
export function databaseResourceLabels(environment = process.env) {
  const owner = environment.DELIVERY_CONTAINER_NAME
  if (owner === undefined) return []
  if (!/^delivery-check-[a-f0-9]{32}$/.test(owner)) {
    throw new Error('Invalid Delivery database resource owner')
  }
  return ['--label', 'delivery.execution=check', '--label', `delivery.owner=${owner}`]
}
