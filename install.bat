@echo off
setlocal enabledelayedexpansion
title ISL - Smart Installer

echo.
echo  ============================================================
echo    Integrity Sprint Log  ^|  Smart Installer
echo  ============================================================
echo.

set APPDIR=%~dp0
cd /d "%APPDIR%"

:: ── Cek .env.local ───────────────────────────────────────────────────
if not exist ".env.local" (
    echo [INFO] .env.local tidak ditemukan. Membuat dari template...
    if exist ".env.local.example" (
        copy ".env.local.example" ".env.local" >nul
    ) else (
        (
            echo OP_BASE_URL=https://tokek.integrity-asia.com
            echo OP_PROJECT_ID=integritys-websites
            echo OP_API_TOKEN=
            echo CACHE_DATA_DIR=
            echo ANTHROPIC_API_KEY=
            echo NEXTAUTH_SECRET=isl-local-secret-2026
        ) > .env.local
    )
    echo [OK] .env.local dibuat. Isi nilai wajib setelah install, atau lewati via Setup Wizard.
)

:: ── PILIH JALUR: Docker atau Node.js ─────────────────────────────────
echo [*] Mendeteksi environment...
echo.

:: Cek Docker
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo [DETECT] Docker Desktop ditemukan dan berjalan.
    echo [*] Menggunakan jalur Docker...
    echo.
    goto :docker_path
)

:: Cek apakah Docker installed tapi tidak jalan
docker -v >nul 2>&1
if %errorlevel% equ 0 (
    echo [DETECT] Docker terinstall tapi tidak berjalan.
    echo   Pilih jalur install:
    echo   [1] Jalankan Docker Desktop dulu lalu install via Docker (direkomendasikan^)
    echo   [2] Pakai Node.js saja (tanpa Docker^)
    echo.
    set /p CHOICE="Pilihan (1/2): "
    if "!CHOICE!"=="1" (
        echo Buka Docker Desktop, tunggu sampai hijau, lalu jalankan install.bat lagi.
        pause
        exit /b 0
    )
    goto :node_path
)

:: Tidak ada Docker sama sekali
echo [DETECT] Docker tidak ditemukan. Mencoba Node.js...
echo.
goto :node_path

:: ═════════════════════════════════════════════════════════════════════
:docker_path
echo  --- Jalur Docker ---
echo.

echo [1/3] Build Docker image (pertama kali ~3-5 menit)...
docker compose build
if %errorlevel% neq 0 (
    echo [ERROR] Build gagal!
    echo   Coba: docker compose logs
    pause
    exit /b 1
)
echo [OK] Build selesai.

echo.
echo [2/3] Start container...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERROR] Container gagal start!
    pause
    exit /b 1
)
echo [OK] Container berjalan.

echo.
echo [3/3] Menunggu app siap...
timeout /t 3 /nobreak >nul
goto :open_browser

:: ═════════════════════════════════════════════════════════════════════
:node_path
echo  --- Jalur Node.js ---
echo.

:: Cek Node.js installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Node.js tidak ditemukan. Mencoba install otomatis via winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Gagal install Node.js otomatis.
        echo Download manual: https://nodejs.org/en/download
        echo Setelah install Node.js, jalankan install.bat lagi.
        pause
        exit /b 1
    )
    echo [OK] Node.js terinstall. Restart terminal mungkin diperlukan.
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODEVER=%%v
echo [OK] Node.js !NODEVER!

echo.
echo [1/3] Install dependencies...
call npm install --prefer-offline 2>nul
if %errorlevel% neq 0 (
    call npm install
)
echo [OK] Dependencies siap.

echo.
echo [2/3] Build app (1-2 menit)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build gagal.
    pause
    exit /b 1
)
echo [OK] Build selesai.

echo.
echo [3/3] Menjalankan server...
start "ISL Server" /min node .next\standalone\server.js
timeout /t 3 /nobreak >nul
goto :open_browser

:: ═════════════════════════════════════════════════════════════════════
:open_browser
echo.
echo  ============================================================
echo    ISL siap!
echo    Membuka browser: http://localhost:3000/setup
echo  ============================================================
echo.
echo  Setup Wizard akan muncul untuk mengisi konfigurasi awal.
echo  Setelah setup, app akan otomatis lanjut ke Dashboard.
echo.
start "" "http://localhost:3000/setup"
echo  Tips:
echo    - Untuk jalan lagi besok: run-server.bat  (Node^)
echo                              docker compose up -d  (Docker^)
echo    - Untuk update app: update.bat
echo.
pause
