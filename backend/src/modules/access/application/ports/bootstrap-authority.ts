export type VerifiedOperatorAuthority = Readonly<{ operatorReference: string }>

export interface BootstrapAuthority {
  verify(): Promise<VerifiedOperatorAuthority>
}
