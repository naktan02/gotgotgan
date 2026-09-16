import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPollController } from './poll-controller'

describe('poll controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('polls only while the returned projection contains active work', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: false })
    const controller = createPollController<{ active: boolean }>({
      read, isActive: (value) => value.active, onValue() {},
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('coalesces triggers so requests never overlap', async () => {
    let resolve: ((value: { active: boolean }) => void) | undefined
    const read = vi.fn(() => new Promise<{ active: boolean }>((next) => { resolve = next }))
    const controller = createPollController<{ active: boolean }>({
      read, isActive: (value) => value.active, onValue() {},
    })

    controller.start()
    controller.trigger()
    controller.trigger()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    resolve?.({ active: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    controller.stop()
  })

  it('stops after a caller-classified terminal failure', async () => {
    const failure = new Error('terminal')
    const read = vi.fn().mockRejectedValue(failure)
    const terminal = vi.fn()
    const controller = createPollController<{ active: boolean }>({
      read, isActive: () => true, onValue() {}, onTerminalError: terminal,
      isTerminalError: (error) => error === failure,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    controller.trigger()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(terminal).toHaveBeenCalledTimes(1)
  })

  it('backs off transient failures and resumes after becoming visible', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ active: false })
    const controller = createPollController<{ active: boolean }>({
      read, isActive: (value) => value.active, onValue() {},
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledTimes(2)
    controller.pause()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).toHaveBeenCalledTimes(2)
    controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(3)
  })
})
