/** Trusted server parser output, never accepted from a legacy browser capture request. */
export type ProviderListedFactsV1 = Readonly<{
  schemaVersion: 'provider-listed-facts.v1'
  name: string
  address: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
}>
