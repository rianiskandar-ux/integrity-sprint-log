# Panduan Install ISL di Laptop/PC Sendiri (Manual)

Tiap orang menjalankan ISL **sendiri** di komputernya: data, login, dan AI terpisah —
**tidak akan bentrok** dengan punya orang lain.

> Estimasi waktu: ~20–30 menit (sebagian besar nunggu Docker build pertama kali).

---

## A. Yang harus disiapkan (requirements)

| # | Butuh | Cara dapat |
|---|---|---|
| 1 | **Docker Desktop** (Windows) | Download & install: <https://www.docker.com/products/docker-desktop/> — lalu **buka aplikasinya** sampai status "running" (ikon paus di taskbar hijau). |
| 2 | **Node.js** (untuk Claude CLI) | <https://nodejs.org> → install versi LTS. |
| 3 | **Claude Code** (AI gratis pakai subscription) | Buka PowerShell → `npm install -g @anthropic-ai/claude-code` → lalu `claude` (ikuti proses login sekali). |
| 4 | **Kode ISL** | Lihat **Langkah 1** di bawah (repo private — perlu akses dari Rian). |
| 5 | **OP API Token kamu** | OpenProject → klik foto profil → **My Account → Access Tokens → + API** → kasih nama → **Create** → **copy token-nya** (cuma muncul sekali). |

> Catatan: Git **opsional** — cuma perlu kalau ambil kode lewat `git clone` (Cara A). Kalau pakai ZIP (Cara B), tidak perlu Git.

---

## Langkah 1 — Ambil kode ISL (repo private)

Repo-nya private, jadi pilih salah satu:

### Cara A — Clone via Git (disarankan, gampang update nanti)
1. Kasih tahu Rian **username GitHub** kamu → Rian tambahkan kamu sebagai **collaborator** di repo
   `github.com/rianiskandar-ux/integrity-sprint-log` (Settings → Collaborators → Add).
2. Kamu dapat email undangan → **Accept**.
3. Di PowerShell:
   ```powershell
   cd $env:USERPROFILE
   git clone https://github.com/rianiskandar-ux/integrity-sprint-log.git
   cd integrity-sprint-log
   ```
   (kalau diminta login GitHub, masukkan akun kamu)

### Cara B — Tanpa Git (Rian kirim ZIP)
1. Rian kirim file ZIP folder project (lewat Drive/WA/email).
2. Extract ZIP-nya, mis. ke `C:\Users\NAMAKAMU\integrity-sprint-log`.
3. Buka PowerShell di folder itu (Shift+klik kanan di folder → "Open PowerShell window here").

> Update versi baru: **Cara A** tinggal `git pull`. **Cara B** minta ZIP baru lagi ke Rian.

---

## Langkah 2 — Cara cepat (otomatis) ATAU manual

### Opsi cepat (1 perintah) — disarankan
Di PowerShell, dari folder project:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-isl.ps1
```
Script ini otomatis: deteksi folder `.claude` kamu, generate kunci rahasia acak, bikin file `.env`,
lalu build + start Docker. **Kalau ini berhasil, lompat ke Langkah 4.**

### Opsi manual (kalau mau ngerti / script gagal)
Lanjut ke Langkah 3.

---

## Langkah 3 — Setup manual file `.env`

**3a. Copy template:**
```powershell
Copy-Item .env.example .env
```

**3b. Cari path home kamu** (buat isi lokasi Claude):
```powershell
echo $env:USERPROFILE
```
Misal hasilnya `C:\Users\budi` → berarti folder Claude kamu `C:/Users/budi/.claude`.

**3c. Generate 2 kunci rahasia acak** (jalankan 2x, simpan hasilnya):
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

**3d. Buka `.env` pakai Notepad** dan ganti yang ini saja:
```powershell
notepad .env
```
| Baris | Isi dengan |
|---|---|
| `CLAUDE_CREDS_DIR=` | `C:/Users/NAMAKAMU/.claude` (pakai `/`, bukan `\`) |
| `CLAUDE_CONFIG_FILE=` | `C:/Users/NAMAKAMU/.claude.json` |
| `ISL_ENCRYPTION_KEY=` | hasil generate ke-1 (langkah 3c) |
| `NEXTAUTH_SECRET=` | hasil generate ke-2 |
| `OP_BASE_URL=` | biarkan `https://tokek.integrity-asia.com` (kecuali beda) |

> `OP_API_TOKEN` **boleh dikosongkan** — nanti kamu login pakai token via halaman web.

Simpan (Ctrl+S), tutup Notepad.

---

## Langkah 4 — Jalankan ISL

Pastikan **Docker Desktop sudah dibuka & running**, lalu:
```powershell
docker compose up -d --build
```
> Pertama kali butuh **5–10 menit** (download + build). Sabar, jangan ditutup.

Kalau selesai tanpa error merah, ISL sudah jalan.

---

## Langkah 5 — Pakai pertama kali

1. Buka browser → **<http://localhost:4891>**
2. Otomatis ke halaman **Login** → masukkan **OP API Token** kamu → **Masuk**.
3. ISL otomatis tarik data OP kamu (sprint, task) ~30 detik. **Refresh** kalau belum muncul.
4. Selesai! Mulai kerja: log session, push ke OP, chat AI (default **Claude CLI**, gratis).

Karena ini instance pribadi, **kamu pemilik penuh data-mu** — tersimpan di Docker di komputermu sendiri.

---

## Operasional harian

| Aksi | Perintah (di folder project) |
|---|---|
| Nyalakan (kalau belum jalan) | `docker compose up -d` |
| Matikan | `docker compose down` |
| Lihat log kalau ada masalah | `docker compose logs -f integrity-sprint-log` |
| Update ke versi baru (Cara A) | `git pull` lalu `docker compose up -d --build` |

---

## Kalau ada masalah (troubleshooting)

- **`docker: command not found` / error Docker** → Docker Desktop belum dibuka. Buka dulu, tunggu "running".
- **Halaman 4891 tidak kebuka** → tunggu 1–2 menit setelah `up` (server lagi start). Cek `docker compose logs -f integrity-sprint-log`.
- **AI Chat error / tidak jawab** → kamu belum login Claude. Jalankan `claude` di PowerShell, login, lalu `docker compose restart integrity-sprint-log`.
- **Login "OP token tidak valid"** → token salah/expired. Bikin token baru di OpenProject.
- **Port 4891 dipakai aplikasi lain** → edit `docker-compose.yml` bagian `ports`, ganti `4891` ke angka lain (mis. `4892`), lalu `docker compose up -d`.

Mentok? Screenshot error-nya, kirim ke Rian.
