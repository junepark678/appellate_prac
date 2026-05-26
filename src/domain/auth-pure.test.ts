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
