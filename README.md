# Integrity Sprint Log (ISL)

Sprint tracker for teams using **Claude AI + OpenProject**.  
Auto-logs every AI session to OpenProject — no manual input needed.

---

## What is this?

ISL connects three things:
- **Claude AI sessions** (VS Code, Kiro, or ISL Terminal)
- **OpenProject** — team task management
- **Sprint log** — Daily, Weekly, Sprint overview

Every time you finish a Claude session, ISL automatically:
1. Generates a summary (title + bullets)
2. Finds the matching task in OpenProject
3. Posts an activity log + time entry to OP
4. Shows it in ISL Daily

---

## Prerequisites

Make sure these are installed before you start:

| Tool | Link | Purpose |
|---|---|---|
| **Node.js 18+** | https://nodejs.org | Run ISL |
| **Claude CLI** | https://docs.anthropic.com/claude-code | AI provider (subscription, no API key needed) |
| **Git** | https://git-scm.com | Download the code |

Check versions:
```bash
node -v        # must be >= 18
claude --version
git --version
```

---

## Installation (5 steps)

### Step 1 — Clone the repo

```bash
git clone https://github.com/rianiskandar-ux/integrity-sprint-log.git isl
cd isl
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Set up environment

```bash
# Windows
copy .env.local.example .env.local

# Mac / Linux
cp .env.local.example .env.local
```

Open `.env.local` and fill in at minimum:
```env
CACHE_DATA_DIR=C:/Users/YOURUSERNAME/isl-data
SPRINT_OUTPUT_DIR=C:/Users/YOURUSERNAME/isl-data/sprints
```

> Replace `YOURUSERNAME` with your actual username. The folders will be created automatically.

**OP token and other settings** are configured via the **Setup Wizard** when you first open the app — no need to edit more files.

### Step 4 — Build & run

```bash
npm run build
node .next/standalone/server.js
```

Open your browser: **http://localhost:3000**

### Step 5 — Register the Claude hook (required for auto-logging)

Open `~/.claude/settings.json` (create it if it doesn't exist) and add:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node C:/Users/YOURUSERNAME/isl/hooks/isl-context.mjs",
        "timeout": 120
      }]
    }]
  }
}
```

> Update the path to match where you cloned the ISL repo.

---

## Setup Wizard (First Run)

When you first open http://localhost:3000, you'll be prompted to fill in:

1. **Display name** — shown in sprint reports
2. **OpenProject URL** — e.g. `https://your-openproject.com`
3. **OpenProject API token** — create one at OP → Settings → API access tokens
4. **AI provider** — choose `Claude CLI` (free with subscription) or enter an API key

Once done, ISL is ready to use.

---

## Daily Usage

### Auto-logging (automatic)
Nothing to do — every Claude session is logged to Daily automatically when the session ends.

### Link a session to a specific OP task
Type this at the start of a Claude session:
```
!ticket:7519    ← task ID in OpenProject
```
ISL will log the session to that task. If the ID is a User Story, ISL will **create a new child task** under it.

### View today's log
Open ISL → **Daily** → select a date

### Push to OpenProject
Open ISL → **Auto Log** → Push Queue → click Push

### Post agenda to an OP Meeting
Open ISL → Sprint → **Agenda** tab → select a meeting → Post

### Run Claude directly from ISL
Open ISL → **Terminal** (sidebar) → type `claude` → session is logged automatically

---

## Project Structure

```
isl/
├── app/                  # Next.js pages & API routes
├── components/           # UI components (SprintView, AgendaTab, etc.)
├── hooks/
│   └── isl-context.mjs   # Stop hook — handles auto-logging to OP
├── lib/                  # Utilities (op-cache, user-config, llm)
├── .env.local.example    # Environment template
└── README.md
```

User data (cache, sessions, config) is stored in `CACHE_DATA_DIR` — **never committed to git**.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `cannot find module` on build | Run `npm install` first |
| Sessions not appearing in Daily | Check that the hook is added to `~/.claude/settings.json` |
| OpenProject not connecting | Check OP URL and token in ISL Settings |
| Terminal can't connect | Make sure Launcher Dashboard is running on port 9000 |
| Port 3000 already in use | `set PORT=3001 && node .next/standalone/server.js` |

---

## Security

- **`.env.local` is never committed** — safe to push
- OP tokens and API keys are stored locally in `CACHE_DATA_DIR/user-config.json` — never sent anywhere
- All communication between ISL and OpenProject happens on your local machine
- Claude CLI runs locally — no data is sent to ISL servers

---

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4**
- **xterm.js** — embedded terminal
- **node-pty** — PTY spawning in Launcher
- **OpenProject API v3**
- **Claude CLI** — AI via subscription
