import { pgTable, text, integer, boolean, jsonb, timestamp, date, index, uniqueIndex, customType } from 'drizzle-orm/pg-core'

// pgvector column type — drizzle-kit emits `vector(768)` via dataType().
// Driver format is the pgvector text literal: "[0.1,0.2,...]"
const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'vector(768)' },
  toDriver(value: number[]): string { return `[${value.join(',')}]` },
  fromDriver(value: string): number[] {
    try { return JSON.parse(value) } catch { return [] }
  },
})

// ── users ──────────────────────────────────────────────────────────────────────
// One row per ISL user. For now userId=8 is the only user (Rian),
// but schema is multi-user ready for future department rollout.
export const users = pgTable('users', {
  id:        integer('id').primaryKey().generatedAlwaysAsIdentity(),
  googleId:  text('google_id').unique(),
  email:     text('email').notNull().unique(),
  name:      text('name').notNull(),
  avatar:    text('avatar'),
  opUserId:  integer('op_user_id'),              // linked OP user id
  role:      text('role').default('member'),      // member | admin
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── sessions ───────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
  id:               text('id').primaryKey(),
  sessionId:        text('session_id').unique(),
  userId:           integer('user_id').references(() => users.id),

  date:             text('date').notNull(),              // YYYY-MM-DD
  title:            text('title').notNull(),
  bullets:          jsonb('bullets').$type<string[]>().notNull().default([]),
  source:           text('source'),

  startedAt:        text('started_at').notNull(),
  endedAt:          text('ended_at'),
  actualMins:       integer('actual_mins'),
  estimatedMins:    integer('estimated_mins').notNull().default(30),

  opTaskId:         integer('op_task_id'),
  opStoryId:        integer('op_story_id'),
  opEpicId:         integer('op_epic_id'),
  isNewTask:        boolean('is_new_task').default(false),

  taskStatus:       text('task_status'),
  aiStatus:         text('ai_status'),
  hasExplicitCmd:   boolean('has_explicit_cmd').default(false),
  needsValidation:  boolean('needs_validation').default(false),
  command:          text('command'),
  ticketBinding:    integer('ticket_binding'),
  relatedOldTaskId: integer('related_old_task_id'),

  tokenUsage:       jsonb('token_usage').$type<{ inputTokens: number; outputTokens: number } | null>(),

  pushStatus:       text('push_status').notNull().default('pending'), // pending | pushed | discarded | hub
  autoPushed:       boolean('auto_pushed').default(false),
  undoneAt:         text('undone_at'),

  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('sessions_user_date_idx').on(t.userId, t.date),
  index('sessions_push_status_idx').on(t.pushStatus),
  index('sessions_session_id_idx').on(t.sessionId),
])

// ── kb_entries ─────────────────────────────────────────────────────────────────
export const kbEntries = pgTable('kb_entries', {
  id:             text('id').primaryKey(),
  sessionId:      text('session_id').references(() => sessions.id),
  userId:         integer('user_id').references(() => users.id),

  date:           text('date').notNull(),
  title:          text('title').notNull(),
  summary:        text('summary').notNull(),
  keyPoints:      jsonb('key_points').$type<string[]>().notNull().default([]),
  suggestedTask:  text('suggested_task'),
  estimatedMins:  integer('estimated_mins'),

  triageStatus:   text('triage_status').default('hub'), // hub | queue | backlog | discarded
  sprintTarget:   text('sprint_target'),

  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('kb_entries_user_date_idx').on(t.userId, t.date),
  index('kb_entries_triage_idx').on(t.triageStatus),
])

// ── op_cache ───────────────────────────────────────────────────────────────────
export const opCache = pgTable('op_cache', {
  id:          integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId:      integer('user_id').references(() => users.id),
  data:        jsonb('data').notNull().default({}),
  refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
})

// ── user_settings ──────────────────────────────────────────────────────────────
export const userSettings = pgTable('user_settings', {
  id:                       integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId:                   integer('user_id').references(() => users.id).unique(),
  opUserId:                 integer('op_user_id'),
  opUserName:               text('op_user_name'),
  opUserHref:               text('op_user_href'),
  defaultAccountableId:     integer('default_accountable_id'),
  defaultProjectIdentifier: text('default_project_identifier'),
  watchedProjects:          jsonb('watched_projects').$type<string[]>().default([]),
  defaultVersionId:         integer('default_version_id'),
  opApiToken:               text('op_api_token').default(''),
  setupDone:                boolean('setup_done').default(false),
  // Phase 1a multi-user: per-user LLM provider config so a non-owner teammate can
  // use THEIR OWN cloud provider key (openai/google/groq/etc) instead of the
  // owner-only claude-cli or shared providers. personalLlmApiKey is stored
  // ENCRYPTED (lib/crypto.ts), same pattern as opApiToken above.
  // personalLlmBaseUrl: only meaningful for provider='ollama' — their OWN local
  // Ollama endpoint (e.g. http://192.168.x.x:11434 on their own LAN-exposed
  // machine). No API key needed for ollama; baseUrl is required instead.
  personalLlmProvider:      text('personal_llm_provider'),
  personalLlmApiKey:        text('personal_llm_api_key'),
  personalLlmModel:         text('personal_llm_model'),
  personalLlmBaseUrl:       text('personal_llm_base_url'),
  updatedAt:                timestamp('updated_at').defaultNow().notNull(),
})

