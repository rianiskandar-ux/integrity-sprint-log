import { describe, it, expect } from 'vitest'
import { isSecureRequest } from '../request-proto'

describe('isSecureRequest', () => {
  it('trusts X-Forwarded-Proto: https from nginx even though the app sees plain HTTP internally', () => {
    const req = new Request('http://internal-host/api/x', { headers: { 'x-forwarded-proto': 'https' } })
    expect(isSecureRequest(req)).toBe(true)
  })

  it('treats X-Forwarded-Proto: http as insecure', () => {
    const req = new Request('http://internal-host/api/x', { headers: { 'x-forwarded-proto': 'http' } })
    expect(isSecureRequest(req)).toBe(false)
  })

  it('takes the first value when the header is a comma-separated chain', () => {
    const req = new Request('http://internal-host/api/x', { headers: { 'x-forwarded-proto': 'https, http' } })
    expect(isSecureRequest(req)).toBe(true)
  })

  it('falls back to the request URL scheme when the header is absent', () => {
    const httpsReq = new Request('https://direct-host/api/x')
    const httpReq = new Request('http://direct-host/api/x')
    expect(isSecureRequest(httpsReq)).toBe(true)
    expect(isSecureRequest(httpReq)).toBe(false)
  })
})
