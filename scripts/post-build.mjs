#!/usr/bin/env node
// Post-build: copy static assets into standalone so server.js can serve them
import { cpSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const standalone = join(root, '.next', 'standalone')

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]

for (const [src, dest] of copies) {
  if (!existsSync(src)) continue
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true, force: true })
  console.log(`  copied ${src.split('.next')[1] || '/public'} → standalone`)
}

// Copy .env.local → standalone/.env so runtime env vars are always available
const envSrc = join(root, '.env.local')
if (existsSync(envSrc)) {
  copyFileSync(envSrc, join(standalone, '.env'))
  console.log('  copied .env.local → standalone/.env')
}

console.log('post-build done')
