import { NextResponse } from 'next/server'
import { loadUserConfig, saveUserConfig, getOpBaseUrl } from '@/lib/user-config'

export async function GET() {
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
    setupDone:       cfg.setupDone,
    updatedAt:       cfg.updatedAt,
    opTokenSource:      cfg.opToken      ? 'user-config' : (process.env.OP_API_TOKEN      ? 'env' : 'none'),
    anthropicKeySource: cfg.anthropicKey ? 'user-config' : (process.env.ANTHROPIC_API_KEY ? 'env' : 'none'),
  })
}

export async function POST(req: Request) {
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
