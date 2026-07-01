@echo off
REM Quick Docker rebuild for ISL — uses CACHE_BUST to force source re-copy
REM without a full --no-cache (keeps node_modules layer cached → faster).
REM Usage: docker-rebuild.bat

cd /d C:\Users\user199\ai-apps\daily-sprint-next

echo [ISL] Computing cache bust...
for /f %%i in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set BUST=%%i
echo [ISL] Cache bust: %BUST%

echo [ISL] Building Docker image...
docker compose build --build-arg "CACHE_BUST=%BUST%" integrity-sprint-log
if %errorlevel% neq 0 (
    echo [ISL] Build FAILED. Try: docker compose build --no-cache integrity-sprint-log
    pause
    exit /b 1
)

echo [ISL] Restarting container...
docker compose up -d integrity-sprint-log

echo [ISL] Done! Live at http://localhost:4891 and http://daily-sprint.test
echo [ISL] Wait ~3s for Next.js to start, then Ctrl+Shift+R in browser.
