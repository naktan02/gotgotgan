type Timer = ReturnType<typeof setTimeout>

export type PollController = Readonly<{
  start(immediate?: boolean): void
  trigger(): void
  pause(): void
  resume(): void
  stop(): void
}>

export type PollOptions<T> = Readonly<{
  read(signal: AbortSignal): Promise<T>
  isActive(value: T): boolean
  isTerminalError?(error: unknown): boolean
  onValue(value: T): void
  onTerminalError?(error: unknown): void
  onTransientError?(error: unknown): void
  activeDelayMilliseconds?: number
  maximumBackoffMilliseconds?: number
}>

export function createPollController<T>(options: PollOptions<T>): PollController {
  const activeDelay = options.activeDelayMilliseconds ?? 30_000
  const maximumBackoff = options.maximumBackoffMilliseconds ?? 120_000
  let timer: Timer | undefined
  let request: AbortController | undefined
  let running = false
  let queued = false
  let paused = false
  let stopped = false
  let terminal = false
  let transientFailureCount = 0

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const schedule = (delay: number) => {
    clearTimer()
    if (paused || stopped || terminal) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, delay)
  }

  const run = async () => {
    if (paused || stopped || terminal) return
    if (running) {
      queued = true
      return
    }
    clearTimer()
    running = true
    request = new AbortController()
    try {
      const value = await options.read(request.signal)
      if (stopped || paused) return
      transientFailureCount = 0
      options.onValue(value)
      if (options.isActive(value)) schedule(activeDelay)
    } catch (error) {
      if (stopped || paused || request.signal.aborted) return
      if (options.isTerminalError?.(error) === true) {
        terminal = true
        options.onTerminalError?.(error)
      } else {
        transientFailureCount += 1
        options.onTransientError?.(error)
        const delay = Math.min(activeDelay * (2 ** (transientFailureCount - 1)), maximumBackoff)
        schedule(delay)
      }
    } finally {
      running = false
      request = undefined
      if (queued && !paused && !stopped && !terminal) {
        queued = false
        void run()
      } else {
        queued = false
      }
    }
  }

  return {
    start(immediate = true) {
      if (stopped || terminal) return
      if (immediate) void run()
      else schedule(activeDelay)
    },
    trigger() { void run() },
    pause() {
      paused = true
      queued = false
      clearTimer()
      request?.abort()
    },
    resume() {
      if (stopped || terminal) return
      paused = false
      void run()
    },
    stop() {
      stopped = true
      queued = false
      clearTimer()
      request?.abort()
    },
  }
}
