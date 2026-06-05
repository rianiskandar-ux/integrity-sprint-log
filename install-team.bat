@echo off
setlocal enabledelayedexpansion
title ISL - Installer Tim

echo ============================================
echo   Integrity Sprint Log - Team Installer
echo ============================================
echo.

:: ── 1. Cek Node.js ──────────────────────────────────────────────────
echo [1/4] Cek Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js tidak ditemukan. Mencoba install via winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Gagal install Node.js otomatis.
        echo Download manual: https://nodejs.org/en/download
        pause
        exit /b 1
    )
    :: Refresh PATH
    call refreshenv >nul 2>&1
    for /f "tokens=*" %%i in ('where node 2^>nul') do set NODEEXE=%%i
    if "!NODEEXE!"=="" (
        echo Node.js terinstall. Tutup CMD ini dan jalankan ulang install-team.bat
        pause
        exit /b 0
    )
)
for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo [OK] Node.js !NODEVER! ditemukan

:: ── 2. Cek folder app ───────────────────────────────────────────────
echo.
echo [2/4] Cek folder app...
set APPDIR=%~dp0
echo     Folder: %APPDIR%

if not exist "%APPDIR%package.json" (
    echo [ERROR] package.json tidak ditemukan. Pastikan script ini ada di folder app.
    pause
    exit /b 1
)
echo [OK] Folder app valid

:: ── 3. Install dependencies ─────────────────────────────────────────
echo.
echo [3/4] Install dependencies (npm install)...
cd /d "%APPDIR%"
call npm install --prefer-offline 2>&1
if %errorlevel% neq 0 (
    echo Mencoba dengan registry default...
    call npm install 2>&1
)
echo [OK] Dependencies siap

:: ── 4. Cek .env.local ───────────────────────────────────────────────
echo.
echo [4/4] Cek konfigurasi...
if not exist "%APPDIR%.env.local" (
    echo [PERHATIAN] File .env.local tidak ditemukan!
    echo Minta file ini dari Rian atau admin tim.
    echo.
    echo Buat file .env.local dengan isi:
    echo   OP_BASE_URL=https://tokek.integrity-asia.com
    echo   OP_API_TOKEN=^<server token dari Rian^>
    echo   GOOGLE_CLIENT_ID=^<dari Google Console^>
    echo   GOOGLE_CLIENT_SECRET=^<dari Google Console^>
    echo   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
    echo.
    echo Setelah .env.local ada, jalankan: run-server.bat
    pause
    exit /b 0
)
echo [OK] .env.local ditemukan

:: ── Build ────────────────────────────────────────────────────────────
echo.
echo Building app (butuh 1-2 menit)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build gagal. Hubungi Rian.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   INSTALASI SELESAI!
echo ============================================
echo.
echo Jalankan app: klik 2x file  run-server.bat
echo Lalu buka browser: http://localhost:3000
echo.
pause
