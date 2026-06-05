# OP Cache auto-refresh — dipanggil Task Scheduler setiap hari 09:30
$log = "C:\Users\user199\ai-apps\daily-sprint-next\cache-refresh.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    $body = '{"userId":8,"projects":["integritys-websites","know-your-vendor-kyv"]}'
    $res = Invoke-RestMethod "http://localhost:3000/api/op/cache" -Method POST `
        -ContentType "application/json" -Body $body -TimeoutSec 30
    Add-Content $log "$timestamp — Cache refreshed: $($res.myOpenTasks.Count) tasks, $($res.userStories.Count) stories"
} catch {
    Add-Content $log "$timestamp — Cache refresh FAILED: $($_.Exception.Message)"
}
