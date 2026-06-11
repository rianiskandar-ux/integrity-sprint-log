import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'
import { callLLM, getLLMConfig } from '@/lib/llm'

export async function POST(req: Request) {
  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const cache = loadCache()
  const all   = [...cache.myOpenTasks, ...cache.myClosedTasks]
  const task  = all.find(t => t.id === taskId)
  if (!task) return NextResponse.json({ error: 'Task not found in cache' }, { status: 404 })

  const story = cache.userStories.find(s => s.id === task.userStoryId)
  const epic  = story ? cache.epics.find(e => e.id === (story as any).epicId) : null

  const currentSprint = cache.sprints.find(s => s.isCurrent)
  const nextSprint    = cache.sprints
    .filter(s => !s.isCurrent && s.startDate > (currentSprint?.startDate ?? ''))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]

  const context = [
    `Task #${task.id}: ${task.subject}`,
    `Status: ${task.status} (${task.islStatus})`,
    `Type: ${task.type}`,
    `Sprint: ${task.sprintName ?? 'unassigned'}`,
    `Assignee: ${task.assignee ?? 'unassigned'}`,
    story ? `User Story: #${story.id} ${story.subject}` : '',
    epic  ? `Epic: #${epic.id} ${epic.subject}` : '',
    `Source: ${task.source.join(', ')}`,
    currentSprint ? `Current Sprint: ${currentSprint.name} (ends ${currentSprint.endDate})` : '',
    nextSprint    ? `Next Sprint: ${nextSprint.name} (starts ${nextSprint.startDate})` : '',
  ].filter(Boolean).join('\n')

  const llmCfg = getLLMConfig()
  if (!llmCfg) {
    return NextResponse.json({
      summary: [`${task.subject} — ${task.status}`],
      recommendation: task.islStatus === 'done' ? 'close' : task.sprintName ? 'keep' : 'next-sprint',
      reasoning: 'AI not configured — using rule-based suggestion.',
      nextSprint: nextSprint?.name ?? null,
    })
  }

  try {
    const prompt = `You are a sprint planning assistant. Analyze this OP task and provide a concise suggestion.

${context}

Reply with JSON only:
{
  "summary": ["2-3 bullet points describing what this task is about"],
  "recommendation": "next-sprint" | "keep" | "backlog" | "close",
  "reasoning": "one sentence why"
}

Rules:
- "close" if status is done/rejected or task seems obsolete
- "next-sprint" if it's unassigned to sprint or in backlog
- "keep" if it's actively in progress in current sprint
- "backlog" if it's low priority or no recent activity`

    const text = await callLLM(prompt, llmCfg)
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')

    return NextResponse.json({
      summary:        json.summary ?? [task.subject],
      recommendation: json.recommendation ?? 'keep',
      reasoning:      json.reasoning ?? '',
      nextSprint:     nextSprint?.name ?? null,
      nextSprintId:   nextSprint?.id ?? null,
    })
  } catch {
    return NextResponse.json({
      summary: [task.subject],
      recommendation: task.islStatus === 'done' ? 'close' : 'keep',
      reasoning: 'Could not connect to AI — using fallback.',
      nextSprint: nextSprint?.name ?? null,
      nextSprintId: nextSprint?.id ?? null,
    })
  }
}
