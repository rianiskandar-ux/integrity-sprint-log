import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: Request) {
  const { sessions, date } = await req.json()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  if (!sessions?.length) return NextResponse.json({ error: 'No sessions' }, { status: 400 })

  const client = new Anthropic({ apiKey })

  const sessionText = sessions.map((s: { title: string; bullets: string[]; time?: string }) =>
    `### ${s.title}${s.time ? ` (${s.time})` : ''}\n${s.bullets.map((b: string) => `- ${b}`).join('\n')}`
  ).join('\n\n')

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Kamu adalah asisten daily standup. Buat ringkasan singkat dalam bahasa Indonesia dari sesi kerja berikut untuk tanggal ${date}.

Format output:
**Yang dikerjakan hari ini:**
- [poin singkat per topik utama, maks 4 poin]

**Highlight:**
[1 kalimat tentang pencapaian paling signifikan]

Sesi kerja:
${sessionText}

Buat ringkasan yang padat, profesional, dan cocok untuk daily standup meeting.`,
    }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ ok: true, summary: text })
}
