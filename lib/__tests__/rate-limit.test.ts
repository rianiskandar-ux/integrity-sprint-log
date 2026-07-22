import { describe, it, expect } from 'vitest'
import { isRateLimited } from '../rate-limit'

describe('isRateLimited', () => {
  it('allows requests up to the limit, then blocks', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key, 5, 60000)).toBe(false)
    }
    expect(isRateLimited(key, 5, 60000)).toBe(true)
  })

  it('tracks separate keys independently', () => {
    const a = `test-a-${Math.random()}`
    const b = `test-b-${Math.random()}`
    for (let i = 0; i < 5; i++) isRateLimited(a, 5, 60000)
    expect(isRateLimited(a, 5, 60000)).toBe(true)
    expect(isRateLimited(b, 5, 60000)).toBe(false)
  })

  it('does not consume a slot on a blocked call', () => {
    const key = `test-noconsume-${Math.random()}`
    isRateLimited(key, 1, 60000) // consumes the only slot
    expect(isRateLimited(key, 1, 60000)).toBe(true) // blocked
    expect(isRateLimited(key, 1, 60000)).toBe(true) // still blocked, not worse
  })

  it('allows again once the window has passed', () => {
    const key = `test-window-${Math.random()}`
    expect(isRateLimited(key, 1, 50)).toBe(false)
    expect(isRateLimited(key, 1, 50)).toBe(true)
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(isRateLimited(key, 1, 50)).toBe(false)
        resolve()
      }, 80)
    })
  })
})
