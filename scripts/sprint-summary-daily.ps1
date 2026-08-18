# ISL sprint summary auto-save - jalan sekali sehari via Scheduled Task "ISL Sprint Summary".
# Cek sprint yang baru selesai, generate + simpan AI recap kalau belum ada (idempotent -
# aman jalan tiap hari, cuma benar-benar kerja di hari pertama setelah sprint ganti).
# NOTE: ASCII only - PS 5.1 baca file non-BOM sebagai ANSI.

$LogFile = "C:\Users\user199\ai-apps\daily-sprint-next\sprint-summary.log"
$KafiKey = $env:KAFI_API_KEY

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    try {
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 200KB) {
            Get-Content $LogFile -Tail 100 | Set-Content $LogFile -Encoding utf8
        }
        $line | Out-File -FilePath $LogFile -Append -Encoding utf8
    } catch {}
    Write-Host $line
}

if ([string]::IsNullOrWhiteSpace($KafiKey)) {
    Log "KAFI_API_KEY tidak ada di env - skip"
    exit 0
}

try {
    $res = Invoke-RestMethod "http://localhost:4891/api/internal/sprint-summary?uid=1" -Method POST -Headers @{ "x-kafi-key" = $KafiKey } -TimeoutSec 90
    if ($res.saved) {
        Log "saved: $($res.saved)"
    } elseif ($res.skipped) {
        Log "skip: $($res.skipped)"
    } else {
        Log "unexpected response: $($res | ConvertTo-Json -Compress)"
    }
} catch {
    Log "FAILED: $($_.Exception.Message)"
}
