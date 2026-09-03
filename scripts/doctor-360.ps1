$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root "engine"
$Repo = Join-Path $Engine "vendor\stable-fast-3d"
$Py = Join-Path $Engine ".venv-sf3d\Scripts\python.exe"

Write-Host "=== PhotoWorld 3D | Doctor Sujeto 360 ===" -ForegroundColor Cyan

try {
  $v = (& py -3.11 --version 2>&1 | Out-String).Trim()
  Write-Host "[OK] $v" -ForegroundColor Green
} catch { Write-Host "[FALTA] Python 3.11" -ForegroundColor Red }

if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  Write-Host "[OK] NVIDIA" -ForegroundColor Green
  & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
} else { Write-Host "[FALTA] nvidia-smi" -ForegroundColor Red }

if (Test-Path (Join-Path $Repo "run.py")) { Write-Host "[OK] Stable Fast 3D clonado" -ForegroundColor Green }
else { Write-Host "[FALTA] Stable Fast 3D" -ForegroundColor Yellow }

if (Test-Path $Py) {
  Write-Host "[OK] Entorno 360" -ForegroundColor Green
  & $Py -c "import torch; print('Torch', torch.__version__); print('CUDA', torch.cuda.is_available()); print('GPU', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')"
  & $Py -c "import rembg, transformers, trimesh; print('Dependencias SF3D: OK')" 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host "[AVISO] Dependencias SF3D incompletas" -ForegroundColor Yellow }
} else { Write-Host "[FALTA] engine/.venv-sf3d" -ForegroundColor Yellow }

$port = Get-NetTCPConnection -LocalPort 18787 -State Listen -ErrorAction SilentlyContinue
if ($port) { Write-Host "[INFO] Puerto 18787 escuchando (PID $($port.OwningProcess))" -ForegroundColor Cyan }
else { Write-Host "[OK] Puerto 18787 libre" -ForegroundColor Green }
