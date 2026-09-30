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

import { describe, expect, it } from 'vitest'

import { normalizeEmail, toDeterministicId } from './auth-pure'

describe('toDeterministicId', () => {
  it('returns consistent results for the same input', () => {
    const id1 = toDeterministicId('user@example.com')
    const id2 = toDeterministicId('user@example.com')
    expect(id1).toBe(id2)
  })

  it('returns different results for different inputs', () => {
    const id1 = toDeterministicId('alice@example.com')
    const id2 = toDeterministicId('bob@example.com')
    expect(id1).not.toBe(id2)
  })

  it('returns an 8-character hex string', () => {
    const id = toDeterministicId('test')
    expect(id).toHaveLength(8)
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('handles empty string', () => {
    const id = toDeterministicId('')
    expect(id).toHaveLength(8)
    expect(id).toBe('00000000')
  })

  it('handles unicode input', () => {
    const id = toDeterministicId('üser@例え.com')
    expect(id).toHaveLength(8)
    expect(id).toMatch(/^[0-9a-f]{8}$/)
    expect(toDeterministicId('üser@例え.com')).toBe(id)
  })
})

describe('normalizeEmail', () => {
  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com')
  })

  it('lowercases', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com')
  })

  it('handles already-normalized emails', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com')
  })

  it('handles mixed case with leading/trailing spaces', () => {
    expect(normalizeEmail('  Alice@Gmail.COM  ')).toBe('alice@gmail.com')
  })
})
