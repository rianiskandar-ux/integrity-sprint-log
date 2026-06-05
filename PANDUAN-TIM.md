# Integrity Sprint Log — Panduan Tim

## Sebelum Mulai (Sekali Saja)

Install 2 aplikasi ini di PC kamu:

1. **Docker Desktop** → https://www.docker.com/products/docker-desktop/
   - Setelah install, buka Docker Desktop dan biarkan berjalan
   - (Centang "Start Docker Desktop when you log in" supaya otomatis)

2. **Git** → https://git-scm.com/download/win
   - Install dengan semua setting default (Next > Next > Finish)

---

## Setup Pertama Kali

Buka **Command Prompt** atau **PowerShell**, lalu:

```
git clone <URL_REPO_ISL>
cd daily-sprint-next
setup-docker.bat
```

> **URL repo** minta ke Rian.

Script akan otomatis build dan jalankan aplikasi (~3-5 menit).
Setelah selesai, buka: **http://localhost:3000**

Setup Wizard akan muncul — ikuti langkah-langkahnya:
1. **Token OpenProject** — buat token pribadi kamu di OP (lihat cara di bawah)
2. **Identitas** — pilih nama kamu
3. **Projects** — pilih project yang kamu kerjakan
4. **Google Calendar** — connect akun Google kantor (opsional)
5. **Sync** — sync data dari OP
6. **Selesai!**

---

## Cara Buat Token OpenProject Pribadi

1. Login ke https://tokek.integrity-asia.com
2. Klik avatar kamu (pojok kanan atas) → **My account**
3. Kiri bawah → **Access tokens**
4. Klik **+ API token** → beri nama "ISL" → **Save**
5. Copy token-nya → paste di Setup Wizard

> Token ini **wajib** — dipakai untuk mencatat waktu kerja atas nama kamu di OP.

---

## Penggunaan Harian

- Aplikasi otomatis jalan saat Docker Desktop aktif
- Buka browser → **http://localhost:3000**
- Kalau belum jalan: buka Command Prompt di folder `daily-sprint-next` → `docker compose up -d`

---

## Kalau Ada Update

Rian akan kasih tau kalau ada update. Cukup double-click:

```
update.bat
```

Data sprint kamu **tidak akan terhapus**.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Halaman tidak bisa dibuka | Pastikan Docker Desktop berjalan |
| 502 Bad Gateway | `docker compose restart` |
| Setup Wizard muncul terus | Token OP salah, coba buat token baru |
| GCal tidak connect | Pastikan login Google pakai akun kantor |

Masalah lain? Chat Rian.
