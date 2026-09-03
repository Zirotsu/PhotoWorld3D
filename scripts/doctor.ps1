$ErrorActionPreference = "Continue"
Write-Host "=== PhotoWorld 3D Doctor ===" -ForegroundColor Cyan

function Check-Cmd($name, $args) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Host "[FALTA] $name" -ForegroundColor Red
    return $false
  }
  Write-Host "[OK] $name -> $($cmd.Source)" -ForegroundColor Green
  if ($args) { & $name @args }
  return $true
}

$pythonOk = Check-Cmd "python" @("--version")
$nodeOk = Check-Cmd "node" @("--version")
$npmOk = Check-Cmd "npm" @("--version")
$gitOk = Check-Cmd "git" @("--version")
$nvidiaOk = Check-Cmd "nvidia-smi" @("--query-gpu=name,memory.total,driver_version", "--format=csv,noheader")

$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root "engine\.venv\Scripts\python.exe"
if (Test-Path $Py) {
  Write-Host "`nMotor Python del proyecto:" -ForegroundColor Cyan
  & $Py -c "import torch; print('Torch', torch.__version__); print('CUDA', torch.cuda.is_available()); print('GPU', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')"
} else {
  Write-Host "`n[INFO] El entorno engine/.venv todavía no existe. Ejecuta scripts/setup-windows.ps1" -ForegroundColor Yellow
}
