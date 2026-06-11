import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'

export async function POST(req: Request) {
  const { sessions, date } = await req.json()
  const llmCfg = getLLMConfig()
  if (!llmCfg) return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 })
  if (!sessions?.length) return NextResponse.json({ error: 'No sessions' }, { status: 400 })

  const sessionText = sessions.map((s: { title: string; bullets: string[]; time?: string }) =>
    `### ${s.title}${s.time ? ` (${s.time})` : ''}\n${s.bullets.map((b: string) => `- ${b}`).join('\n')}`
  ).join('\n\n')

  const prompt = `Kamu adalah asisten daily standup. Buat ringkasan singkat dalam bahasa Indonesia dari sesi kerja berikut untuk tanggal ${date}.

Format output:
**Yang dikerjakan hari ini:**
- [poin singkat per topik utama, maks 4 poin]

**Highlight:**
[1 kalimat tentang pencapaian paling signifikan]

Sesi kerja:
${sessionText}

Buat ringkasan yang padat, profesional, dan cocok untuk daily standup meeting.`

  const text = await callLLM(prompt, llmCfg)
  return NextResponse.json({ ok: true, summary: text })
}
