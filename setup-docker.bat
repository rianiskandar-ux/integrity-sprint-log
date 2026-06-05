@echo off
title ISL - Docker Setup
echo ============================================
echo   Integrity Sprint Log - Docker Setup
echo ============================================
echo.

:: Check Docker is installed and running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker tidak ditemukan atau tidak berjalan.
    echo   1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/
    echo   2. Jalankan Docker Desktop
    echo   3. Ulangi script ini
    pause
    exit /b 1
)
echo [OK] Docker berjalan.

:: Create .env.local if not exists
if not exist ".env.local" (
    echo.
    echo [INFO] Membuat .env.local dari template...
    copy ".env.local.example" ".env.local" >nul 2>&1
    if %errorlevel% neq 0 (
        echo [INFO] Template tidak ditemukan, membuat .env.local kosong...
        (
            echo OP_BASE_URL=https://tokek.integrity-asia.com
            echo OP_PROJECT_ID=integritys-websites
            echo OP_API_TOKEN=
            echo NEXTAUTH_SECRET=isl-local-secret-2026
            echo GOOGLE_CLIENT_ID=
            echo GOOGLE_CLIENT_SECRET=
        ) > .env.local
    )
    echo [OK] .env.local dibuat. Edit jika perlu.
) else (
    echo [OK] .env.local sudah ada.
)

:: Load env vars for docker-compose
for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
    if not "%%a"=="" if not "%%b"=="" set "%%a=%%b"
)

echo.
echo [INFO] Building Docker image (pertama kali ~3-5 menit)...
docker compose build
if %errorlevel% neq 0 (
    echo [ERROR] Build gagal!
    pause
    exit /b 1
)
echo [OK] Build selesai.

echo.
echo [INFO] Menjalankan container...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERROR] Container gagal start!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   ISL berjalan di: http://localhost:3000
echo ============================================
echo.
echo   Untuk stop:    docker compose down
echo   Untuk logs:    docker compose logs -f
echo   Untuk update:  docker compose build ^&^& docker compose up -d
echo.
pause
