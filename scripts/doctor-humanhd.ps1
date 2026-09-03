$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Venv = Join-Path $Engine '.venv-humanhd'
$Py = Join-Path $Venv 'Scripts\python.exe'
$SiTH = Join-Path $Engine 'vendor\SiTH'
$Smpl = Join-Path $Engine 'models\body_models\smplx'

Write-Host '=== PhotoWorld 3D | Doctor Persona HD ===' -ForegroundColor Cyan

function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[AVISO] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FALLO] $m" -ForegroundColor Red }

if (Test-Path $Py) { Ok 'Python .venv-humanhd' } else { Fail 'Falta .venv-humanhd'; exit 1 }
if (Test-Path (Join-Path $SiTH 'reconstruct.py')) { Ok 'SiTH clonado' } else { Fail 'Falta SiTH'; exit 1 }

& $Py -c "import torch; print('Torch',torch.__version__); print('CUDA',torch.cuda.is_available()); print('GPU',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); print('CAP',torch.cuda.get_device_capability(0) if torch.cuda.is_available() else '-')"
if ($LASTEXITCODE -eq 0) { Ok 'PyTorch/CUDA' } else { Fail 'PyTorch/CUDA'; exit 1 }

& $Py -c "import kaolin, nvdiffrast.torch, smplx, diffusers, transformers, timm, trimesh; print('Kaolin',kaolin.__version__); print('Imports Persona HD OK')"
if ($LASTEXITCODE -eq 0) { Ok 'Dependencias Persona HD' } else { Fail 'Dependencias Persona HD'; exit 1 }

$Required = @(
  'SMPLX_NEUTRAL.pkl',
  'SMPLX_NEUTRAL.npz',
  'SMPLX_MALE.pkl',
  'SMPLX_MALE.npz',
  'SMPLX_FEMALE.pkl',
  'SMPLX_FEMALE.npz'
)

$Missing = @()
foreach ($Name in $Required) {
  if (-not (Test-Path (Join-Path $Smpl $Name))) { $Missing += $Name }
}

if ($Missing.Count -eq 0) {
  Ok 'Modelos SMPL-X completos'
} else {
  Warn "Faltan modelos SMPL-X en $Smpl"
  foreach ($Name in $Missing) { Write-Host "       - $Name" -ForegroundColor DarkYellow }
}

Write-Host ''
if ($Missing.Count -eq 0) {
  Write-Host 'Persona HD listo para integrar el fitting SMPL-X.' -ForegroundColor Green
} else {
  Write-Host 'El stack tecnico esta listo; falta descargar/aceptar la licencia de SMPL-X.' -ForegroundColor Yellow
}
