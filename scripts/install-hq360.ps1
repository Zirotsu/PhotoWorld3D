$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Venv = Join-Path $Engine '.venv-hq360'
$VendorRoot = Join-Path $Engine 'vendor'
$Vendor = Join-Path $VendorRoot 'InstantMesh'
$TorchExtensions = Join-Path $Engine '.torch_extensions_hq360'
$Requirements = Join-Path $Engine 'hq360-requirements.txt'

Write-Host '=== PhotoWorld 3D | Instalador 360 Alta Fidelidad ===' -ForegroundColor Cyan
Write-Host 'Este entorno es independiente de SF3D y del motor principal.' -ForegroundColor DarkGray

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'No encuentro el launcher "py". Instala Python 3.11 x64 antes de continuar.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'No encuentro Git en PATH.'
}
if (-not (Test-Path $Requirements)) {
  throw "Falta $Requirements"
}

$Cuda = if ($env:CUDA_PATH) { $env:CUDA_PATH } else { 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8' }
if (-not (Test-Path (Join-Path $Cuda 'bin\nvcc.exe'))) {
  throw "No encuentro CUDA Toolkit 12.8 / nvcc en: $Cuda"
}

$VsDevCandidates = @(
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat'
)
$VsDev = $VsDevCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $VsDev) {
  throw 'No encuentro Visual Studio 2022 Build Tools con C++. Instala Desktop development with C++.'
}

New-Item -ItemType Directory -Force -Path $VendorRoot | Out-Null
New-Item -ItemType Directory -Force -Path $TorchExtensions | Out-Null

if (-not (Test-Path $Venv)) {
  Write-Host '[1/8] Creando entorno Python 3.11...' -ForegroundColor Yellow
  & py -3.11 -m venv $Venv
}

$Py = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $Py)) {
  throw "No se creó correctamente el entorno: $Py"
}

Write-Host '[2/8] Actualizando herramientas de instalación...' -ForegroundColor Yellow
& $Py -m pip install --upgrade pip
& $Py -m pip install 'setuptools==69.5.1' wheel ninja

Write-Host '[3/8] Instalando PyTorch 2.8 + CUDA 12.8...' -ForegroundColor Yellow
& $Py -m pip install --upgrade --force-reinstall `
  'torch==2.8.0' 'torchvision==0.23.0' `
  --index-url 'https://download.pytorch.org/whl/cu128'

Write-Host '[4/8] Instalando dependencias del pipeline multivista...' -ForegroundColor Yellow
& $Py -m pip install -r $Requirements

if (-not (Test-Path (Join-Path $Vendor 'run.py'))) {
  Write-Host '[5/8] Clonando TencentARC/InstantMesh...' -ForegroundColor Yellow
  if (Test-Path $Vendor) { Remove-Item -Recurse -Force $Vendor }
  & git clone --depth 1 'https://github.com/TencentARC/InstantMesh.git' $Vendor
} else {
  Write-Host '[5/8] InstantMesh ya está clonado.' -ForegroundColor Green
}

Write-Host '[6/8] Instalando nvdiffrast con MSVC + CUDA...' -ForegroundColor Yellow
$InstallCmd = "call `"$VsDev`" -arch=x64 && set DISTUTILS_USE_SDK=1 && set MSSdk=1 && set CUDA_HOME=$Cuda && set TORCH_CUDA_ARCH_LIST=12.0 && set TORCH_EXTENSIONS_DIR=$TorchExtensions && `"$Py`" -m pip install --no-build-isolation git+https://github.com/NVlabs/nvdiffrast/"
& cmd.exe /d /s /c $InstallCmd
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de nvdiffrast.' }

Write-Host '[7/8] Precompilando extensión CUDA para la RTX...' -ForegroundColor Yellow
$WarmupPy = "import torch; import nvdiffrast.torch as dr; print('Torch',torch.__version__); print('CUDA',torch.cuda.is_available()); print('GPU',torch.cuda.get_device_name(0)); print('CAP',torch.cuda.get_device_capability(0)); ctx=dr.RasterizeCudaContext(); print('nvdiffrast CUDA OK')"
$WarmupCmd = "call `"$VsDev`" -arch=x64 && set DISTUTILS_USE_SDK=1 && set MSSdk=1 && set CUDA_HOME=$Cuda && set TORCH_CUDA_ARCH_LIST=12.0 && set TORCH_EXTENSIONS_DIR=$TorchExtensions && `"$Py`" -c `"$WarmupPy`""
& cmd.exe /d /s /c $WarmupCmd
if ($LASTEXITCODE -ne 0) { throw 'Falló la precompilación CUDA de nvdiffrast.' }

Write-Host '[8/8] Verificando entorno HQ360...' -ForegroundColor Yellow
$env:TORCH_EXTENSIONS_DIR = $TorchExtensions
& $Py -c "import torch, diffusers, transformers, rembg, trimesh, cv2, xatlas, nvdiffrast.torch; print('Torch', torch.__version__); print('CUDA', torch.cuda.is_available()); print('GPU', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); print('HQ360 imports OK')"
if ($LASTEXITCODE -ne 0) {
  throw 'La verificación del entorno 360 HD falló.'
}

Write-Host ''
Write-Host 'Motor 360 Alta Fidelidad instalado.' -ForegroundColor Green
Write-Host 'La primera generación descargará los checkpoints de Zero123++ e InstantMesh.' -ForegroundColor DarkGray
Write-Host 'Ejecuta: npm run dev' -ForegroundColor Cyan
