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

# Jalanin proses eksternal TANPA console window sama sekali (CreateNoWindow).
# -WindowStyle Hidden di level Scheduled Task cuma nyembunyiin window PowerShell-nya
# sendiri - child process native (docker.exe dkk) yang dipanggil langsung tetap bisa
# munculin console sendiri. Ini penyebab popup cmd kosong yang kelihatan sekilas.
function Invoke-Hidden($FilePath, $Arguments, $WorkDir) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    $p = [System.Diagnostics.Process]::Start($psi)
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return [PSCustomObject]@{ ExitCode = $p.ExitCode; StdOut = $stdout; StdErr = $stderr }
}

# 1. Docker engine hidup?
$infoResult = Invoke-Hidden "docker" "info"
if ($infoResult.ExitCode -ne 0) {
    Log "docker engine mati - coba start Docker Desktop"
    $dd = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) { Start-Process $dd }
    exit 0   # cek lagi di run berikutnya (5 menit)
}

# 2. Container jalan?
$psResult = Invoke-Hidden "docker" 'ps --format "{{.Names}}"'
$running = $psResult.StdOut -split "`r?`n" | Where-Object { $_ }
$needUp = $false
foreach ($name in @("isl-postgres", "integrity-sprint-log")) {
    if ($running -notcontains $name) { Log "container $name MATI"; $needUp = $true }
}
if ($needUp) {
    Log "compose up -d ..."
    $upResult = Invoke-Hidden "docker" "compose up -d" $ComposeDir
    Log "compose up selesai (exit $($upResult.ExitCode))"
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
    $restartResult = Invoke-Hidden "docker" "restart integrity-sprint-log"
    Log "restart selesai (exit $($restartResult.ExitCode))"
}
