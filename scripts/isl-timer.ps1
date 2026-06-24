# ISL work timer from the terminal — measure actual time even when you work
# outside ISL (terminal, Kiro, editor). Tool-agnostic: just start when you begin,
# stop when done.
#
# Usage (from the project folder, or set $env:ISL_DIR):
#   powershell -File scripts/isl-timer.ps1 start "Fix login bug"
#   powershell -File scripts/isl-timer.ps1 stop
#   powershell -File scripts/isl-timer.ps1 status
#
# Tip: add a PowerShell function so you can type `isl start "x"` / `isl stop`:
#   function isl { powershell -File "C:\path\to\integrity-sprint-log\scripts\isl-timer.ps1" @args }

param(
  [Parameter(Position = 0)][ValidateSet('start', 'stop', 'status')] [string]$Action = 'status',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]]$TitleParts
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url  = if ($env:ISL_URL) { $env:ISL_URL } else { 'http://localhost:4891' }

# Read the local timer key from .env (ISL_TIMER_KEY, fallback ISL_ENCRYPTION_KEY)
$key = ''
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*ISL_TIMER_KEY\s*=\s*(.+)$' -and $Matches[1].Trim()) { $key = $Matches[1].Trim() }
  }
  if (-not $key) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*ISL_ENCRYPTION_KEY\s*=\s*(.+)$') { $key = $Matches[1].Trim() }
    }
  }
}
if (-not $key) { Write-Host "Tidak nemu ISL_TIMER_KEY / ISL_ENCRYPTION_KEY di .env" -ForegroundColor Red; exit 1 }

$headers = @{ 'x-isl-timer-key' = $key; 'Content-Type' = 'application/json' }

try {
  if ($Action -eq 'status') {
    $r = Invoke-RestMethod -Uri "$url/api/timer" -Headers $headers -Method Get
    if ($r.timer) {
      $since = [DateTime]::Parse($r.timer.startedAt)
      $mins  = [int]([DateTime]::UtcNow - $since.ToUniversalTime()).TotalMinutes
      Write-Host ("⏱ Lagi ngerjain: {0}  ({1} menit)" -f $r.timer.taskTitle, $mins) -ForegroundColor Cyan
    } else { Write-Host "Tidak ada timer jalan." -ForegroundColor Gray }
  }
  elseif ($Action -eq 'start') {
    $title = if ($TitleParts) { $TitleParts -join ' ' } else { 'Work' }
    $body  = @{ action = 'start'; taskTitle = $title } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$url/api/timer" -Headers $headers -Method Post -Body $body
    Write-Host ("▶ Timer mulai: {0}" -f $r.timer.taskTitle) -ForegroundColor Green
  }
  elseif ($Action -eq 'stop') {
    $body = @{ action = 'stop' } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$url/api/timer" -Headers $headers -Method Post -Body $body
    if ($r.elapsedMins) { Write-Host ("⏹ Stop — {0} menit tercatat." -f $r.elapsedMins) -ForegroundColor Yellow }
    else { Write-Host "Tidak ada timer yang jalan." -ForegroundColor Gray }
  }
} catch {
  Write-Host "Gagal konek ke ISL ($url). Pastikan ISL jalan & kamu sudah login sekali di browser, atau key benar." -ForegroundColor Red
  exit 1
}
