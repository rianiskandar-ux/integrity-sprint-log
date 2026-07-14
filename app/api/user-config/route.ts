import { NextResponse } from 'next/server'
import { loadUserConfig, saveUserConfig, getOpBaseUrl } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export const runtime = 'nodejs'

// user-config is the OWNER's single global config (file-based, pre-multiuser).
// Teammates use per-user userSettings instead. Owner-or-machine-key only —
// in single-user mode getRequestContext synthesizes the owner uid, so this
// stays open there. (Middleware lets header-present machine calls through, so
// this route must validate the key value itself, not just presence.)
async function allowed(req: Request): Promise<boolean> {
  if (req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY)) return true
  return isOwnerUid((await getRequestContext())?.uid)
}

export async function GET(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const cfg = loadUserConfig()
  // Never expose keys in full — mask them
  return NextResponse.json({
    displayName:     cfg.displayName,
    opBaseUrl:       cfg.opBaseUrl || '',
    opTokenSet:      !!cfg.opToken,
    anthropicKeySet: !!cfg.anthropicKey,
    llmProvider:     cfg.llmProvider || 'anthropic',
    llmApiKeySet:    !!cfg.llmApiKey,
    llmModel:        cfg.llmModel || '',
    llmEffort:       cfg.llmEffort || '',
    setupDone:       cfg.setupDone,
    updatedAt:       cfg.updatedAt,
    opTokenSource:      cfg.opToken      ? 'user-config' : (process.env.OP_API_TOKEN      ? 'env' : 'none'),
    anthropicKeySource: cfg.anthropicKey ? 'user-config' : (process.env.ANTHROPIC_API_KEY ? 'env' : 'none'),
  })
}

export async function POST(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  try {
    const body = await req.json()
    const { displayName, opToken, anthropicKey, llmProvider, llmApiKey, llmModel, skipValidation } = body

    if (!opToken && !skipValidation) {
      return NextResponse.json({ error: 'OP API token is required' }, { status: 400 })
    }

    // Validate OP token by hitting /api/v3/users/me
    const effectiveBase = body.opBaseUrl || getOpBaseUrl()
    if (opToken && effectiveBase && !skipValidation) {
      const auth = 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64')
      const res = await fetch(`${effectiveBase}/api/v3/users/me`, { headers: { Authorization: auth } })
      if (!res.ok) {
        return NextResponse.json({ error: `OP token invalid (HTTP ${res.status})` }, { status: 400 })
      }
      const me = await res.json()
      // Auto-fill displayName from OP if not provided
      const name = displayName || me.name || me.login || 'Team Member'
      const cfg = saveUserConfig({ displayName: name, opBaseUrl: body.opBaseUrl ?? '', opToken, anthropicKey: anthropicKey ?? '', llmProvider: llmProvider ?? 'anthropic', llmApiKey: llmApiKey ?? anthropicKey ?? '', llmModel: llmModel ?? '', setupDone: true })
      return NextResponse.json({ ok: true, displayName: cfg.displayName })
    }

    // skipValidation path (e.g. user wants to save without hitting OP)
    const cfg = saveUserConfig({
      displayName:  displayName  || 'Team Member',
      opToken:      opToken      ?? '',
      anthropicKey: anthropicKey ?? '',
      llmProvider:  llmProvider  ?? 'anthropic',
      llmApiKey:    llmApiKey    ?? anthropicKey ?? '',
      llmModel:     llmModel     ?? '',
      setupDone:    true,
    })
    return NextResponse.json({ ok: true, displayName: cfg.displayName })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH — partial update (settings page)
export async function PATCH(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  try {
    const body = await req.json()
    const cfg = saveUserConfig(body)
    return NextResponse.json({
      ok: true,
      displayName:     cfg.displayName,
      opTokenSet:      !!cfg.opToken,
      anthropicKeySet: !!cfg.anthropicKey,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
