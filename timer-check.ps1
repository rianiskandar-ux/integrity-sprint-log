$f = "C:\Users\user199\ai-apps\daily-sprint-next\timer.json"
if (-not (Test-Path $f)) { exit 0 }

try {
    $t = Get-Content $f -Raw -Encoding utf8 | ConvertFrom-Json
    $elapsed = [int]((Get-Date) - [DateTime]::Parse($t.startTime)).TotalMinutes
    $threshold = [int]$t.estimateMinutes - 10

    if ($elapsed -ge $threshold) {
        $remaining = [int]$t.estimateMinutes - $elapsed
        $msg = "TASK TIMER WARNING: $elapsed menit sudah berlalu dari estimasi $($t.estimateMinutes) menit untuk task '$($t.taskTitle)'. Tersisa ~$remaining menit. WRAP UP sekarang - ringkas apa yang sudah dikerjakan, apa yang pending, lalu stop."
        $output = [ordered]@{
            hookSpecificOutput = [ordered]@{
                hookEventName     = "UserPromptSubmit"
                additionalContext = $msg
            }
        }
        $output | ConvertTo-Json -Compress
    }
} catch {
    exit 0
}
