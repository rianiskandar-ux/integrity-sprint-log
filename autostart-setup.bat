@echo off
echo Setting up ISL + 9Router auto-start on Windows login...

set ISL_PATH=C:\Users\user199\ai-apps\daily-sprint-next\.next\standalone

:: === 9Router — hidden window, auto-start on logon ===
schtasks /delete /tn "9Router" /f >nul 2>&1
schtasks /create /tn "9Router" ^
  /tr "cmd /c start /min \"\" 9router" ^
  /sc onlogon /ru "%USERNAME%" /delay 0000:05 /f >nul
if %errorlevel%==0 (echo [OK] 9Router) else (echo [FAIL] 9Router)

:: === ISL Server — hidden window, auto-start on logon ===
schtasks /delete /tn "ISL Server" /f >nul 2>&1
schtasks /create /tn "ISL Server" ^
  /tr "cmd /c start /min \"\" node \"%ISL_PATH%\server.js\"" ^
  /sc onlogon /ru "%USERNAME%" /delay 0000:10 /f >nul
if %errorlevel%==0 (echo [OK] ISL Server) else (echo [FAIL] ISL Server)

echo.
echo Auto-start configured! Next login kedua service jalan otomatis.
echo Untuk test sekarang tanpa restart, jalankan start-all.bat
pause
