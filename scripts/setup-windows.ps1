$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root "engine"
$Venv = Join-Path $Engine ".venv"

Write-Host "[PhotoWorld 3D] Preparando motor CUDA..." -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python no está instalado o no está en PATH. Instala Python 3.11 x64 y vuelve a ejecutar este script."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js no está instalado o no está en PATH. Instala Node.js LTS y vuelve a ejecutar este script."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm no está disponible."
}
if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
  Write-Host "ADVERTENCIA: nvidia-smi no fue detectado. El motor podrá caer a CPU." -ForegroundColor Yellow
}

if (-not (Test-Path $Venv)) {
  python -m venv $Venv
}

$Py = Join-Path $Venv "Scripts\python.exe"
& $Py -m pip install --upgrade pip setuptools wheel

Write-Host "Instalando PyTorch CUDA 12.8..." -ForegroundColor Cyan
& $Py -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128

Write-Host "Instalando motor de profundidad..." -ForegroundColor Cyan
& $Py -m pip install -r (Join-Path $Engine "requirements.txt")

Write-Host "Verificando CUDA..." -ForegroundColor Cyan
& $Py -c "import torch; print('Torch:', torch.__version__); print('CUDA disponible:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"

Write-Host "Instalando dependencias de Electron/Vite..." -ForegroundColor Cyan
Set-Location $Root
npm install

Write-Host "Listo. Ejecuta: npm run dev" -ForegroundColor Green
