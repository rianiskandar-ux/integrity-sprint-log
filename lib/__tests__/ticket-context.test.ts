import { describe, it, expect } from 'vitest'
import { extractGoogleLinks } from '../ticket-context'

describe('extractGoogleLinks', () => {
  it('extracts a Sheets link', () => {
    const links = extractGoogleLinks('lihat data di https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0 ya')
    expect(links).toEqual([{ kind: 'sheet', id: '1AbC_dEf-123', url: 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123' }])
  })

  it('extracts a Docs link', () => {
    const links = extractGoogleLinks('ref: https://docs.google.com/document/d/XyZ789/edit')
    expect(links).toEqual([{ kind: 'doc', id: 'XyZ789', url: 'https://docs.google.com/document/d/XyZ789' }])
  })

  it('extracts both Drive file URL shapes', () => {
    const a = extractGoogleLinks('https://drive.google.com/file/d/FILE111/view')
    expect(a[0]).toMatchObject({ kind: 'drive', id: 'FILE111' })
    const b = extractGoogleLinks('https://drive.google.com/open?id=FILE222')
    expect(b[0]).toMatchObject({ kind: 'drive', id: 'FILE222' })
  })

  it('dedupes repeated ids and mixes kinds', () => {
    const text = `
      sheet https://docs.google.com/spreadsheets/d/SHEET1/edit
      same sheet again https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=5
      doc https://docs.google.com/document/d/DOC1/edit
    `
    const links = extractGoogleLinks(text)
    expect(links).toHaveLength(2)
    expect(links.map(l => l.kind).sort()).toEqual(['doc', 'sheet'])
  })

  it('returns [] for text with no Google links or empty input', () => {
    expect(extractGoogleLinks('just a normal ticket, see https://example.com/foo')).toEqual([])
    expect(extractGoogleLinks('')).toEqual([])
  })

  it('caps at 5 links even when more are present', () => {
    const text = Array.from({ length: 8 }, (_, i) => `https://docs.google.com/document/d/DOC${i}/edit`).join(' ')
    expect(extractGoogleLinks(text)).toHaveLength(5)
  })
})
