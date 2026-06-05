@echo off
title ISL - Update
echo ============================================
echo   Integrity Sprint Log - Update
echo ============================================
echo.

:: Check Docker running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker tidak berjalan. Buka Docker Desktop dulu, lalu ulangi.
    pause
    exit /b 1
)

:: Pull latest code
echo [1/3] Mengambil update terbaru...
git pull
if %errorlevel% neq 0 (
    echo [ERROR] git pull gagal. Pastikan ada koneksi internet.
    pause
    exit /b 1
)

:: Rebuild image
echo.
echo [2/3] Build ulang aplikasi (~2-3 menit)...
docker compose build
if %errorlevel% neq 0 (
    echo [ERROR] Build gagal!
    pause
    exit /b 1
)

:: Restart container (data volumes aman, tidak terhapus)
echo.
echo [3/3] Restart aplikasi...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERROR] Gagal restart!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Update selesai!
echo   Buka: http://localhost:3000
echo ============================================
echo.
echo   Data kamu (sprint, GCal, cache) tidak berubah.
echo.
pause
