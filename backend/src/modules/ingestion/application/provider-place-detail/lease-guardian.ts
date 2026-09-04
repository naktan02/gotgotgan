import type {
  ProviderPlaceDetailClaim,
  ProviderPlaceDetailJobStore,
} from '../ports/provider-place-detail.js'

export type LeaseGuardian = Readonly<{
  signal: AbortSignal
  isLost: () => boolean
  renew: () => Promise<boolean>
  start: () => void
  stop: () => Promise<void>
}>

export function createLeaseGuardian(input: Readonly<{
  claim: ProviderPlaceDetailClaim
  store: ProviderPlaceDetailJobStore
  now: () => Date
  leaseMilliseconds: number
}>): LeaseGuardian {
  const lostController = new AbortController()
  const heartbeatMilliseconds = Math.max(1, Math.floor(input.leaseMilliseconds / 3))
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let renewal: Promise<boolean> | undefined

  const markLost = () => {
    if (!lostController.signal.aborted) lostController.abort()
  }
  const renew = async () => {
    if (lostController.signal.aborted) return false
    if (renewal !== undefined) return renewal
    const renewed = input.now()
    renewal = input.store.renewLease({
      claim: input.claim,
      renewedAt: renewed.toISOString(),
      leaseUntil: new Date(
        renewed.getTime() + input.leaseMilliseconds,
      ).toISOString(),
    }).then((owned) => {
      if (!owned) markLost()
      return owned
    }).catch(() => {
      markLost()
      return false
    }).finally(() => {
      renewal = undefined
    })
    return renewal
  }
  const schedule = () => {
    if (stopped || lostController.signal.aborted) return
    timer = setTimeout(async () => {
      timer = undefined
      if (await renew()) schedule()
    }, heartbeatMilliseconds)
  }

  return {
    signal: lostController.signal,
    isLost: () => lostController.signal.aborted,
    renew,
    start: schedule,
    stop: async () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      if (renewal !== undefined) await renewal
    },
  }
}

export function combineAbortSignals(signals: readonly AbortSignal[]) {
  const controller = new AbortController()
  const onAbort = (event: Event) => {
    const source = event.target as AbortSignal
    if (!controller.signal.aborted) controller.abort(source.reason)
  }
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) signal.removeEventListener('abort', onAbort)
    },
  }
}
