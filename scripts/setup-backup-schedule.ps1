<#
  Daftarkan backup ISL sebagai Windows Scheduled Task (tiap malam 23:00).
  Jalankan SEKALI sebagai Administrator:
    powershell -ExecutionPolicy Bypass -File scripts\setup-backup-schedule.ps1

  Hapus task:  Unregister-ScheduledTask -TaskName "ISL Nightly Backup" -Confirm:$false
#>

$ErrorActionPreference = 'Stop'

$TaskName   = 'ISL Nightly Backup'
$ScriptPath = Join-Path $PSScriptRoot 'backup-isl.ps1'
$RunTime    = '17:30'   # 17:30 WIB

if (-not (Test-Path $ScriptPath)) { throw "backup-isl.ps1 tidak ditemukan di $ScriptPath" }

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At $RunTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -WakeToRun `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
# -WakeToRun  : bangunkan laptop dari sleep untuk backup (lalu balik sleep sesuai power plan)
# -StartWhenAvailable : kalau laptop mati/terlewat, jalan otomatis pas nyala lagi
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "OK: Task '$TaskName' terdaftar, jalan tiap hari $RunTime."
Write-Host "Cek: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Test sekarang: Start-ScheduledTask -TaskName '$TaskName'"
