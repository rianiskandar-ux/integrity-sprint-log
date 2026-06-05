# Daily Sprint App

Personal sprint tracker — tracks daily Claude sessions, OpenProject tasks, and skill progress across your team.

## Quick Start (Docker — Windows & Linux)

```bash
# 1. Clone
git clone <repo-url> daily-sprint
cd daily-sprint

# 2. Setup env
cp .env.example .env
# Edit .env — isi OP_API_TOKEN, OP_BASE_URL, OP_PROJECT_ID

# 3. Run
docker-compose up -d

# 4. Open
http://localhost:3000
```

Sprint files (markdown) disimpan di `./sprints/` di dalam project folder by default.
Kalau mau pakai folder sendiri, set `SPRINT_DATA_DIR=/path/ke/folder` di `.env`.

## Setup .env

```env
OP_API_TOKEN=opapi-xxxxx          # OpenProject API token
OP_BASE_URL=https://your-op.com   # OpenProject URL
OP_PROJECT_ID=your-project-id     # Project identifier
SPRINT_DATA_DIR=./sprints         # Where markdown files are stored (optional)
```

## Local Dev (tanpa Docker)

```bash
npm install
cp .env.example .env.local
# Edit .env.local
npm run dev
# → http://localhost:3000
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Daily view |
| `S` | Sprint view |
| `M` | Month view |
| `L` | Skills view |
| `T` | Jump to today |
| `j` / `→` | Next day |
| `k` / `←` | Previous day |
| `⌘K` / `Ctrl+K` | Search |

## Stop Hook (auto wrapup ke sprint file)

Tambahkan di `~/.claude/settings.json` untuk auto-log setiap conversation selesai:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "agent",
        "timeout": 60,
        "prompt": "Evaluate if this conversation had real technical deliverables. If yes, append a session summary to SPRINT_OUTPUT_DIR/YYYY-MM-DD.md under ## Technical Notes. Format: ### [Topic] — HH:MM WIB\\n\\n- bullet\\n\\nOnly if concrete technical outcomes exist."
      }]
    }]
  }
}
```

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4**
- **Data**: Markdown files (no database needed)
- **Docker**: single container, volume mount for sprint files
- Works on **Windows & Linux**
