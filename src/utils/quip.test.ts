import { describe, expect, it } from 'vitest'
import { quip } from './quip'

describe('quip', () => {
  const lines = ['a', 'b', 'c']

  it('is stable for the same seed', () => {
    expect(quip(lines, '2026-10-23moon')).toBe(quip(lines, '2026-10-23moon'))
  })

  it('always returns one of the lines', () => {
    for (const seed of ['', 'x', '2026-01-01alena', '🙂']) expect(lines).toContain(quip(lines, seed))
  })
})
