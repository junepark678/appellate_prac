/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
