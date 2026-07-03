# ISL nightly backup - pg_dump + data dir (user-config, op-cache), rotasi 30 hari.
# Dijalankan oleh Scheduled Task "ISL DB Backup" (daily 12:30, saat laptop biasanya nyala).
# Restore DB:   Get-Content <file.sql> | docker exec -i isl-postgres psql -U isl -d isl
# Restore data: type <file.tgz> | docker exec -i integrity-sprint-log tar xzf - -C /app
# NOTE: ASCII only - PS 5.1 baca file non-BOM sebagai ANSI, karakter unicode merusak parser.

$ErrorActionPreference = "Stop"
$BackupRoot = "C:\Users\user199\ai-apps\backups\isl"
$Stamp      = Get-Date -Format "yyyy-MM-dd_HHmm"
$LogFile    = Join-Path $BackupRoot "backup.log"

New-Item -ItemType Directory -Force $BackupRoot | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    # Out-File + try/catch: Add-Content kadang gagal "Stream was not readable"
    # kalau handle lama nyangkut (AV scan / proses ke-kill). Log gagal != backup gagal.
    try { $line | Out-File -FilePath $LogFile -Append -Encoding utf8 } catch {}
    Write-Host $line
}

try {
    # 1. pg_dump - plain SQL supaya restore gampang tanpa tooling khusus
    $SqlFile = Join-Path $BackupRoot "isl-db_$Stamp.sql"
    docker exec isl-postgres pg_dump -U isl -d isl --no-owner | Out-File -FilePath $SqlFile -Encoding utf8
    $sizeKb = [math]::Round((Get-Item $SqlFile).Length / 1KB)
    if ($sizeKb -lt 5) { throw "Dump mencurigakan kecil ($sizeKb KB) - kemungkinan container mati" }
    Log "pg_dump OK: $SqlFile ($sizeKb KB)"

    # 2. /app/data (user-config.json terenkripsi, op-cache, op-mode)
    #    tar di DALAM container, stream ke host via cmd (PS merusak binary stdout).
    #    Tanpa temp file Windows = bebas race dengan Defender. logs/ di-exclude.
    $DataTgz = Join-Path $BackupRoot "isl-data_$Stamp.tgz"
    cmd /c "docker exec integrity-sprint-log tar czf - -C /app --exclude=data/logs data > `"$DataTgz`""
    if ($LASTEXITCODE -ne 0 -or (Get-Item $DataTgz).Length -lt 200) { throw "tar data dir gagal (exit $LASTEXITCODE)" }
    Log "data dir OK: $DataTgz ($([math]::Round((Get-Item $DataTgz).Length / 1KB)) KB)"
    Log "data dir OK: $DataZip"

    # 3. Offsite copy ke Google Drive (sync otomatis ke cloud oleh Drive for Desktop).
    #    Best-effort: kalau Drive tidak mounted, backup lokal tetap sukses.
    $DriveDir = "G:\My Drive\ISL-Backups"
    try {
        New-Item -ItemType Directory -Force $DriveDir | Out-Null
        Copy-Item $SqlFile  $DriveDir -Force
        Copy-Item $DataTgz $DriveDir -Force
        Get-ChildItem $DriveDir -File | Where-Object {
            $_.Name -match '^isl-(db|data)_' -and $_.LastWriteTime -lt (Get-Date).AddDays(-30)
        } | Remove-Item -Force
        Log "offsite OK: $DriveDir"
    } catch {
        Log "offsite SKIP: $($_.Exception.Message)"
    }

    # 4. Rotasi - hapus backup lebih tua dari 30 hari
    $removed = 0
    Get-ChildItem $BackupRoot -File | Where-Object {
        $_.Name -match '^isl-(db|data)_' -and $_.Extension -in '.sql','.tgz','.zip' -and $_.LastWriteTime -lt (Get-Date).AddDays(-30)
    } | ForEach-Object { Remove-Item $_.FullName -Force; $removed++ }
    if ($removed -gt 0) { Log "rotasi: $removed file lama dihapus" }

    Log "BACKUP SELESAI"
} catch {
    Log "BACKUP GAGAL: $($_.Exception.Message)"
    exit 1
}
