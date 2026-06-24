# ISL — Panduan Setup Tim (Model B: instance sendiri per orang)

Tiap anggota tim menjalankan ISL **sendiri** di laptop/PC masing-masing: Docker sendiri,
database sendiri, OP token sendiri, AI (Claude) pakai akun sendiri. **Data antar orang
tidak mungkin bentrok** karena terpisah total.

---

## Prasyarat (sekali saja)

1. **Docker Desktop** terinstall & jalan. <https://www.docker.com/products/docker-desktop/>
2. **Git** terinstall.
3. **Claude Code** terinstall & sudah login (untuk AI Chat gratis pakai subscription):
   ```
   npm install -g @anthropic-ai/claude-code
   claude            # ikuti proses login sekali
   ```
4. **OP API Token** kamu sendiri: OpenProject → My Account → Access Tokens → API → buat token.

---

## Setup cepat (otomatis)

```powershell
git clone https://github.com/rianiskandar-ux/integrity-sprint-log.git
cd integrity-sprint-log
powershell -ExecutionPolicy Bypass -File scripts/setup-isl.ps1
```

Script ini otomatis: deteksi folder `.claude` kamu, generate kunci enkripsi acak, bikin `.env`,
lalu build + start Docker. Setelah selesai, buka **<http://localhost:4891>**.

---

## Setup manual (kalau tidak pakai script)

```bash
git clone https://github.com/rianiskandar-ux/integrity-sprint-log.git
cd integrity-sprint-log
cp .env.example .env
```

Edit `.env` — yang WAJIB diganti:

| Variabel | Isi dengan |
|---|---|
| `CLAUDE_CREDS_DIR` | Path folder `.claude` kamu, mis. `C:/Users/NAMAKAMU/.claude` |
| `CLAUDE_CONFIG_FILE` | `C:/Users/NAMAKAMU/.claude.json` |
| `ISL_ENCRYPTION_KEY` | String acak unik (mis. hasil `openssl rand -hex 32`) |
| `NEXTAUTH_SECRET` | String acak lain |

`OP_API_TOKEN` boleh dikosongkan (kamu login pakai token via halaman `/login`).

Lalu:
```bash
docker compose up -d --build
```

---

## Pertama kali pakai

1. Buka **<http://localhost:4891>** → otomatis ke `/login`.
2. Masukkan **OP API Token** kamu → Masuk.
3. ISL otomatis tarik data OP kamu (sprint, task) di background (~30 detik). Refresh kalau perlu.
4. Mulai kerja: log session, push ke OP, chat AI (default **Claude CLI**, gratis).

Karena ini instance pribadi, **kamu adalah owner** — semua data (session, sprint, chat)
punya kamu sendiri, tersimpan di Docker di mesin kamu.

---

## Operasional harian

| Aksi | Perintah |
|---|---|
| Start / sudah jalan otomatis | `docker compose up -d` |
| Stop | `docker compose down` |
| Lihat log | `docker compose logs -f integrity-sprint-log` |
| Update versi terbaru | `git pull` lalu `docker compose up -d --build` |
| Backup DB | `powershell -File scripts/backup-isl.ps1` |

---

## Catatan penting

- **AI Chat** default pakai **Claude CLI** (akun Claude kamu sendiri, gratis pakai subscription).
  Model bisa diganti lewat dropdown "Model" di dalam chat. TokenRouter/OpenModel opsional (isi key sendiri di `.env`).
- **Tidak ada data bersama** antar anggota di model ini. Kalau nanti tim mau data terpusat
  (lihat progress satu sama lain), itu butuh 1 PostgreSQL bareng di Mini PC — fase berikutnya.
- `.env` berisi rahasia — **jangan commit** (sudah di `.gitignore`).
- Port default **4891**. Kalau bentrok, ubah di `docker-compose.yml` bagian `ports`.
