# PRD — ISL Helpdesk & QA Validation Pipeline

**Status:** Draft v1 for alignment (Rian + Aufa)
**Author:** Claude (with Rian)
**Date:** 2026-07-10
**Modules:** 2 new ISL agents (Tika, Vera) + 1 new ISL view (Helpdesk) + OP comment automation

---

## 1. Summary

Bug reports currently flow from reporters straight to the developer (Rian) with no systematic filter. Many reports turn out to be invalid, duplicated, or environment-specific — but discovering that costs developer/QA time on every single ticket.

This PRD introduces an automated helpdesk layer inside ISL that:

1. **Reads every new ticket in OpenProject automatically** (OP stays the single source of truth).
2. **Triages it**: classifies, checks clarity, detects duplicates, watches staleness.
3. **Validates bugs technically** (Phase 2): generates and runs a Playwright reproduction, attaches evidence.
4. **Routes the result to QA (Aufa) for human judgment** — she works entirely inside OP, never inside ISL.
5. **Delivers only confirmed, evidence-backed bugs to Rian** in a new ISL Helpdesk view.

The reporter (Yudhi) changes **nothing** about how he works. The system adapts to him, never the other way around. A messy report is a system problem to solve, not a reporter mistake.

---

## 2. Problem

| # | Pain today | Cost |
|---|-----------|------|
| P1 | Reports reach Rian unvalidated; some are not reproducible | Dev time wasted proving a negative |
| P2 | Duplicate tickets for the same underlying issue | Split discussion, double work |
| P3 | Reports missing steps/expected-vs-actual | Ping-pong clarification rounds |
| P4 | Old tickets rot silently; reporter never hears back | Trust erosion, zombie backlog |
| P5 | QA (Aufa) reproduces everything manually from zero | QA time spent on noise, not judgment |
| P6 | Some "bugs" are reporter-device/environment issues | Nobody detects this systematically |

---

## 3. Goals & Non-Goals

### Goals
- G1. Zero invalid/duplicate tickets reaching Rian's plate (target: <5% slip rate).
- G2. Every ticket gets an automated first response when action is needed from the reporter (clarity, duplicate, status update) — in English, polite, never blaming.
- G3. Aufa's job shifts from "reproduce everything manually" to "judge evidence" — her per-ticket effort drops.
- G4. Rian gets a single ISL queue of confirmed bugs with evidence attached.
- G5. Full transparency of the pipeline in the existing Agent Flow page (Tika/Vera appear as agent nodes).

