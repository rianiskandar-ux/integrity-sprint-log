import { describe, it, expect } from 'vitest'
import { isSameOriginRequest, MUTATING_METHODS } from '../csrf'

function headers(init: Record<string, string>): Headers {
  return new Headers(init)
}

describe('isSameOriginRequest', () => {
  it('allows a same-origin request via Origin header', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test', origin: 'http://daily-sprint.test' }))).toBe(true)
  })

  it('allows a same-origin request via Referer fallback when Origin is absent', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test', referer: 'http://daily-sprint.test/dashboard' }))).toBe(true)
  })

  it('rejects a forged cross-origin Origin header', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test', origin: 'http://evil.example.com' }))).toBe(false)
  })

  it('fails closed when neither Origin nor Referer is present', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test' }))).toBe(false)
  })

  it('fails closed when Host is missing', () => {
    expect(isSameOriginRequest(headers({ origin: 'http://daily-sprint.test' }))).toBe(false)
  })

  it('fails closed on a malformed Origin value', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test', origin: 'not a url' }))).toBe(false)
  })

  it('matches host regardless of port mismatch expectations (host header includes port)', () => {
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test:4892', origin: 'https://daily-sprint.test:4892' }))).toBe(true)
    expect(isSameOriginRequest(headers({ host: 'daily-sprint.test', origin: 'https://daily-sprint.test:4892' }))).toBe(false)
  })
})

describe('MUTATING_METHODS', () => {
  it('flags state-changing methods only', () => {
    expect(MUTATING_METHODS.has('POST')).toBe(true)
    expect(MUTATING_METHODS.has('PUT')).toBe(true)
    expect(MUTATING_METHODS.has('PATCH')).toBe(true)
    expect(MUTATING_METHODS.has('DELETE')).toBe(true)
    expect(MUTATING_METHODS.has('GET')).toBe(false)
    expect(MUTATING_METHODS.has('HEAD')).toBe(false)
  })
})
