@echo off
title ISL - Integrity Sprint Log
echo ============================================
echo   Integrity Sprint Log - Starting...
echo ============================================
echo.

cd /d "%~dp0"

:: Cek build ada
if not exist ".next" (
    echo [ERROR] App belum di-build. Jalankan install-team.bat dulu!
    pause
    exit /b 1
)

:: Cek .env.local
if not exist ".env.local" (
    echo [ERROR] File .env.local tidak ditemukan!
    pause
    exit /b 1
)

echo App berjalan di: http://localhost:3000
echo Tekan Ctrl+C untuk stop.
echo.

:LOOP
npm run start
echo.
echo [Server berhenti. Restart otomatis dalam 3 detik... Ctrl+C untuk stop]
timeout /t 3 /nobreak >nul
goto LOOP
