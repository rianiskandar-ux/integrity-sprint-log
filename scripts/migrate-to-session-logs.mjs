#!/usr/bin/env node
/**
 * Migration: context-drafts.json → session-logs/ + memory/ hierarchy
 * Run once: node scripts/migrate-to-session-logs.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, basename } from 'path'

const ROOT         = 'C:/Users/user199/ai-apps/daily-sprint-next'
const DRAFTS_FILE  = join(ROOT, 'context-drafts.json')
const CACHE_FILE   = join(ROOT, 'op-cache.json')
const SESSION_DIR  = join(ROOT, 'session-logs')
const MEMORY_DIR   = join(ROOT, 'memory')
const OLD_MEM_DIR  = join(ROOT, 'task-memory')

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
if (!existsSync(MEMORY_DIR))  mkdirSync(MEMORY_DIR,  { recursive: true })

// ── Load OP cache for hierarchy lookup ───────────────────────────────────────
let cache = { epics: [], userStories: [], myOpenTasks: [], myClosedTasks: [] }
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) } catch {}

function slugify(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function resolveHierarchy(opTaskId, opStoryId) {
  const storyId  = opStoryId ?? null
  const storyObj = (cache.userStories ?? []).find(s => s.id === storyId)
  const storySlug = storyObj ? slugify(storyObj.subject) : 'general'

  const epicId  = storyObj?.epicId ?? null
  const epicObj = (cache.epics ?? []).find(e => e.id === epicId)
  const epicSlug = epicObj ? slugify(epicObj.subject) : 'uncategorized'

  return {
    epicId:    epicId  ?? 0,
    epicSlug:  epicSlug,
    storyId:   storyId ?? 0,
    storySlug: storySlug,
  }
}

// ── Migrate context-drafts.json ───────────────────────────────────────────────
let migrated = 0
if (existsSync(DRAFTS_FILE)) {
  let drafts = []
  try {
    const raw = JSON.parse(readFileSync(DRAFTS_FILE, 'utf-8'))
    drafts = Array.isArray(raw) ? raw : (raw.drafts ?? [])
  } catch {}

  for (const d of drafts) {
    const date     = (d.startedAt ?? new Date().toISOString()).slice(0, 10)
    const sid8     = d.sessionId ? d.sessionId.slice(0, 8) : `${Date.now()}`
    const fileName = `${date}_${sid8}.json`
    const filePath = join(SESSION_DIR, fileName)

    // Skip if already migrated
    if (existsSync(filePath)) continue

    const hier = resolveHierarchy(d.opTaskId, d.opStoryId)
    const session = {
      id:               d.id ?? `sl-${Date.now()}-migrated`,
      sessionId:        d.sessionId,
      userId:           8,
      date,
      title:            d.title ?? 'Work Session',
      bullets:          Array.isArray(d.bullets) ? d.bullets : [],
      source:           d.source ?? '',
      startedAt:        d.startedAt ?? new Date().toISOString(),
      endedAt:          d.updatedAt,
      actualMins:       d.actualMins,
      estimatedMins:    d.estimatedMins ?? 30,
      opTaskId:         d.opTaskId    ?? null,
      opStoryId:        d.opStoryId   ?? null,
      opEpicId:         hier.epicId   || null,
      isNewTask:        d.isNewTask,
      taskStatus:       d.taskStatus  ?? 'in_progress',
      aiStatus:         d.aiStatus,
      hasExplicitCmd:   d.hasExplicitCmd  ?? false,
      needsValidation:  d.needsValidation ?? false,
      command:          null,
      ticketBinding:    d.ticketBinding   ?? null,
      relatedOldTaskId: d.relatedOldTaskId ?? null,
      tokenUsage:       d.tokenUsage ?? null,
      pushStatus:       d.status === 'discarded' ? 'discarded' : 'pushed',
      autoPushed:       d.autoPushed ?? true,
      undoneAt:         d.undoneAt ?? null,
      createdAt:        d.startedAt ?? new Date().toISOString(),
      updatedAt:        d.updatedAt ?? new Date().toISOString(),
    }

    writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8')
    migrated++
    console.log(`  ✓ ${fileName} — ${session.title.slice(0, 60)}`)
  }

  // Rename original as backup
  renameSync(DRAFTS_FILE, DRAFTS_FILE + '.bak')
  console.log(`\n✅ Migrated ${migrated} sessions → session-logs/`)
  console.log(`📦 context-drafts.json → context-drafts.json.bak`)
} else {
  console.log('No context-drafts.json found — nothing to migrate')
}

// ── Migrate task-memory/ → memory/ hierarchy ─────────────────────────────────
let memMigrated = 0
if (existsSync(OLD_MEM_DIR)) {
  const files = readdirSync(OLD_MEM_DIR).filter(f => f.endsWith('.md'))

  for (const f of files) {
    const match  = f.match(/^OP-(\d+)\.md$/)
    if (!match) continue

    const taskId  = parseInt(match[1])
    const allTasks = [...(cache.myOpenTasks ?? []), ...(cache.myClosedTasks ?? [])]
    const task    = allTasks.find(t => t.id === taskId)
    const hier    = resolveHierarchy(taskId, task?.userStoryId ?? task?.parentId ?? null)
    const taskSlug = task ? slugify(task.subject) : `task-${taskId}`

    const dir = join(MEMORY_DIR,
      `Epic-${hier.epicId}-${hier.epicSlug}`,
      `Story-${hier.storyId}-${hier.storySlug}`
    )
    mkdirSync(dir, { recursive: true })

    const dest = join(dir, `Task-${taskId}-${taskSlug}.md`)
    const src  = join(OLD_MEM_DIR, f)

    if (!existsSync(dest)) {
      const content = readFileSync(src, 'utf-8')
      writeFileSync(dest, content, 'utf-8')
      memMigrated++
      console.log(`  ✓ memory/Epic-${hier.epicId}-${hier.epicSlug}/Story-${hier.storyId}-${hier.storySlug}/Task-${taskId}-${taskSlug}.md`)
    }
  }

  console.log(`\n✅ Migrated ${memMigrated} memory files → memory/ hierarchy`)
  if (memMigrated > 0) console.log(`🗂  Old task-memory/ still exists — verify then delete manually`)
} else {
  console.log('No task-memory/ folder found — nothing to migrate')
}
