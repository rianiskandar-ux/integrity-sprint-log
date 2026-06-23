<#
  Buka port ISL (4891) di Windows Firewall biar tim di LAN bisa akses.
  Jalankan SEKALI sebagai Administrator:
    powershell -ExecutionPolicy Bypass -File scripts\open-lan-port.ps1

  Hapus: Remove-NetFirewallRule -DisplayName "ISL Port 4891"
#>

$ErrorActionPreference = 'Stop'
$Name = 'ISL Port 4891'
$Port = 4891

if (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue) {
  Write-Host "Rule '$Name' sudah ada."
} else {
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -LocalPort $Port `
    -Protocol TCP -Action Allow -Profile Any | Out-Null
  Write-Host "OK: port $Port dibuka untuk LAN."
}

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' -and $_.IPAddress -notlike '172.*' }
Write-Host "`nTim akses ISL via salah satu URL ini (jaringan kantor sama):"
foreach ($ip in $ips) { Write-Host "  http://$($ip.IPAddress):$Port   [$($ip.InterfaceAlias)]" }
