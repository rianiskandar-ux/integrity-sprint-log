import { pgTable, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

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
