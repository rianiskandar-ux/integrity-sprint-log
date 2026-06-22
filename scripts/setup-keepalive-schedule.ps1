<#
  Daftarkan ISL Keep-Alive sebagai Scheduled Task (tiap 5 menit).
  Jalankan SEKALI:
    powershell -ExecutionPolicy Bypass -File scripts\setup-keepalive-schedule.ps1

  Hapus: Unregister-ScheduledTask -TaskName "ISL Keep-Alive" -Confirm:$false
#>

$ErrorActionPreference = 'Stop'
$TaskName   = 'ISL Keep-Alive'
$ScriptPath = Join-Path $PSScriptRoot 'keep-alive.ps1'
if (-not (Test-Path $ScriptPath)) { throw "keep-alive.ps1 tidak ditemukan di $ScriptPath" }

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
# Tiap 5 menit, selamanya
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

$logPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'keep-alive.log'
Write-Host "OK: Task '$TaskName' terdaftar - cek ISL tiap 5 menit."
Write-Host "Test sekarang: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Log: $logPath"
