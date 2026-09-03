$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root "engine"
$Vendor = Join-Path $Engine "vendor"
$Repo = Join-Path $Vendor "stable-fast-3d"
$Venv = Join-Path $Engine ".venv-sf3d"

Write-Host "=== PhotoWorld 3D | Motor Sujeto 360 ===" -ForegroundColor Cyan
Write-Host "Este motor se instala aislado del motor de profundidad." -ForegroundColor DarkGray

New-Item -ItemType Directory -Force -Path $Vendor | Out-Null

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git no está instalado o no está en PATH."
}

# Stable Fast 3D is much less troublesome on Windows with Python 3.11.
$PyLauncher = Get-Command py -ErrorAction SilentlyContinue
if (-not $PyLauncher) {
  throw "No encontré el launcher 'py'. Instala Python 3.11 x64 con: winget install -e --id Python.Python.3.11"
}

try {
  $Version = (& py -3.11 --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Python 3.11 no disponible" }
  Write-Host "[OK] $Version" -ForegroundColor Green
} catch {
  throw "PhotoWorld 360 necesita Python 3.11. Instálalo con: winget install -e --id Python.Python.3.11"
}

if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
  Write-Host "ADVERTENCIA: no detecté nvidia-smi. SF3D puede caer a CPU." -ForegroundColor Yellow
} else {
  Write-Host "GPU detectada:" -ForegroundColor Cyan
  & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
}

# Windows support in upstream SF3D is experimental and native extensions need MSVC.
$VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $VsWhere) {
  $VsInstall = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($VsInstall) {
    Write-Host "[OK] Visual Studio C++ Build Tools: $VsInstall" -ForegroundColor Green
  } else {
    Write-Host "ADVERTENCIA: no encontré las herramientas C++ x64 de Visual Studio." -ForegroundColor Yellow
    Write-Host "Si la compilación falla, instala Visual Studio 2022 Build Tools + Desktop development with C++." -ForegroundColor Yellow
  }
} else {
  Write-Host "ADVERTENCIA: no encontré vswhere. SF3D en Windows puede requerir Visual Studio 2022 Build Tools." -ForegroundColor Yellow
}

if (-not (Test-Path $Repo)) {
  Write-Host "Clonando Stable Fast 3D oficial..." -ForegroundColor Cyan
  git clone https://github.com/Stability-AI/stable-fast-3d.git $Repo
  if ($LASTEXITCODE -ne 0) { throw "No pude clonar Stable Fast 3D." }
} else {
  Write-Host "Stable Fast 3D ya está clonado." -ForegroundColor DarkGray
}

if (-not (Test-Path $Venv)) {
  Write-Host "Creando entorno Python 3.11 aislado..." -ForegroundColor Cyan
  & py -3.11 -m venv $Venv
  if ($LASTEXITCODE -ne 0) { throw "No pude crear engine/.venv-sf3d" }
}

$Py = Join-Path $Venv "Scripts\python.exe"
Write-Host "Actualizando herramientas Python..." -ForegroundColor Cyan
& $Py -m pip install --upgrade pip wheel
& $Py -m pip install setuptools==69.5.1

Write-Host "Instalando PyTorch CUDA 12.8 para Sujeto 360..." -ForegroundColor Cyan
& $Py -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128

Write-Host "Instalando dependencias de Stable Fast 3D..." -ForegroundColor Cyan
Set-Location $Repo
& $Py -m pip install -r requirements.txt

Write-Host "Instalando cliente de Hugging Face..." -ForegroundColor Cyan
& $Py -m pip install "huggingface_hub[cli]==0.23.4"

Write-Host "Verificando CUDA del motor 360..." -ForegroundColor Cyan
& $Py -c "import torch; print('Torch:', torch.__version__); print('CUDA disponible:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"

Write-Host "" 
Write-Host "Motor Sujeto 360 instalado." -ForegroundColor Green
Write-Host "IMPORTANTE: Stable Fast 3D es un modelo gated en Hugging Face." -ForegroundColor Yellow
Write-Host "1) Solicita/acepta acceso a stabilityai/stable-fast-3d en Hugging Face." -ForegroundColor Yellow
Write-Host "2) Luego ejecuta:" -ForegroundColor Yellow
Write-Host "   $Py -m huggingface_hub.commands.huggingface_cli login" -ForegroundColor White
Write-Host "3) Reinicia PhotoWorld con: npm run dev" -ForegroundColor Yellow
