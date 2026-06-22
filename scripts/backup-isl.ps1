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
    ISL_BACKUP_KEEP     hari retensi (default: 30)
#>

$ErrorActionPreference = 'Stop'

$BackupRoot   = if ($env:ISL_BACKUP_DIR)    { $env:ISL_BACKUP_DIR }    else { 'C:\Users\user199\ai-apps\backups' }
$RcloneRemote = if ($null -ne $env:ISL_RCLONE_REMOTE) { $env:ISL_RCLONE_REMOTE } else { '' }  # '' = pakai Drive Desktop
$KeepDays     = if ($env:ISL_BACKUP_KEEP)   { [int]$env:ISL_BACKUP_KEEP } else { 30 }

$PgContainer  = 'isl-postgres'
$AppContainer = 'integrity-sprint-log'
$Stamp        = Get-Date -Format 'yyyyMMdd-HHmmss'

$DbDir  = Join-Path $BackupRoot 'db'
$CfgDir = Join-Path $BackupRoot 'config'
New-Item -ItemType Directory -Force -Path $DbDir, $CfgDir | Out-Null

function Log($m) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $m" }

# 1) Postgres dump (gzip di dalam container → docker cp keluar, hindari korup encoding)
$DbOut = Join-Path $DbDir "isl-$Stamp.sql.gz"
Log "Dump Postgres -> $DbOut"
docker exec $PgContainer sh -c "pg_dump -U isl -d isl | gzip -c > /tmp/isl-backup.sql.gz"
if ($LASTEXITCODE -ne 0) { throw "pg_dump gagal (exit $LASTEXITCODE)" }
docker cp "${PgContainer}:/tmp/isl-backup.sql.gz" $DbOut
docker exec $PgContainer rm -f /tmp/isl-backup.sql.gz
$sizeKb = [math]::Round((Get-Item $DbOut).Length / 1KB, 1)
Log "DB dump OK ($sizeKb KB)"

# 2) Config (sudah terenkripsi at-rest)
try {
  docker cp "${AppContainer}:/app/data/user-config.json" (Join-Path $CfgDir "user-config-$Stamp.json")
  Log "Config dump OK"
} catch { Log "WARN: gagal copy config: $_" }

# 3) Rotasi lokal (hapus > KeepDays hari)
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $DbDir, $CfgDir -File | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
  Log "Rotasi: hapus $($_.Name)"; Remove-Item $_.FullName -Force
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
