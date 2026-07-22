/**
 * Integration tests for Tika's Helpdesk business logic — routing, QA-gate
 * auth, and the correction-loop decision rule. Runs against the disposable
 * isl_test database (see vitest.setup.ts) — never touches real ticket data.
 *
 * Regression coverage for Rian's two explicit corrections during the build:
 * - "yg eksekusi ga cuma gw kan, yg di assigne aja kan??" → PASS must route
 *   to the OP-assigned user, never fall back to the owner.
 * - "jgn masuk ke queue gw ... yg memutuskan klo blm ada assignee ya aufa" →
 *   an unassigned/unmatched ticket must stay unrouted (pushedToQueueAt null),
 *   not silently land in the owner's queue.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, users, sessions, helpdeskTickets, ticketAnalyses, ticketCorrections } from '../db'
import { isQaOrOwner, routeToPushQueueIfReady, detectRejectedOutcomes, shouldRecordCorrection } from '../helpdesk'
import { OWNER_UID } from '../auth'

const TEST_EMAIL_PREFIX = 'test-helpdesk-'
let qaUserId: number
let assigneeUserId: number
let randomUserId: number
const UNMATCHED_OP_USER_ID = 987654321 // no ISL user has this opUserId

beforeAll(async () => {
  const [qa] = await db.insert(users).values({
    email: `${TEST_EMAIL_PREFIX}qa@example.test`, name: 'Test QA', role: 'qa', opUserId: 111,
  }).returning()
  const [assignee] = await db.insert(users).values({
    email: `${TEST_EMAIL_PREFIX}assignee@example.test`, name: 'Test Assignee', role: 'member', opUserId: 222,
  }).returning()
  const [random] = await db.insert(users).values({
    email: `${TEST_EMAIL_PREFIX}random@example.test`, name: 'Test Random', role: 'member', opUserId: 333,
  }).returning()
  qaUserId = qa.id
  assigneeUserId = assignee.id
  randomUserId = random.id
})

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.userId, assigneeUserId))
  await db.delete(ticketAnalyses)
  await db.delete(ticketCorrections)
  await db.delete(helpdeskTickets)
  await db.delete(users).where(eq(users.id, qaUserId))
  await db.delete(users).where(eq(users.id, assigneeUserId))
  await db.delete(users).where(eq(users.id, randomUserId))
})

describe('isQaOrOwner', () => {
  it('is always true for the owner uid, regardless of DB role', async () => {
    expect(await isQaOrOwner(OWNER_UID)).toBe(true)
  })
  it('is true for a user with role=qa', async () => {
    expect(await isQaOrOwner(qaUserId)).toBe(true)
  })
  it('is false for a regular member', async () => {
    expect(await isQaOrOwner(randomUserId)).toBe(false)
  })
  it('is false for null/nonexistent uid', async () => {
    expect(await isQaOrOwner(null)).toBe(false)
    expect(await isQaOrOwner(999999999)).toBe(false)
  })
})

async function insertTicket(opWpId: number, overrides: Partial<typeof helpdeskTickets.$inferInsert> = {}) {
  const [row] = await db.insert(helpdeskTickets).values({
    id: `hdt-${opWpId}`, opWpId, subject: `Test ticket ${opWpId}`, ...overrides,
  }).returning()
  return row
}

describe('routeToPushQueueIfReady', () => {
  it('does not route a ticket that has not been PASSed', async () => {
    const ticket = await insertTicket(900001)
    expect(await routeToPushQueueIfReady(ticket)).toBe(false)
  })

  it('does NOT fall back to the owner queue when PASSed but unassigned', async () => {
    const ticket = await insertTicket(900002, { qaVerdict: 'pass' })
    expect(await routeToPushQueueIfReady(ticket)).toBe(false)
    const ownerSessions = await db.select().from(sessions).where(eq(sessions.opTaskId, 900002))
    expect(ownerSessions).toHaveLength(0)
  })

  it('stays pending when the OP assignee has no matching ISL account', async () => {
    const ticket = await insertTicket(900003, { qaVerdict: 'pass', assigneeOpUserId: UNMATCHED_OP_USER_ID })
    expect(await routeToPushQueueIfReady(ticket)).toBe(false)
    const rows = await db.select().from(sessions).where(eq(sessions.opTaskId, 900003))
    expect(rows).toHaveLength(0)
  })

  it('routes to the assigned user\'s queue — never the owner\'s — when PASSed with a real assignee', async () => {
    const ticket = await insertTicket(900004, { qaVerdict: 'pass', assigneeOpUserId: 222 })
    expect(await routeToPushQueueIfReady(ticket)).toBe(true)

    const rows = await db.select().from(sessions).where(eq(sessions.opTaskId, 900004))
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(assigneeUserId)
    expect(rows[0].userId).not.toBe(OWNER_UID)
    expect(rows[0].pushStatus).toBe('pending')
    expect(rows[0].taskStatus).toBe('in_progress')

    const [updated] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, ticket.id))
    expect(updated.pushedToQueueAt).not.toBeNull()
  })

  it('does not double-route an already-pushed ticket', async () => {
    const ticket = await insertTicket(900005, { qaVerdict: 'pass', assigneeOpUserId: 222, pushedToQueueAt: new Date() })
    expect(await routeToPushQueueIfReady(ticket)).toBe(false)
    const rows = await db.select().from(sessions).where(eq(sessions.opTaskId, 900005))
    expect(rows).toHaveLength(0)
  })
})

describe('shouldRecordCorrection (correction-loop decision rule)', () => {
  it('records a correction only for bug-classified tickets rejected in OP', () => {
    expect(shouldRecordCorrection('bug', 14)).toBe(true)
    expect(shouldRecordCorrection('bug', 6)).toBe(true)
  })
  it('does not record for non-bug classifications, even if rejected', () => {
    expect(shouldRecordCorrection('request', 14)).toBe(false)
    expect(shouldRecordCorrection('question', 6)).toBe(false)
    expect(shouldRecordCorrection(undefined, 14)).toBe(false)
  })
  it('does not record for a bug classification that was NOT rejected (e.g. Closed)', () => {
    expect(shouldRecordCorrection('bug', 12)).toBe(false)
  })
  it('does not record when the status could not be determined', () => {
    expect(shouldRecordCorrection('bug', null)).toBe(false)
  })
})

describe('detectRejectedOutcomes (DB orchestration, mocked OP API)', () => {
  const OP_BASE = 'https://op.test'
  const AUTH = 'Basic test'

  function mockOpStatus(statusIdByWpId: Record<number, number | 'error'>) {
    globalThis.fetch = (async (url: string | URL) => {
      const m = String(url).match(/work_packages\/(\d+)/)
      const wpId = m ? Number(m[1]) : -1
      const statusId = statusIdByWpId[wpId]
      if (statusId === undefined || statusId === 'error') {
        return new Response('error', { status: 500 })
      }
      return new Response(JSON.stringify({ _links: { status: { href: `/api/v3/statuses/${statusId}` } } }), { status: 200 })
    }) as typeof fetch
  }

  it('records a correction for a bug-classified ticket that dropped out of scope and was Rejected', async () => {
    const ticket = await insertTicket(900101, { outcomeCheckedAt: null })
    await db.insert(ticketAnalyses).values({
      id: `ta-900101-classify-test`, ticketId: ticket.id, kind: 'classify', result: { kind: 'bug' },
    })
    mockOpStatus({ 900101: 14 })

    const corrections = await detectRejectedOutcomes(OP_BASE, AUTH, [] /* dropped out of the open scope */)
    expect(corrections).toBeGreaterThanOrEqual(1)

    const [updated] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, ticket.id))
    expect(updated.outcomeCheckedAt).not.toBeNull()

    const corrRows = await db.select().from(ticketCorrections).where(eq(ticketCorrections.opWpId, 900101))
    expect(corrRows).toHaveLength(1)
    expect(corrRows[0].tikaClassification).toBe('bug')
    expect(corrRows[0].opOutcome).toBe('rejected')
  })

  it('does not record a correction for a non-bug ticket, but still marks it checked', async () => {
    const ticket = await insertTicket(900102, { outcomeCheckedAt: null })
    await db.insert(ticketAnalyses).values({
      id: `ta-900102-classify-test`, ticketId: ticket.id, kind: 'classify', result: { kind: 'request' },
    })
    mockOpStatus({ 900102: 14 })

    await detectRejectedOutcomes(OP_BASE, AUTH, [])

    const [updated] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, ticket.id))
    expect(updated.outcomeCheckedAt).not.toBeNull()
    const corrRows = await db.select().from(ticketCorrections).where(eq(ticketCorrections.opWpId, 900102))
    expect(corrRows).toHaveLength(0)
  })

  it('leaves outcomeCheckedAt null when OP is unreachable, so it retries next poll', async () => {
    const ticket = await insertTicket(900103, { outcomeCheckedAt: null })
    mockOpStatus({}) // any lookup returns 500

    await detectRejectedOutcomes(OP_BASE, AUTH, [])

    const [updated] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, ticket.id))
    expect(updated.outcomeCheckedAt).toBeNull()
  })
})
