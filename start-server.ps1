$appDir = "C:\Users\user199\ai-apps\daily-sprint-next"
Write-Host "ISL Server — auto-restart enabled. Ctrl+C to stop."
while ($true) {
    Write-Host "[$(Get-Date -f 'HH:mm:ss')] Starting Next.js..."
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start" -WorkingDirectory $appDir -PassThru -WindowStyle Minimized
    $proc.WaitForExit()
    Write-Host "[$(Get-Date -f 'HH:mm:ss')] Server stopped (exit $($proc.ExitCode)). Restarting in 3s..."
    Start-Sleep 3
}