// ── task_chats ───────────────────────────────────────────────────────────────
// Per-conversation chat history (Create new + bubble general-chat).
// Replaces file-based task-chats/*.json. Multi-user ready via userId.
export const taskChats = pgTable('task_chats', {
  id:         text('id').primaryKey(),
  userId:     integer('user_id').references(() => users.id),
  title:      text('title').notNull().default('Untitled'),
  taskType:   text('task_type').default('general'), // session | incoming | new | general | idea | plan
  opTaskId:   integer('op_task_id'),
  opStoryId:  integer('op_story_id'),
  sprintName: text('sprint_name'),
  date:       text('date'),
  messages:   jsonb('messages').$type<{ role: string; content: string; ts: string }[]>().notNull().default([]),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('task_chats_user_updated_idx').on(t.userId, t.updatedAt),
])

// ── processed_sessions ─────────────────────────────────────────────────────────
// Tracks which hook sessions have been processed (replaces processed-sessions.json)
export const processedSessions = pgTable('processed_sessions', {
  sessionId:   text('session_id').primaryKey(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
})

// ── agent_logs ─────────────────────────────────────────────────────────────────
// Log aktivitas tiap agent ISL — Arka, Rendi, Dira, Luna
export const agentLogs = pgTable('agent_logs', {
  id:         text('id').primaryKey(),
  userId:     integer('user_id').references(() => users.id),
  agentId:    text('agent_id').notNull(),   // arka | rendi | dira | luna
  agentName:  text('agent_name').notNull(),
  action:     text('action').notNull(),     // rekam_sesi | sync_op | timer_start | triage_check | dll
  status:     text('status').notNull(),     // active | idle | issue
  detail:     text('detail'),
  metadata:   jsonb('metadata').$type<Record<string, unknown>>().default({}),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
}, (t) => [
  index('agent_logs_agent_idx').on(t.agentId, t.occurredAt),
  index('agent_logs_user_idx').on(t.userId, t.occurredAt),
])

// ── cases ──────────────────────────────────────────────────────────────────────
// Insiden/masalah yang terdeteksi oleh agent — dengan tracking resolusi
export const cases = pgTable('cases', {
  id:          text('id').primaryKey(),
  userId:      integer('user_id').references(() => users.id),
  agentId:     text('agent_id'),            // agent yang deteksi
  title:       text('title').notNull(),
  description: text('description'),
  severity:    text('severity').notNull(),  // low | medium | high | critical
  status:      text('status').notNull().default('open'), // open | resolved | ignored
  resolvedAt:  timestamp('resolved_at'),
  metadata:    jsonb('metadata').$type<Record<string, unknown>>().default({}),
  detectedAt:  timestamp('detected_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('cases_status_idx').on(t.status, t.detectedAt),
  index('cases_agent_idx').on(t.agentId, t.status),
])

// ── daily_logs ─────────────────────────────────────────────────────────────────
// Daily work log entries — replaces daily-sprints/*.md file storage
export const dailyLogs = pgTable('daily_logs', {
  id:        text('id').primaryKey(),          // <date>-<sessionId-slice>
  userId:    integer('user_id').references(() => users.id),
  date:      text('date').notNull(),           // YYYY-MM-DD
  title:     text('title').notNull(),
  bullets:   jsonb('bullets').$type<string[]>().notNull().default([]),
  sessionId: text('session_id'),               // ISL session reference
  opTaskId:  integer('op_task_id'),
  loggedAt:  timestamp('logged_at').defaultNow().notNull(),
}, (t) => [
  index('daily_logs_user_date_idx').on(t.userId, t.date),
  index('daily_logs_date_idx').on(t.date),
])

// ── task_memory ────────────────────────────────────────────────────────────────
// Per-task work history from hooks — replaces memory/Epic-*/Story-*/Task-*.md
export const taskMemory = pgTable('task_memory', {
  id:         text('id').primaryKey(),         // <sessionId>-<taskId>
  userId:     integer('user_id').references(() => users.id),
  opTaskId:   integer('op_task_id').notNull(),
  sessionId:  text('session_id'),
  date:       text('date').notNull(),
  title:      text('title').notNull(),
  bullets:    jsonb('bullets').$type<string[]>().notNull().default([]),
  actualMins: integer('actual_mins'),
  loggedAt:   timestamp('logged_at').defaultNow().notNull(),
}, (t) => [
  index('task_memory_task_idx').on(t.opTaskId, t.date),
  index('task_memory_user_idx').on(t.userId, t.date),
])

// ── embeddings ─────────────────────────────────────────────────────────────────
// AI Layer (Phase 2): pgvector store for semantic search over KB entries,
// sessions, daily logs and (later) parsed docs. One row per source item.
// Embedding model: Gemini text-embedding-004 (768 dims). Key-agnostic — rows
// only appear when GEMINI_API_KEY is configured; all writes no-op otherwise.
export const embeddings = pgTable('embeddings', {
  id:         text('id').primaryKey(),                 // emb-<sourceType>-<sourceId>
  userId:     integer('user_id').references(() => users.id),
  sourceType: text('source_type').notNull(),           // kb | session | daily_log | doc
  sourceId:   text('source_id').notNull(),             // id in the source table
  title:      text('title').notNull(),
  chunk:      text('chunk').notNull(),                 // text that was embedded
  embedding:  vector768('embedding'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('embeddings_source_idx').on(t.sourceType, t.sourceId),
])

// ── uploaded_docs ──────────────────────────────────────────────────────────────
// Doc Parser (Phase 2 AI Layer extension): tracks PDF/Word files uploaded and
// chunked into `embeddings` (sourceType='doc') so chat can retrieve from them.
// One row per upload — id is the docId used to build embeddings.sourceId
// (`doc-<docId>-chunk-<i>`), so deleting this row's matching embeddings is a
// LIKE `doc-<docId>-chunk-%` sweep.
export const uploadedDocs = pgTable('uploaded_docs', {
  id:         text('id').primaryKey(),                  // docId, e.g. doc-<ts>-<rand>
  userId:     integer('user_id').references(() => users.id),
  filename:   text('filename').notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  sizeBytes:  integer('size_bytes').notNull().default(0),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (t) => [
  index('uploaded_docs_user_idx').on(t.userId, t.uploadedAt),
])

// ── sage_digests ───────────────────────────────────────────────────────────────
// Weekly AI-ecosystem digest generated by Sage (agent #8, reports direct to human).
export const sageDigests = pgTable('sage_digests', {
  id:              text('id').primaryKey(),
  weekOf:          date('week_of').notNull(),
  summary:         text('summary').notNull(),        // final markdown digest
  rawSignalCount:  integer('raw_signal_count').notNull().default(0),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
})

// ── sage_snapshots ─────────────────────────────────────────────────────────────
// Last-seen state of external data sources (e.g. OpenRouter model list) —
// diffed week-over-week by Sage to detect new/removed/repriced models.
export const sageSnapshots = pgTable('sage_snapshots', {
  id:         text('id').primaryKey(),          // e.g. 'openrouter-models'
  data:       jsonb('data').notNull().default({}),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
})

// ── agent_events ───────────────────────────────────────────────────────────────
// Durable, queryable event log for agent actions — replaces ephemeral stderr/
// console lines (e.g. Arka's `[ISL] summary via ${brain}`). Feeds the Scorecard
// dashboard (agent activity/efficiency) and seeds data for a future correction
// loop (comparing Luna's suggestions to actual outcomes).
export const agentEvents = pgTable('agent_events', {
  id:        text('id').primaryKey(),          // evt-<timestamp>-<random>
  agent:     text('agent').notNull(),           // arka | luna | aryo | kafi | sage
  event:     text('event').notNull(),           // summary_local | summary_fallback | suggestion_made | insight_proposed | insight_approved | insight_dismissed | digest_generated | pushed | skipped
  meta:      jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('agent_events_agent_created_idx').on(t.agent, t.createdAt),
])

// ── arka_corrections ───────────────────────────────────────────────────────────
// Correction Loop v1: captures every time a session's opTaskId — already set
// once by Arka's hook-side keyword matcher (findMatchingTask in isl-context.mjs)
// — gets CHANGED by Rian during triage (Push Queue link/create). Each row is
// also embedded into `embeddings` (sourceType 'correction') so the SAME
// hybridSearch already used everywhere else makes past mistakes retrievable —
// no training loop needed, useful starting from correction #1.
export const arkaCorrections = pgTable('arka_corrections', {
  id:              text('id').primaryKey(),               // corr-<timestamp>-<random>
  sessionId:       text('session_id'),                     // not FK-enforced — sessions can be pruned
  sessionTitle:    text('session_title').notNull(),
  sessionBullets:  jsonb('session_bullets').$type<string[]>().notNull().default([]),
  arkaGuessTaskId: integer('arka_guess_task_id'),           // OP task id Arka originally set (nullable = hub/no guess)
  correctedTaskId: integer('corrected_task_id'),            // OP task id Rian corrected it to
  createdAt:       timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('arka_corrections_created_idx').on(t.createdAt),
])

// ── events ─────────────────────────────────────────────────────────────────────
// Timestamped audit log — semua kejadian sistem yang penting
export const events = pgTable('events', {
  id:          text('id').primaryKey(),
  userId:      integer('user_id').references(() => users.id),
  agentId:     text('agent_id'),
  type:        text('type').notNull(),      // session_recorded | op_synced | timer_stopped | hub_triaged | dll
  subject:     text('subject').notNull(),
  detail:      text('detail'),
  metadata:    jsonb('metadata').$type<Record<string, unknown>>().default({}),
  occurredAt:  timestamp('occurred_at').defaultNow().notNull(),
}, (t) => [
  index('events_type_idx').on(t.type, t.occurredAt),
  index('events_user_idx').on(t.userId, t.occurredAt),
  index('events_agent_idx').on(t.agentId, t.occurredAt),
])
