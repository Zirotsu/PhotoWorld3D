$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Venv = Join-Path $Engine '.venv-hq360'
$VendorRoot = Join-Path $Engine 'vendor'
$Vendor = Join-Path $VendorRoot 'InstantMesh'

Write-Host '=== PhotoWorld 3D | Instalador 360 Alta Fidelidad ===' -ForegroundColor Cyan
Write-Host 'Este entorno es independiente de SF3D y del motor principal.' -ForegroundColor DarkGray

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'No encuentro el launcher "py". Instala Python 3.11 x64 antes de continuar.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'No encuentro Git en PATH.'
}

New-Item -ItemType Directory -Force -Path $VendorRoot | Out-Null

if (-not (Test-Path $Venv)) {
  Write-Host '[1/7] Creando entorno Python 3.11...' -ForegroundColor Yellow
  & py -3.11 -m venv $Venv
}

$Py = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $Py)) {
  throw "No se creó correctamente el entorno: $Py"
}

Write-Host '[2/7] Actualizando herramientas de instalación...' -ForegroundColor Yellow
& $Py -m pip install --upgrade pip
& $Py -m pip install 'setuptools==69.5.1' wheel ninja

Write-Host '[3/7] Instalando PyTorch 2.8 + CUDA 12.8...' -ForegroundColor Yellow
& $Py -m pip install --upgrade --force-reinstall `
  'torch==2.8.0' 'torchvision==0.23.0' `
  --index-url 'https://download.pytorch.org/whl/cu128'

Write-Host '[4/7] Instalando dependencias del pipeline multivista...' -ForegroundColor Yellow
$Requirements = Join-Path $Engine 'hq360-requirements.txt'
if (-not (Test-Path $Requirements)) { throw "Falta $Requirements" }
& $Py -m pip install -r $Requirements

if (-not (Test-Path (Join-Path $Vendor 'run.py'))) {
  Write-Host '[5/7] Clonando TencentARC/InstantMesh...' -ForegroundColor Yellow
  if (Test-Path $Vendor) { Remove-Item -Recurse -Force $Vendor }
  & git clone --depth 1 'https://github.com/TencentARC/InstantMesh.git' $Vendor
} else {
  Write-Host '[5/7] InstantMesh ya está clonado.' -ForegroundColor Green
}

Write-Host '[6/7] Instalando nvdiffrast...' -ForegroundColor Yellow
$env:TORCH_CUDA_ARCH_LIST = '12.0'
$env:CUDA_HOME = if ($env:CUDA_PATH) { $env:CUDA_PATH } else { 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8' }
& $Py -m pip install --no-build-isolation 'git+https://github.com/NVlabs/nvdiffrast/'

Write-Host '[7/7] Verificando entorno...' -ForegroundColor Yellow
& $Py -c "import torch, diffusers, transformers, rembg, trimesh, nvdiffrast.torch; print('Torch', torch.__version__); print('CUDA', torch.cuda.is_available()); print('GPU', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); print('HQ360 imports OK')"
if ($LASTEXITCODE -ne 0) {
  throw 'La verificación del entorno 360 HD falló.'
}

Write-Host ''
Write-Host 'Motor 360 Alta Fidelidad instalado.' -ForegroundColor Green
Write-Host 'La primera generación descargará los checkpoints de Zero123++ e InstantMesh.' -ForegroundColor DarkGray
Write-Host 'Ejecuta: npm run dev' -ForegroundColor Cyan
