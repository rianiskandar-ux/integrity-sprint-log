# ISL watchdog - jalan tiap 5 menit via Scheduled Task "ISL Watchdog".
# Cek: docker engine -> container postgres + ISL -> HTTP :4891.
# Aksi: compose up kalau container mati, docker restart kalau HTTP hang.
# NOTE: ASCII only - PS 5.1 baca file non-BOM sebagai ANSI.

$ComposeDir = "C:\Users\user199\ai-apps\daily-sprint-next"
$LogFile    = "C:\Users\user199\ai-apps\backups\isl\watchdog.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    try {
        # Cap 500KB - truncate ke 100 baris terakhir kalau kegedean
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 500KB) {
            Get-Content $LogFile -Tail 100 | Set-Content $LogFile -Encoding utf8
        }
        $line | Out-File -FilePath $LogFile -Append -Encoding utf8
    } catch {}
    Write-Host $line
}

# 1. Docker engine hidup?
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Log "docker engine mati - coba start Docker Desktop"
    $dd = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) { Start-Process $dd }
    exit 0   # cek lagi di run berikutnya (5 menit)
}

# 2. Container jalan?
$running = docker ps --format "{{.Names}}"
$needUp = $false
foreach ($name in @("isl-postgres", "integrity-sprint-log")) {
    if ($running -notcontains $name) { Log "container $name MATI"; $needUp = $true }
}
if ($needUp) {
    Log "compose up -d ..."
    Set-Location $ComposeDir
    docker compose up -d 2>&1 | Out-Null
    Log "compose up selesai (exit $LASTEXITCODE)"
    exit 0
}

# 3. HTTP responsive? (container jalan tapi app hang)
# Key dibaca dari env (User-env KAFI_API_KEY), BUKAN hardcoded — dulu hardcoded
# 'kafi-bridge-2026' yang sudah tidak cocok setelah key dirotasi, jadi kalau
# task ini aktif dia bakal 401 -> kira ISL mati -> restart container tiap 5
# menit (false-positive). Kalau env kosong, skip cek HTTP (jangan restart buta).
$healthKey = $env:KAFI_API_KEY
if ([string]::IsNullOrWhiteSpace($healthKey)) {
    Log "KAFI_API_KEY tidak ada di env - skip cek HTTP (hindari false-restart)"
    exit 0
}
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4891/api/internal/health?key=$healthKey" -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    # Sehat - tidak perlu log (biar file tidak penuh entry rutin)
} catch {
    Log "ISL :4891 tidak respons ($($_.Exception.Message)) - restart container"
    docker restart integrity-sprint-log 2>&1 | Out-Null
    Log "restart selesai (exit $LASTEXITCODE)"
}
