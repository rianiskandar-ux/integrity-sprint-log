# =============================================================================
# ISL one-shot setup for a personal instance (Model B).
# Generates .env (auto creds path + random secrets), then builds & starts Docker.
#
# Run from the project root:   powershell -ExecutionPolicy Bypass -File scripts/setup-isl.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== ISL Setup (Model B — personal instance) ==" -ForegroundColor Cyan

# 1. Docker check
try { docker version --format '{{.Server.Version}}' | Out-Null }
catch { Write-Host "Docker tidak terdeteksi. Install Docker Desktop dulu, lalu jalankan ulang." -ForegroundColor Red; exit 1 }

# 2. .env guard
if (Test-Path ".env") {
  $ans = Read-Host ".env sudah ada. Timpa? (ketik 'yes' untuk timpa, lainnya batal)"
  if ($ans -ne 'yes') { Write-Host "Dibatalkan — .env yang ada dipertahankan." -ForegroundColor Yellow; exit 0 }
}

# 3. Detect Claude creds
$claudeDir  = Join-Path $env:USERPROFILE ".claude"
$claudeJson = Join-Path $env:USERPROFILE ".claude.json"
$claudeDirFwd  = $claudeDir  -replace '\\','/'
$claudeJsonFwd = $claudeJson -replace '\\','/'
$claudeMissing = $false
if (-not (Test-Path $claudeDir))  { Write-Host "PERINGATAN: folder $claudeDir belum ada." -ForegroundColor Yellow; $claudeMissing = $true }
# .claude.json is bind-mounted as a FILE; if it's missing Docker creates an empty
# DIRECTORY at that path and claude-cli breaks. Guard it explicitly.
if (-not (Test-Path $claudeJson)) { Write-Host "PERINGATAN: file $claudeJson belum ada (mount-nya per-file)." -ForegroundColor Yellow; $claudeMissing = $true }
if ($claudeMissing) {
  Write-Host "  AI Chat (claude-cli) butuh Claude Code sudah terinstall & login:" -ForegroundColor Yellow
  Write-Host "    npm install -g @anthropic-ai/claude-code ; claude   (ikuti login)" -ForegroundColor Yellow
  $go = Read-Host "  Lanjut setup tanpa AI Chat dulu? (ketik 'yes' untuk lanjut, lainnya batal)"
  if ($go -ne 'yes') { Write-Host "Dibatalkan. Login Claude dulu lalu jalankan ulang." -ForegroundColor Red; exit 0 }
}

# 4. Random secrets
function New-Key([int]$bytes = 32) {
  $b = New-Object 'System.Byte[]' $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString('x2') })
}
$encKey  = New-Key 32
$nextSec = New-Key 24

# 5. OP base URL prompt (default ke instance tim)
$opBase = Read-Host "OP_BASE_URL [default https://tokek.integrity-asia.com]"
if ([string]::IsNullOrWhiteSpace($opBase)) { $opBase = "https://tokek.integrity-asia.com" }

# 6. Write .env
$envText = @"
OP_BASE_URL=$opBase
OP_API_TOKEN=
OP_PROJECT_ID=integritys-websites
ISL_MULTIUSER=1
ISL_OP_USER_ID=0
CLAUDE_CREDS_DIR=$claudeDirFwd
CLAUDE_CONFIG_FILE=$claudeJsonFwd
ISL_ENCRYPTION_KEY=$encKey
NEXTAUTH_SECRET=$nextSec
POSTGRES_PASSWORD=isl-local-$((Get-Random -Maximum 99999))
ISL_ACCESS_PIN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_LOGIN_HINT=
GOOGLE_REDIRECT_URI=http://localhost:4891/api/auth/callback/google
AI_CHAT_TR_KEY=
AI_CHAT_TR_BASE=https://api.tokenrouter.com/v1
AI_CHAT_OM_KEY=
AI_CHAT_OM_BASE=https://api.openmodel.ai/v1
"@
# Write WITHOUT BOM (Set-Content -Encoding utf8 on PS 5.1 adds a BOM that breaks
# docker-compose parsing of the first variable).
[System.IO.File]::WriteAllText((Join-Path $root ".env"), $envText, (New-Object System.Text.UTF8Encoding $false))
Write-Host ".env dibuat (creds Claude: $claudeDirFwd, secret di-generate acak)." -ForegroundColor Green

# 7. Build & start
Write-Host "Build + start Docker (bisa beberapa menit pertama kali)..." -ForegroundColor Cyan
docker compose up -d --build

Write-Host ""
Write-Host "== Selesai ==" -ForegroundColor Green
Write-Host "Buka http://localhost:4891 → /login → masukkan OP API Token kamu." -ForegroundColor Green
Write-Host "Token: OpenProject -> My Account -> Access Tokens -> API." -ForegroundColor Green
