<#
  ISL Backup — PostgreSQL dump + user-config, dengan upload ke Google Drive (rclone)
  dan rotasi 30 hari. Aman dijalankan berulang (idempotent).

  Jalankan manual:   powershell -ExecutionPolicy Bypass -File scripts\backup-isl.ps1
  Dijadwalkan:       lihat scripts\setup-backup-schedule.ps1

  Cloud: folder backup ada di dalam ai-apps yang sudah di-sync Google Drive for Desktop,
  jadi backup otomatis ke-upload ke Drive TANPA rclone. ISL_RCLONE_REMOTE default kosong.
  (Set ISL_RCLONE_REMOTE kalau mau pakai rclone alih-alih Drive Desktop.)

  Env opsional:
    ISL_BACKUP_DIR     folder backup lokal (default: C:\Users\user199\ai-apps\backups)
    ISL_RCLONE_REMOTE  remote rclone (default: KOSONG = pakai Drive Desktop sync)
    ISL_BACKUP_KEEP     hari retensi (default: 7)

  Hasil: 1 folder berisi 2 file -> isl-latest.sql.gz (DB) + user-config-latest.json,
  ditimpa tiap run (selalu yang terbaru, tidak menumpuk). Retensi 7 hari membersihkan sisa lama.
#>

$ErrorActionPreference = 'Stop'

# Default backup dir = di DALAM daily-sprints (satu-satunya folder yang di-sync Drive Desktop),
# subfolder _isl-backup. Jadi dump DB + config ikut naik ke Drive bareng markdown sprint.
$BackupRoot   = if ($env:ISL_BACKUP_DIR)    { $env:ISL_BACKUP_DIR }    else { 'C:\Users\user199\ai-apps\daily-sprints\_isl-backup' }
$RcloneRemote = if ($null -ne $env:ISL_RCLONE_REMOTE) { $env:ISL_RCLONE_REMOTE } else { '' }  # '' = pakai Drive Desktop
$KeepDays     = if ($env:ISL_BACKUP_KEEP)   { [int]$env:ISL_BACKUP_KEEP } else { 7 }

$PgContainer  = 'isl-postgres'
$AppContainer = 'integrity-sprint-log'

# Flat 1 folder, nama file TETAP (latest, overwrite tiap run) → total 2 file: DB + config.
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

function Log($m) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $m" }

# 1) Postgres dump (gzip di dalam container → docker cp keluar, hindari korup encoding)
$DbOut = Join-Path $BackupRoot 'isl-latest.sql.gz'
Log "Dump Postgres -> $DbOut"
docker exec $PgContainer sh -c "pg_dump -U isl -d isl | gzip -c > /tmp/isl-backup.sql.gz"
if ($LASTEXITCODE -ne 0) { throw "pg_dump gagal (exit $LASTEXITCODE)" }
docker cp "${PgContainer}:/tmp/isl-backup.sql.gz" $DbOut   # overwrite latest
docker exec $PgContainer rm -f /tmp/isl-backup.sql.gz
$sizeKb = [math]::Round((Get-Item $DbOut).Length / 1KB, 1)
Log "DB dump OK ($sizeKb KB)"

# 2) Config (sudah terenkripsi at-rest) — overwrite latest
try {
  docker cp "${AppContainer}:/app/data/user-config.json" (Join-Path $BackupRoot 'user-config-latest.json')
  Log "Config dump OK"
} catch { Log "WARN: gagal copy config: $_" }

# 3) Data sprint markdown (tidak ada di Git) — zip overwrite latest.
#    DILEWATI bila backup dir ada di dalam folder sprint (markdown sudah ke-sync raw → zip redundan).
$SprintDir = if ($env:ISL_SPRINT_DIR) { $env:ISL_SPRINT_DIR } else { 'C:\Users\user199\ai-apps\daily-sprints' }
$backupInsideSprint = (Resolve-Path $BackupRoot -ErrorAction SilentlyContinue).Path -like (Join-Path (Resolve-Path $SprintDir -ErrorAction SilentlyContinue).Path '*')
if ($backupInsideSprint) {
  Log "Sprint markdown sudah ke-sync raw (backup di dalam daily-sprints) -> zip dilewati"
} elseif (Test-Path $SprintDir) {
  Add-Type -AssemblyName System.IO.Compression
  $SprintZip = Join-Path $BackupRoot 'daily-sprints-latest.zip'
  if (Test-Path $SprintZip) { Remove-Item $SprintZip -Force }
  $n = 0
  $fs = [System.IO.File]::Create($SprintZip)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem $SprintDir -File | ForEach-Object {
      try {
        # buka shared-read (file di-lock bind-mount/Drive), stream langsung ke entry zip
        $src = [System.IO.File]::Open($_.FullName, 'Open', 'Read', 'ReadWrite')
        $entry = $zip.CreateEntry($_.Name)
        $es = $entry.Open()
        $src.CopyTo($es)
        $es.Dispose(); $src.Dispose()
        $n++
      } catch { Log "  skip (locked): $($_.Name)" }
    }
  } finally { $zip.Dispose(); $fs.Dispose() }
  Log "Sprint markdown OK ($n file -> daily-sprints-latest.zip)"
} else { Log "WARN: folder sprint tidak ada: $SprintDir" }

# 5) Retensi 7 hari: hapus file apapun yang lebih tua dari KeepDays.
#    File 'latest' selalu baru (ditimpa tiap run) jadi selalu lolos → tersisa 2 file.
#    File timestamped lama (versi sebelumnya) kebersihan otomatis setelah 7 hari.
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $BackupRoot -File -Recurse | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
  Log "Rotasi: hapus $($_.Name)"; Remove-Item $_.FullName -Force
}
# Hapus subfolder lama (db/, config/) bila sudah kosong
foreach ($sub in @('db','config')) {
  $p = Join-Path $BackupRoot $sub
  if ((Test-Path $p) -and -not (Get-ChildItem $p -Recurse -File)) { Remove-Item $p -Recurse -Force }
}

# 4) Upload ke Google Drive (rclone). sync = remote mirror lokal (termasuk rotasi).
if ([string]::IsNullOrWhiteSpace($RcloneRemote)) {
  Log "Cloud upload di-SKIP (ISL_RCLONE_REMOTE kosong)"
} elseif (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  Log "Cloud upload di-SKIP: rclone belum terinstall. Backup lokal tetap aman di $BackupRoot"
} else {
  Log "rclone sync $BackupRoot -> $RcloneRemote"
  rclone sync $BackupRoot $RcloneRemote --transfers 2 --checkers 4 2>&1 | ForEach-Object { Log "  $_" }
  if ($LASTEXITCODE -ne 0) { Log "WARN: rclone exit $LASTEXITCODE (backup lokal tetap ada)" }
  else { Log "Cloud upload OK -> $RcloneRemote" }
}

Log "Backup selesai. Lokal: $BackupRoot"
