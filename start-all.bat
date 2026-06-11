@echo off
start /min "" 9router
timeout /t 5 /nobreak >nul
start /min "" node "C:\Users\user199\ai-apps\daily-sprint-next\.next\standalone\server.js"
echo ISL + 9Router started. Buka http://localhost:3000
