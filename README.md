# Integrity Sprint Log (ISL)

Sprint tracker untuk tim yang menggunakan **Claude AI + OpenProject**.  
Auto-log setiap sesi AI ke OpenProject — tanpa input manual.

---

## Apa ini?

ISL menghubungkan tiga hal:
- **Claude AI sessions** (VS Code, Kiro, atau Terminal ISL)
- **OpenProject** — task management tim
- **Sprint log** — Daily, Weekly, Sprint overview

Setiap kali kamu selesai chat dengan Claude, ISL otomatis:
1. Buat ringkasan sesi (title + bullets)
2. Cari task yang matching di OpenProject
3. Post activity log + time entry ke OP
4. Tampilkan di ISL Daily

---

## Prasyarat

Sebelum mulai, pastikan sudah terinstall:

| Tool | Link | Untuk apa |
|---|---|---|
| **Node.js 18+** | https://nodejs.org | Menjalankan ISL |
| **Claude CLI** | https://docs.anthropic.com/claude-code | AI provider (subscription, bukan API key) |
| **Git** | https://git-scm.com | Download kode |

Cek versi:
```bash
node -v        # harus >= 18
claude --version
git --version
```

---

## Cara Install (5 langkah)

### Step 1 — Download

```bash
git clone https://github.com/rianiskandar-ux/integrity-sprint-log.git isl
cd isl
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Setup environment

```bash
# Windows
copy .env.local.example .env.local

# Mac / Linux
cp .env.local.example .env.local
```

Buka file `.env.local` dan isi minimal:
```env
CACHE_DATA_DIR=C:/Users/NAMAKAMU/ai-apps/isl-data
SPRINT_OUTPUT_DIR=C:/Users/NAMAKAMU/ai-apps/isl-data/sprints
```

> Ganti `NAMAKAMU` dengan username kamu. Folder akan dibuat otomatis.

**OP Token dan konfigurasi lain** diisi via **Setup Wizard** saat pertama buka aplikasi — tidak perlu edit file lagi.

### Step 4 — Build & jalankan

```bash
npm run build
node .next/standalone/server.js
```

Buka browser: **http://localhost:3000**

### Step 5 — Setup hook Claude (WAJIB untuk auto-log)

Buka file `~/.claude/settings.json` (buat kalau belum ada), tambahkan:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node C:/Users/NAMAKAMU/ai-apps/isl/hooks/isl-context.mjs",
        "timeout": 120
      }]
    }]
  }
}
```

> Ganti path sesuai lokasi folder ISL kamu.

---

## Setup Wizard (First Run)

Saat pertama buka http://localhost:3000, kamu akan diminta isi:

1. **Nama** — untuk label di sprint report
2. **OpenProject URL** — contoh: `https://tokek.integrity-asia.com`
3. **OpenProject API Token** — bisa dibuat di OP → Settings → API access tokens
4. **AI Provider** — pilih `Claude CLI` (gratis pakai subscription) atau masukkan API key

Setup selesai → langsung bisa dipakai.

---

## Cara Pakai Sehari-hari

### Auto-log (otomatis)
Tidak perlu melakukan apa-apa. Setiap sesi Claude selesai, ISL otomatis log ke Daily.

### Manual link ke task OP
Ketik di awal chat Claude:
```
!ticket:7519    ← ID task di OpenProject
```
ISL akan log sesi ini ke task tersebut. Kalau ID adalah User Story, ISL akan **buat task baru** di bawahnya.

### Lihat log hari ini
Buka ISL → **Daily** → pilih tanggal

### Push ke OpenProject
Buka ISL → **Auto Log** → Push Queue → klik Push

### Post agenda ke OP Meeting
Buka ISL → Sprint → tab **Agenda** → pilih meeting → Post

### Terminal Claude langsung dari ISL
Buka ISL → **Terminal** (sidebar) → ketik `claude` → session otomatis ter-log

---

## Struktur Folder

```
isl/
├── app/                  # Next.js pages & API routes
├── components/           # UI components (SprintView, AgendaTab, dll)
├── hooks/
│   └── isl-context.mjs   # Stop hook — ini yang auto-log ke OP
├── lib/                  # Utilities (op-cache, user-config, llm)
├── .env.local.example    # Template environment
└── README.md
```

Data user (cache, sessions, config) disimpan di `CACHE_DATA_DIR` yang kamu set di `.env.local` — **tidak masuk git**.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| `cannot find module` saat build | Jalankan `npm install` dulu |
| Auto-log tidak muncul di Daily | Cek hook sudah ditambah ke `~/.claude/settings.json` |
| OP tidak terkoneksi | Cek OP URL dan token di ISL Settings |
| Terminal tidak bisa connect | Pastikan Launcher Dashboard jalan di port 9000 |
| Port 3000 sudah dipakai | `set PORT=3001 && node .next/standalone/server.js` |

---

## Keamanan

- **`.env.local` tidak pernah masuk git** — aman untuk di-push
- Token OP dan API keys disimpan lokal di `CACHE_DATA_DIR/user-config.json` — tidak dikirim ke mana-mana
- Semua komunikasi antara ISL dan OP terjadi di local machine kamu
- Claude CLI berjalan lokal — tidak ada data yang dikirim ke server ISL

---

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4**
- **xterm.js** — embedded terminal
- **node-pty** — PTY spawning di Launcher
- **OpenProject API v3**
- **Claude CLI** — AI via subscription
