param(
  [string]$ServerPath = (Join-Path $PSScriptRoot '..\local-ai\bin\llama-server.exe'),
  [string]$ModelPath = (Join-Path $PSScriptRoot '..\local-ai\qwen2.5-3b.gguf')
)

$ErrorActionPreference = 'Stop'
$server = (Resolve-Path -LiteralPath $ServerPath).Path
$model = (Resolve-Path -LiteralPath $ModelPath).Path
$healthUrl = 'http://127.0.0.1:8080/health'

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($health.status -eq 'ok') {
    Write-Output 'La IA local ya esta lista en http://127.0.0.1:8080.'
    exit 0
  }
} catch {
  # The server is not running yet.
}

$stdout = Join-Path $env:TEMP 'cca-llama-server-out.log'
$stderr = Join-Path $env:TEMP 'cca-llama-server-error.log'
$arguments = @(
  '-m', ('"' + $model + '"'),
  '--host', '127.0.0.1', '--port', '8080',
  '-c', '2048', '-np', '1', '-t', '4', '-tb', '4',
  '--alias', 'qwen2.5:3b'
)
$process = Start-Process -FilePath $server -WorkingDirectory (Split-Path $server) `
  -ArgumentList $arguments -UseNewEnvironment -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

for ($attempt = 0; $attempt -lt 60; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    throw "llama-server termino al iniciar. Revisa $stderr"
  }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.status -eq 'ok') {
      Write-Output "IA local lista. Modelo: qwen2.5:3b. Proceso: $($process.Id)."
      exit 0
    }
  } catch {
    # Loading can temporarily return HTTP 503.
  }
}

throw "El modelo no termino de cargar. Revisa $stderr"
