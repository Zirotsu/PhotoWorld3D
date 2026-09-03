$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Py = Join-Path $Engine '.venv-hq360\Scripts\python.exe'
$Vendor = Join-Path $Engine 'vendor\InstantMesh'
$Worker = Join-Path $Engine 'hq360_worker.py'

Write-Host '=== PhotoWorld 3D | Doctor 360 Alta Fidelidad ===' -ForegroundColor Cyan

if (Test-Path $Py) { Write-Host '[OK] Entorno HQ360' -ForegroundColor Green } else { Write-Host '[FALTA] engine\.venv-hq360' -ForegroundColor Red }
if (Test-Path (Join-Path $Vendor 'run.py')) { Write-Host '[OK] InstantMesh clonado' -ForegroundColor Green } else { Write-Host '[FALTA] InstantMesh' -ForegroundColor Red }
if (Test-Path $Worker) { Write-Host '[OK] Worker HQ360' -ForegroundColor Green } else { Write-Host '[FALTA] hq360_worker.py' -ForegroundColor Red }

$Nvcc = Get-Command nvcc -ErrorAction SilentlyContinue
if ($Nvcc) {
  Write-Host "[OK] NVCC $($Nvcc.Source)" -ForegroundColor Green
  & nvcc --version | Select-Object -Last 4
} else {
  Write-Host '[AVISO] nvcc no está en PATH. nvdiffrast puede necesitar CUDA Toolkit.' -ForegroundColor Yellow
}

if (Test-Path $Py) {
  & $Py -c "import torch; print('Torch',torch.__version__); print('CUDA',torch.cuda.is_available()); print('GPU',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); print('CAP',torch.cuda.get_device_capability(0) if torch.cuda.is_available() else None); import diffusers, transformers, rembg, trimesh, nvdiffrast.torch; print('Dependencias HQ360: OK')"
  if ($LASTEXITCODE -eq 0) { Write-Host '[OK] Runtime HQ360' -ForegroundColor Green } else { Write-Host '[ERROR] Runtime HQ360 incompleto' -ForegroundColor Red }
}

Write-Host ''
Write-Host 'El endpoint esperado es GET http://127.0.0.1:18787/api/hq360/status' -ForegroundColor DarkGray
