$ErrorActionPreference = 'Stop'
$server = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\local-ai\bin\llama-server.exe')).Path
$processes = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $server })

if ($processes.Count -eq 0) {
  Write-Output 'La IA local ya esta detenida.'
  exit 0
}

$processes | Stop-Process
Write-Output 'IA local detenida.'
