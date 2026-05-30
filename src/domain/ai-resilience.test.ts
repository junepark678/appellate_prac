import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimeoutError, withTimeout } from './ai-resilience'

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the timeout timer after the wrapped promise resolves', async () => {
    vi.useFakeTimers()

    await expect(
      withTimeout(Promise.resolve('ok'), 1000, 'fast call'),
    ).resolves.toBe('ok')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with a TimeoutError when the wrapped promise is too slow', async () => {
    vi.useFakeTimers()
    const result = withTimeout(new Promise(() => undefined), 1000, 'slow call')
    const expectation = result.catch((error) => {
      expect(error).toBeInstanceOf(TimeoutError)
      expect(error.message).toBe('slow call timed out after 1000ms')
    })

    await vi.advanceTimersByTimeAsync(1000)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })
})
