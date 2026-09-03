$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Venv = Join-Path $Engine '.venv-humanhd'
$VendorRoot = Join-Path $Engine 'vendor'
$SiTH = Join-Path $VendorRoot 'SiTH'
$Req = Join-Path $Engine 'humanhd-requirements.txt'

Write-Host '=== PhotoWorld 3D | Instalador Persona HD (SiTH) ===' -ForegroundColor Cyan
Write-Host 'Entorno aislado: no modifica SF3D, HQ360 ni OmniManager.' -ForegroundColor DarkGray

if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'No encuentro el launcher py.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'No encuentro Git en PATH.' }
if (-not (Test-Path $Req)) { throw "Falta $Req" }

$Cuda = if ($env:CUDA_PATH) { $env:CUDA_PATH.Trim().TrimEnd('\') } else { 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8' }
$Nvcc = Join-Path $Cuda 'bin\nvcc.exe'
if (-not (Test-Path $Nvcc)) { throw "No encuentro nvcc: $Nvcc" }

$VsDevCandidates = @(
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat'
)
$VsDev = $VsDevCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $VsDev) { throw 'No encuentro Visual Studio 2022 Build Tools con C++.' }

New-Item -ItemType Directory -Force -Path $VendorRoot | Out-Null

if (-not (Test-Path $Venv)) {
  Write-Host '[1/10] Creando Python 3.11 aislado...' -ForegroundColor Yellow
  & py -3.11 -m venv $Venv
  if ($LASTEXITCODE -ne 0) { throw 'No pude crear .venv-humanhd.' }
} else {
  Write-Host '[1/10] .venv-humanhd ya existe; se reutiliza.' -ForegroundColor Green
}

$Py = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $Py)) { throw "No encuentro $Py" }

Write-Host '[2/10] Herramientas Python...' -ForegroundColor Yellow
& $Py -m pip install --upgrade pip 'setuptools>=70' wheel ninja packaging
if ($LASTEXITCODE -ne 0) { throw 'Fallo actualizando pip/setuptools.' }

Write-Host '[3/10] PyTorch 2.8 + CUDA 12.8 para Blackwell...' -ForegroundColor Yellow
& $Py -m pip install --upgrade 'torch==2.8.0' 'torchvision==0.23.0' --index-url 'https://download.pytorch.org/whl/cu128'
if ($LASTEXITCODE -ne 0) { throw 'Fallo instalando PyTorch cu128.' }

Write-Host '[4/10] Dependencias Persona HD compatibles...' -ForegroundColor Yellow
& $Py -m pip install --upgrade -r $Req
if ($LASTEXITCODE -ne 0) { throw 'Fallo instalando dependencias Persona HD.' }

if (-not (Test-Path (Join-Path $SiTH 'reconstruct.py'))) {
  Write-Host '[5/10] Clonando SiTH...' -ForegroundColor Yellow
  if (Test-Path $SiTH) { Remove-Item -Recurse -Force $SiTH }
  & git clone --depth 1 'https://github.com/SiTH-Diffusion/SiTH.git' $SiTH
  if ($LASTEXITCODE -ne 0) { throw 'Fallo clonando SiTH.' }
} else {
  Write-Host '[5/10] SiTH ya esta clonado.' -ForegroundColor Green
}

Write-Host '[6/10] Instalando tinyobjloader...' -ForegroundColor Yellow
& $Py -m pip install --no-build-isolation --upgrade 'git+https://github.com/tinyobjloader/tinyobjloader.git@v2.0.0rc8#subdirectory=python'
if ($LASTEXITCODE -ne 0) { throw 'Fallo instalando tinyobjloader.' }

Write-Host '[7/10] Instalando NVIDIA Kaolin 0.18 para Torch 2.8/cu128...' -ForegroundColor Yellow
& $Py -m pip install --upgrade 'kaolin==0.18.0' -f 'https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.8.0_cu128.html'
if ($LASTEXITCODE -ne 0) { throw 'Fallo instalando Kaolin 0.18.' }

Write-Host '[8/10] Instalando nvdiffrast con MSVC + CUDA...' -ForegroundColor Yellow
$NvdCmd = "call `"$VsDev`" -arch=x64 && set `"DISTUTILS_USE_SDK=1`" && set `"MSSdk=1`" && set `"CUDA_HOME=$Cuda`" && set `"CUDA_PATH=$Cuda`" && set `"TORCH_CUDA_ARCH_LIST=12.0`" && `"$Py`" -m pip install --upgrade --no-build-isolation --no-cache-dir git+https://github.com/NVlabs/nvdiffrast.git"
& cmd.exe /d /s /c $NvdCmd
if ($LASTEXITCODE -ne 0) { throw 'Fallo instalando nvdiffrast.' }

Write-Host '[9/10] Precompilando rasterizador CUDA...' -ForegroundColor Yellow
$WarmupPy = "import torch; import nvdiffrast.torch as dr; print('Torch',torch.__version__); print('CUDA',torch.cuda.is_available()); print('GPU',torch.cuda.get_device_name(0)); print('CAP',torch.cuda.get_device_capability(0)); ctx=dr.RasterizeCudaContext(); print('nvdiffrast CUDA OK')"
$WarmupCmd = "call `"$VsDev`" -arch=x64 && set `"DISTUTILS_USE_SDK=1`" && set `"MSSdk=1`" && set `"CUDA_HOME=$Cuda`" && set `"CUDA_PATH=$Cuda`" && set `"TORCH_CUDA_ARCH_LIST=12.0`" && `"$Py`" -c `"$WarmupPy`""
& cmd.exe /d /s /c $WarmupCmd
if ($LASTEXITCODE -ne 0) { throw 'Fallo la prueba CUDA de nvdiffrast.' }

Write-Host '[10/10] Verificando stack Persona HD...' -ForegroundColor Yellow
& $Py -c "import torch, kaolin, nvdiffrast.torch, smplx, diffusers, transformers, timm, trimesh; print('Torch',torch.__version__); print('CUDA',torch.cuda.is_available()); print('GPU',torch.cuda.get_device_name(0)); print('Kaolin',kaolin.__version__); print('Persona HD imports OK')"
if ($LASTEXITCODE -ne 0) { throw 'La verificacion final de Persona HD fallo.' }

Write-Host ''
Write-Host 'Motor base Persona HD instalado.' -ForegroundColor Green
Write-Host 'IMPORTANTE: no ejecutes engine\vendor\SiTH\requirements.txt; usa siempre este instalador.' -ForegroundColor Yellow
Write-Host 'Siguiente paso: ejecutar scripts\doctor-humanhd.ps1 y verificar modelos SMPL-X.' -ForegroundColor Cyan
