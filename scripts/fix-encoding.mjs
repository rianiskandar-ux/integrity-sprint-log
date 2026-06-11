// Fix double-encoded UTF-8 mojibake in session-logs JSON files.
// The corruption comes from text that was UTF-8, treated as latin-1, then re-encoded as UTF-8.
// We do byte-level replacement to avoid any editor/shell encoding issues.
import fs from 'fs'
import path from 'path'

const DIR = path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'session-logs')

// Each entry: [bad_bytes_hex, good_bytes_hex, description]
// Derived from: take the UTF-8 bytes of the original char, encode each byte as latin-1-to-UTF-8
const BYTE_FIXES = [
  // — U+2014 EM DASH: 0xE2 0x80 0x94 → each byte latin1→UTF8 = C3A2 C282 C294... wrong
  // Actual observed: C3A2 E282AC E28094 → â€" → replace with E28094
  ['C3A2E282ACE28094', 'E28094'],  // â€" → —
  // ' U+2019 RIGHT SINGLE QUOTATION: E2 80 99
  ['C3A2E282ACE28099', 'E28099'],  // â€™ → '
  // " U+201C LEFT DOUBLE QUOTATION: E2 80 9C
  ['C3A2E282ACE2809C', 'E2809C'],  // â€œ → "
  // " U+201D RIGHT DOUBLE QUOTATION: E2 80 9D
  ['C3A2E282ACE2809D', 'E2809D'],  // â€ → "
  // … U+2026 ELLIPSIS: E2 80 A6
  ['C3A2E282ACE280A6', 'E280A6'],  // â€¦ → …
]

function hexToBuffer(hex) {
  const buf = Buffer.alloc(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) buf[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return buf
}

function replaceBytes(buf, searchBuf, replaceBuf) {
  const parts = []
  let i = 0
  while (i < buf.length) {
    let found = false
    if (i + searchBuf.length <= buf.length) {
      let match = true
      for (let j = 0; j < searchBuf.length; j++) {
        if (buf[i + j] !== searchBuf[j]) { match = false; break }
      }
      if (match) { parts.push(replaceBuf); i += searchBuf.length; found = true }
    }
    if (!found) { parts.push(buf.slice(i, i + 1)); i++ }
  }
  return Buffer.concat(parts)
}

if (!fs.existsSync(DIR)) { console.log('session-logs dir not found'); process.exit(0) }

const compiled = BYTE_FIXES.map(([bad, good]) => [hexToBuffer(bad), hexToBuffer(good)])

for (const fname of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const fpath = path.join(DIR, fname)
  let buf = fs.readFileSync(fpath)
  let changed = false
  for (const [search, replace] of compiled) {
    const next = replaceBytes(buf, search, replace)
    if (!next.equals(buf)) { buf = next; changed = true }
  }
  if (changed) {
    fs.writeFileSync(fpath, buf)
    console.log('fixed:', fname)
  } else {
    console.log('ok:   ', fname)
  }
}
console.log('done')
