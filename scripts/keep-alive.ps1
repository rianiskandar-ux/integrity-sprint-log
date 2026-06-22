<#
  ISL Keep-Alive - cek ISL hidup; kalau mati -> restart + (opsional) notif Telegram.
  Dijadwalkan tiap 5 menit (lihat scripts/setup-keepalive-schedule.ps1).

  Env opsional (set untuk notif Telegram):
    ISL_TG_BOT_TOKEN, ISL_TG_CHAT_ID
#>

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path $PSScriptRoot -Parent
$AppUrl     = 'http://localhost:4891/'
$AppName    = 'integrity-sprint-log'
$DbName     = 'isl-postgres'
$LogFile    = Join-Path $ProjectDir 'keep-alive.log'

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Tee-Object -FilePath $LogFile -Append | Out-Null }

function Notify($m) {
  $tok = $env:ISL_TG_BOT_TOKEN; $chat = $env:ISL_TG_CHAT_ID
  if (-not $tok -or -not $chat) { return }
  try {
    Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$tok/sendMessage" `
      -Body @{ chat_id = $chat; text = "[ISL] $m" } -TimeoutSec 10 | Out-Null
  } catch {}
}

function ContainerRunning($name) {
  try { return (docker inspect -f '{{.State.Running}}' $name 2>$null) -eq 'true' } catch { return $false }
}

function AppResponds {
  try {
    $code = (Invoke-WebRequest -Uri $AppUrl -Method Head -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop).StatusCode
    return $code -ge 200 -and $code -lt 500
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ge 200 -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true }
    return $false
  }
}

$dbOk  = ContainerRunning $DbName
$appOk = (ContainerRunning $AppName) -and (AppResponds)

if ($dbOk -and $appOk) {
  Log "OK - ISL sehat."
  exit 0
}

Log "DOWN - db=$dbOk app=$appOk. Restarting..."
Notify "DOWN (db=$dbOk app=$appOk) - mencoba restart..."

try {
  Push-Location $ProjectDir
  docker compose up -d 2>&1 | ForEach-Object { Log "  $_" }
  Pop-Location
  Start-Sleep -Seconds 12
  $appOk2 = (ContainerRunning $AppName) -and (AppResponds)
  if ($appOk2) { Log "RECOVERED - ISL hidup lagi."; Notify "OK - ISL pulih." }
  else         { Log "MASIH DOWN setelah restart."; Notify "WARNING - ISL masih DOWN setelah restart, perlu cek manual." }
} catch {
  Log "ERROR restart: $_"; Notify "ERROR - gagal restart ISL: $_"
}