### Non-Goals (explicitly out of scope)
- NG1. Not a full ITSM/helpdesk product (no SLA billing, no customer portal, no email intake).
- NG2. Not auto-closing anything. Agents mark, link, and notify; **humans close**.
- NG3. Not replacing Aufa. Playwright catches functional web bugs only; performance, race conditions, and device-specific issues still require her judgment (this is by design, see §6.4).
- NG4. Not changing OP workflow/status configuration org-wide (admin overhead, affects other teams). Agent state lives in ISL; OP is written to via comments and existing fields only.
- NG5. Not multi-tenant. Single-machine (Rian's PC), same as the rest of ISL.

---

## 4. Personas & Responsibility Model

| Persona | Role | RACI | Works in | Behavior change required |
|---------|------|------|----------|--------------------------|
| **Yudhi** (stakeholder) | Reports bugs/requests | Accountable for reporting | OP only | **None.** Reports however he wants |
| **Tika** (new ISL agent) | Helpdesk triage: classify, clarity, dedup, staleness, reporter comms | Responsible (triage) | ISL engine → OP comments | — |
| **Vera** (new ISL agent, Phase 2) | Technical validation: Playwright repro + evidence | Responsible (validation) | ISL engine → OP comments | — |
| **Aufa** (QA) | Human judgment: confirm/reject/needs-info on validated tickets | Responsible (verdict) | OP only | New: works from evidence instead of from zero |
| **Rian** (developer) | Fix confirmed bugs; owns the pipeline | Consulted → Assignee | ISL Helpdesk view + OP | New: only sees confirmed tickets |
| **Aryo** (existing agent) | Daily report includes helpdesk summary | Informed | PDF/Telegram | — |

Naming note: Tika (from *tiket*) and Vera (from *verify*) follow the existing ISL persona convention (Arka, Luna, Dira, Rendi, Kafi, Aryo, Nara).

---

## 5. End-to-End Flow

```
Yudhi creates ticket in OP (free-form, any quality)
        │
        ▼
[TIKA — intake, runs on OP polling cycle]
  1. Classify: bug / request / question / unclear        (local LLM)
  2. Clarity check: repro steps? expected vs actual?     (local LLM)
  3. Dedup check: similar open tickets?                  (pgvector hybrid search)
        │
        ├─ Unclear ──────→ OP comment to reporter: polite request for
        │                  the missing pieces (template). State: NEEDS_INFO
        │
        ├─ Duplicate suspect ─→ OP comment linking the tickets, tag Aufa
        │                       to confirm merge. State: DUP_SUSPECT
        │                       (NEVER auto-closed — human confirms)
        │
        └─ Clear bug ────→ State: READY_FOR_QA
                │
                ▼
[VERA — Phase 2, per clear bug]
  4. Generate Playwright reproduction script             (Claude — coding)
  5. Run against target environment (staging by default)
  6. Post OP comment: REPRODUCED / NOT REPRODUCED / INCONCLUSIVE
     + evidence (log excerpt, screenshot), tag Aufa
     State: QA_REVIEW
                │
                ▼
[AUFA — human judgment, inside OP]
  7. Read evidence → apply the judgment checklist (§7)
        ├─ CONFIRM  → assign to Rian, severity set → State: CONFIRMED
        ├─ REJECT   → env/device issue → comment to reporter with
        │             evidence + suspected cause → back to reporter
        └─ NEED INFO → targeted question to reporter
                │
                ▼
[RIAN — ISL Helpdesk view]
  8. Queue shows only CONFIRMED tickets + full trail
     (classification, dedup links, validation runs, Aufa's verdict)
  9. Fix → OP status flows as usual → status-sync updates ISL
        │
        ▼
[STALENESS WATCH — Tika, orthogonal to all states]
  Any ticket idle past threshold → reporter gets a status update,
  Aryo's daily report gets an escalation line. No silent rot.
```

---

## 6. Feature Specification

### 6.1 F1 — Tika: Intake & Classification

**Trigger:** OP polling cycle (reuse existing `op-cache` refresh pattern; interval configurable, default 10 min while PC is on).

**Scope filter:** configurable OP project list + work package types (default: type `Bug` + `Support` in the designated helpdesk project — see Open Questions).

**Pipeline per new/updated ticket:**

| Step | What | Engine | Output |
|------|------|--------|--------|
| Classify | bug / feature request / question / unclear | qwen2.5:3b, JSON Schema constrained | `ticket_analyses` row |
| Clarity check | Are repro steps, expected, actual present? | qwen2.5:3b | missing-fields list |
| Language handling | Reports may be Indonesian; analysis output stored English | local LLM | normalized summary |

**Rules:**
- Local LLM only (free, private). Claude is **not** called during intake — cost discipline.
- A ticket is analyzed once per content-change (track OP `updatedAt`/lockVersion), not once per poll.
- Agent never edits the ticket body or changes OP status at this stage — comments only.
- All agent comments carry a signature line (`— Tika · ISL Helpdesk (automated)`) and agent-authored activity is ignored on subsequent polls (loop guard).

### 6.2 F2 — Dedup Detection

**Engine:** reuse the existing Super Memory stack — embed ticket subject+description via Ollama `nomic-embed-text` into the existing `embeddings` table (`source_type='ticket'`), query with the proven `hybridSearch` (keyword ILIKE + semantic, cutoff 0.5) against **open** tickets in scope.

**Decision rule (initial thresholds, tunable in shadow mode):**
- similarity ≥ 0.85 → flag DUP_SUSPECT
- 0.70–0.85 → "possibly related" note in ISL only (no OP comment — avoid noise)
- < 0.70 → unique

**Hard rule: never auto-close.** Tika posts one comment on the *newer* ticket linking the suspected original, tags Aufa, and records the pair in `ticket_links`. Aufa confirms or rejects the merge. Wrong auto-merges destroy reporter trust; a false *suspect* costs one human glance.

### 6.3 F3 — Staleness Watch & Reporter Communications

Runs on the same polling cycle. Thresholds (defaults, configurable):

| Condition | Action | Recipient |
|-----------|--------|-----------|
| NEEDS_INFO, reporter silent 5 business days | Gentle reminder comment | Yudhi |
| Any open ticket, no activity 14 days | Status update comment ("still in queue, current state: X") | Yudhi |
| Any open ticket, no activity 30 days | Escalation line in Aryo daily report | Rian |
| Ticket resolved in OP | Resolution notice comment | Yudhi |

**Anti-spam guards (critical for a PC-that-sleeps system):**
- Staleness computed from **OP last-activity timestamp**, never from "time since last poll" — a week of PC downtime must not fire a week of reminders.
- Max 1 automated comment per ticket per 24h; max N (default 10) reporter-facing comments per catch-up cycle, remainder deferred to next cycle.
- Every reporter-facing template ends with: *"If this doesn't match what you're seeing, just reply here — a human will pick it up."*

### 6.4 F4 — Vera: Technical Validation (Phase 2)

**Trigger:** ticket reaches READY_FOR_QA.

**Pipeline:**
1. **Script generation** — Claude (this is coding; local 3B is not good enough) produces a Playwright script from the repro steps, against a **per-app environment registry** (URL, test account, known selectors/fixtures) maintained in ISL settings.
2. **Execution** — Playwright runs headless on Rian's machine. Default target: **staging**. Production runs are allowed only for scripts tagged read-only (navigation/assertion, no form submission, no data mutation) — enforced by a static check on the generated script (no `.click()` on submit-type elements, no `page.fill` + submit patterns) plus manual allowlist.
3. **Evidence** — screenshot, console/network log excerpt, script itself → stored under `validation_runs`, artifacts on disk (ISL volume), summary posted as OP comment.
4. **Verdict posted:** `REPRODUCED` / `NOT REPRODUCED` / `INCONCLUSIVE` (script error, env unreachable, flow not automatable) + tag Aufa.

**Honest scope:** Vera covers deterministic functional web flows. She will return INCONCLUSIVE for: performance degradation, race conditions, visual glitches, device-specific behavior, anything needing real user data. That is expected and fine — INCONCLUSIVE routes to Aufa exactly like today, minus the noise that *was* automatable.

**Safety defaults:** staging-first; per-app kill-switch; global dry-run mode (generate script but don't execute) for the first weeks.

### 6.5 F5 — ISL Helpdesk View (Rian's cockpit)

New sidebar entry **Helpdesk 🎫** (ISL section, shortcut `T`). Tabs:

| Tab | Contents | Primary use |
|-----|----------|-------------|
| **Queue** | Tickets by lifecycle stage (NEW → TRIAGED → NEEDS_INFO / DUP_SUSPECT → READY_FOR_QA → VALIDATING → QA_REVIEW → **CONFIRMED**), CONFIRMED pinned top | Daily: "what's actually mine" |
| **Dedup** | Suspected/confirmed duplicate clusters with similarity scores | Spot-check Tika's precision, tune threshold |
| **Runs** (Phase 2) | Validation run history: script, verdict, artifacts, duration | Debug false negatives, review evidence |
| **Comms** | Log of every automated comment sent (who, what, when, template) | Audit: "what did my agents say to people?" |
| **Settings** | Scope (OP projects/types), thresholds, env registry, dry-run/kill switches | Control |

Plus:
- **Stats strip:** intake this week · % auto-triaged · dup catch count · invalid-stopped count · median report→confirmed time.
- **Agent Flow page:** Tika and Vera appear as nodes (INPUT side, between OpenProject and the core), with IDLE/RUNNING/ALERT states like every other agent.
- **Telegram:** new CONFIRMED ticket → existing notification channel; Vera verdict summaries batched, not per-run spam.
- **Aryo daily report:** new "Helpdesk" section — intake, confirmed, rejected, stale escalations.

### 6.6 What each existing piece is reused (build-cost honesty)

| Need | Reused from ISL today | New work |
|------|----------------------|----------|
| OP polling | `op-cache` refresh pattern | scope filter + analysis trigger |
| Similarity | `embeddings` table + `hybridSearch` (verified E2E) | `source_type='ticket'` + thresholds |
| Cheap classification | qwen2.5:3b + JSON Schema pattern (proven in Arka hook) | 2 new prompts/schemas |
| English OP comments | `op/activity-summary` comment pattern | templates + loop guard |
| Notifications | `lib/telegram.ts` | 2 new message types |
| Reporting | Aryo daily PDF pipeline | 1 new section |
| UI shell | AppShell/Sidebar view routing | 1 new view + 5 tabs |
| **Genuinely new** | — | ticket state machine, `ticket_*` tables, comment templates, staleness engine, (P2) Playwright runner + env registry |

---

## 7. Aufa's Playbook (her entire job, in OP)

**When she gets pulled in** (OP mention/notification):
1. Tika suspects a duplicate → confirm or reject the link (one glance at both tickets).
2. Vera posts a validation verdict → apply the judgment checklist.
3. INCONCLUSIVE verdicts → manual check as today (but pre-filtered and pre-documented).

**Judgment checklist (Tier-3, the human layer no script replaces):**
- Reporter's environment: browser/OS/app version vs ours? Cache/cookies? VPN/network?
- Data-specific: does it only break with the reporter's specific record/account?
- Timing: was there a deploy/config change around the report time?
- Is NOT REPRODUCED because the bug is env-specific, or because the repro steps were wrong?

**Her three verbs, and what each sends:**

| Verdict | She does (in OP) | Who receives what |
|---------|------------------|-------------------|
| **CONFIRM** | Sets severity, assigns to Rian, posts the Confirmed Bug Package (template below) | Rian gets it in ISL CONFIRMED queue + Telegram |
| **REJECT (env/device)** | Comment to reporter: evidence + suspected cause + suggested fix on their side | Yudhi gets a respectful, evidence-backed answer instead of silence |
| **NEED INFO** | One targeted question (not "cannot reproduce, please check") | Yudhi knows exactly what to provide |

**Confirmed Bug Package (OP comment template, English):**
```
✅ CONFIRMED — ready for development
Verified repro steps: 1) … 2) … 3) …
Environment verified on: [staging/prod] / [browser+version]
Severity: [Critical / High / Medium / Low] — [one-line impact reason]
Evidence: [Vera run link / screenshot / manual verification note]
Notes for dev: [suspected area, deploy correlation, anything smelled]
```
This template is the **contract between Aufa and Rian** — a CONFIRMED ticket missing these fields is not confirmed.

**SLA proposal (to agree with her, not imposed):** verdict within 1 business day of Vera's evidence landing.

---

## 8. Yudhi's Experience (reporter)

**He changes nothing.** Free-form reports, any language, any quality. The system's job is to extract signal.

**What he receives (all templated, English, signature-marked as automated):**

| Event | Message character |
|-------|-------------------|
| Report unclear | "Thanks for the report — to reproduce it we still need: [list]. A short screen recording also works." Never "your report is incomplete." |
| Duplicate suspected | "This looks related to #123 (status: in progress). We've linked them so nothing gets lost — updates will land there." |
| Idle/stale | "Still in queue — current state: [X]. You'll hear from us when it moves." |
| Env-issue rejection (from Aufa) | Evidence + suspected cause + what to try on his side |
| Resolved | "Fixed in [version/deploy]. Please reopen if it resurfaces." |

**Tone rules (hard requirements for every template):** never blame, always give the next action, always offer the human escape hatch ("reply here and a human picks it up"). No ack-spam on clean tickets — first automated message appears only when there is something useful to say.

---

## 9. Ticket Lifecycle (ISL-side state machine)

```
NEW ─→ TRIAGED ─┬─→ NEEDS_INFO ──(reporter replies)──→ re-TRIAGE
                ├─→ DUP_SUSPECT ──(Aufa confirms)────→ linked & parked
                │                 (Aufa rejects)─────→ READY_FOR_QA
                └─→ READY_FOR_QA ─→ VALIDATING ─→ QA_REVIEW ─┬─→ CONFIRMED → (OP flow: In progress → Resolved → Closed)
                                                             ├─→ REJECTED_ENV → reporter
                                                             └─→ NEED_INFO → reporter
STALE = flag, not a state — can attach to anything open.
```

**Design decision:** this state machine lives in **ISL tables**, not in OP statuses. OP keeps its existing workflow untouched (org-wide config change avoided, NG4). OP reflects the pipeline through comments; humans keep using normal OP statuses. If the pipeline proves itself, promoting states into OP custom fields is a later, reversible step.

---

## 10. Notification Matrix

| Event | Yudhi (OP comment) | Aufa (OP mention) | Rian (Telegram) | Rian (ISL) | Aryo report |
|-------|:--:|:--:|:--:|:--:|:--:|
| New ticket ingested | — | — | — | Queue | count |
| Clarity request sent | ✅ | — | — | Comms log | count |
| Duplicate suspected | ✅ | ✅ confirm? | — | Dedup tab | count |
| Vera verdict posted | — | ✅ judge | — | Runs tab | count |
| Aufa CONFIRMED | (status visible) | — | ✅ | **CONFIRMED queue** | ✅ |
| Aufa REJECTED (env) | ✅ evidence | — | — | Comms log | count |
| Stale reminder | ✅ | — | — | Comms log | — |
| 30-day escalation | — | — | — | flagged | ✅ line item |

Principle: Rian's Telegram fires **only** on CONFIRMED (the actionable moment). Everything else is pull (ISL view) or digest (Aryo). Per-event Telegram spam is how notification channels die.

---

## 11. Architecture & Data Model

**New Postgres tables (Drizzle, follows existing schema conventions):**

```
helpdesk_tickets      op_wp_id (unique), subject, reporter, op_status,
                      pipeline_state, last_op_activity_at, analyzed_content_hash,
                      created_at/updated_at
ticket_analyses       ticket_id FK, kind (classify|clarity|dedup), model,
                      result jsonb, created_at
ticket_links          ticket_id, related_ticket_id, similarity real,
                      status (suspected|confirmed|rejected), decided_by
validation_runs (P2)  ticket_id FK, script text, target_env, verdict,
                      artifacts_path, duration_ms, created_at
comms_log             ticket_id FK, template_key, recipient, op_comment_id,
                      sent_at   ← the anti-spam ledger, one row per outbound comment
```
Embeddings reuse the existing `embeddings` table with `source_type='ticket'`.

**LLM division of labor (follows the established Phase-B rule):**

| Job | Engine | Why |
|-----|--------|-----|
| Classification, clarity check | qwen2.5:3b local | high-volume, cheap, JSON-schema proven |
| Ticket embeddings | nomic-embed-text local | already live |
| Standard reporter comments | **deterministic templates, no LLM** | predictable tone, zero cost, zero hallucination |
| Playwright script generation | Claude | coding quality |
| Non-template analysis prose in OP | Claude | English OP content rule |

**Runtime reality (accepted constraint):** everything runs on Rian's PC. PC off = pipeline paused, tickets queue in OP untouched, catch-up on boot with the anti-spam caps from §6.3. This is consistent with how all of ISL already works. If the team later needs 24/7 triage, that is the existing "Docker distribution / central sync" roadmap item, not this PRD.

**Agent identity in OP:** Phase 1 posts via Rian's API token with a mandatory signature line in every automated comment. A dedicated OP account (`ISL Helpdesk`) is cleaner (real attribution + robust loop-guard by user id) — listed as an open question for the OP admin.

---

## 12. Rollout Phases

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **0 — Shadow** (~1 week) | Tika ingests + analyzes + dedups. **Writes nothing to OP.** Rian watches Helpdesk view, tunes thresholds | Classification ≥90% agreement with Rian's manual spot-check; dup suspects sane |
| **1 — Tika live** | Reporter comms on (clarity, dup, staleness) with per-template toggles, comment caps active | 2 weeks without a single inappropriate comment; Yudhi not annoyed (ask him) |
| **2 — Vera staging** | Playwright validation for **one app** on staging, dry-run first, then execute | ≥70% of clear bugs get a non-INCONCLUSIVE verdict; zero unsafe prod actions |
| **3 — Aufa formalized** | Judgment checklist + Confirmed Bug Package agreed with her; SLA active; metrics dashboard | Rian receives only CONFIRMED tickets for a full sprint |
| **4 — Optional** | More apps in env registry; correction loop (Aufa's overrides feed back into thresholds/prompts) | ties into the existing Agent Evolution roadmap |

Phases 0–1 deliver most of the pain relief (P2, P3, P4) with near-zero risk and no Playwright complexity. **Recommendation: ship 0–1 first, decide on Vera with real intake data in hand** — the data will show how many tickets would actually benefit from automated repro.

---

## 13. Success Metrics

| Metric | Baseline (today) | Target after Phase 3 |
|--------|------------------|----------------------|
| Invalid/dup tickets reaching Rian | unmeasured (felt: frequent) | <5% of intake |
| Median time report → first useful response | days (manual) | <1 polling cycle while PC on |
| Dup catch rate (caught / confirmed dups) | 0% (nobody checks) | >80% |
| Tickets stale >14d without reporter update | unknown | 0 (watch guarantees contact) |
| Aufa manual repro effort | 100% of tickets | only INCONCLUSIVE + judgment |
| Pipeline trust (Aufa overrides Vera verdict) | — | <20% override rate |

Baseline honesty: first two weeks of Phase 0 double as **baseline measurement** — we currently have no numbers for intake volume or invalid rate. If shadow mode shows intake is tiny (e.g., <5 tickets/week), we should question whether Vera (Phase 2) is worth building at all and possibly stop at Phase 1. The PRD explicitly allows that outcome.

---

## 14. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dedup false positive merges distinct bugs | High | Never auto-close; Aufa confirms; 0.85 threshold tuned in shadow |
| LLM misreads ticket → wrong clarity request | Medium | Shadow phase; template includes human escape hatch; local model output is suggestions-grade, comments come from fixed templates |
| Playwright mutates production data | **Critical** | Staging default; static read-only check for prod scripts; per-app kill switch; dry-run mode |
| Comment loop (agent replies to itself) | Medium | Signature marker + skip agent-authored activities; `comms_log` dedup by (ticket, template, 24h) |
| PC-off backlog → notification burst on boot | Medium | Staleness from OP timestamps; per-cycle comment cap; 24h per-ticket cooldown |
| Yudhi feels policed by a bot | High (human) | Tone rules §8; no ack-spam; Rian briefs him *before* Phase 1 goes live, not after |
| Aufa feels replaced instead of upgraded | High (human) | She is Tier-3 authority — agents *prepare* work for her verdict; involve her in Phase 3 design of her own checklist |
| Scope creep into full ITSM | Medium | Non-goals section; new features require PRD revision |

---

## 15. Open Questions (need answers before Phase 0)

1. **OP scope:** which project(s) do Yudhi's reports land in? Existing `integritys-websites`, or a dedicated helpdesk project? Which WP types count as intake (Bug only? Support? Feature)?
2. **Vera targets (Phase 2):** which app first — eduverif / empverif / KYV / internal? Does a staging environment with a test account exist for it? (No staging = Vera is read-only-prod or blocked.)
3. **Dedicated OP agent account:** can the OP admin create an `ISL Helpdesk` user, or do we start under Rian's token + signature?
4. **Aufa's OP permissions:** can she set severity/assignee on these tickets today?
5. **Thresholds sign-off:** 5d reminder / 14d status update / 30d escalation — Rian to confirm or adjust.
6. **Yudhi briefing:** who tells him about the new automated replies, and when? (Recommended: Rian, casually, before Phase 1 — "the bot answers first so you get feedback faster.")

---

## 16. Explicit Design Decisions (so we don't re-litigate)

1. **OP is the single source of truth.** ISL stores derived pipeline state only. If ISL's DB burned down, no ticket data is lost.
2. **Aufa never needs ISL access.** Her whole workflow is OP comments + statuses. Keeps ISL single-user, no auth work, no exposure.
3. **Reporter is never wrong by design.** All friction lands on agents, not on Yudhi.
4. **Agents suggest, humans decide.** No auto-close, no auto-merge, no auto-reject. The pipeline compresses human decision time; it does not remove the human.
5. **Templates over generated prose** for reporter-facing messages. Predictable tone beats clever wording.
6. **Local-first LLM** per the established Phase-B division; Claude only where coding/English-prose quality demands it.
7. **Phase gate after shadow mode** — real intake data decides whether Vera gets built.
