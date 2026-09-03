import asyncio
import io
import os
from pathlib import Path
import shutil
import subprocess
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
import torch

from inference import MODEL_ID, device_name, estimate_depth, gpu_info

ENGINE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = ENGINE_DIR / 'outputs'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SF3D_DIR = ENGINE_DIR / 'vendor' / 'stable-fast-3d'
SF3D_VENV = ENGINE_DIR / '.venv-sf3d'
PORT = int(os.getenv('PHOTOWORLD_PORT', '18787'))

app = FastAPI(title='PhotoWorld 3D Local AI Engine', version='0.2.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.mount('/outputs', StaticFiles(directory=str(OUTPUT_DIR)), name='outputs')


def sf3d_python() -> Path:
    if os.name == 'nt':
        return SF3D_VENV / 'Scripts' / 'python.exe'
    return SF3D_VENV / 'bin' / 'python'


def sf3d_ready() -> bool:
    return (SF3D_DIR / 'run.py').exists() and sf3d_python().exists()


@app.get('/api/health')
def health():
    return {
        'ok': True,
        'service': 'photoworld3d-local-engine',
        'version': '0.2.0',
        'port': PORT,
        'device': device_name(),
        'gpu': gpu_info(),
        'model_id': MODEL_ID,
        'torch_version': torch.__version__,
    }


@app.get('/api/object360/status')
def object360_status():
    return {
        'ready': sf3d_ready(),
        'repo_found': (SF3D_DIR / 'run.py').exists(),
        'venv_found': sf3d_python().exists(),
        'hf_token_present': bool(os.getenv('HF_TOKEN') or os.getenv('HUGGING_FACE_HUB_TOKEN')),
    }


@app.post('/api/scene/depth')
async def scene_depth(image: UploadFile = File(...)):
    try:
        raw = await image.read()
        pil = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'No pude leer la imagen: {exc}') from exc
    try:
        return await asyncio.to_thread(estimate_depth, pil)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Error del motor de profundidad: {exc}') from exc


def run_sf3d(input_path: Path, job_dir: Path, texture_resolution: int, foreground_ratio: float) -> Path:
    if not sf3d_ready():
        raise RuntimeError('Stable Fast 3D no está instalado. Ejecuta scripts/install-sf3d.ps1.')

    texture_resolution = max(512, min(2048, int(texture_resolution)))
    foreground_ratio = max(0.60, min(0.95, float(foreground_ratio)))
    cmd = [
        str(sf3d_python()),
        str(SF3D_DIR / 'run.py'),
        str(input_path),
        '--output-dir',
        str(job_dir),
        '--texture-resolution',
        str(texture_resolution),
        '--foreground-ratio',
        str(foreground_ratio),
    ]
    env = os.environ.copy()
    env.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
    print('Launching SF3D:', ' '.join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=str(SF3D_DIR), env=env, capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout[-12000:], flush=True)
    if proc.returncode != 0:
        error = (proc.stderr or proc.stdout or 'SF3D terminó con error.')[-8000:]
        raise RuntimeError(error)
    glbs = sorted(job_dir.rglob('*.glb'), key=lambda p: p.stat().st_mtime, reverse=True)
    if not glbs:
        raise RuntimeError('SF3D terminó, pero no encontré ningún archivo GLB.')
    return glbs[0]


@app.post('/api/object360/generate')
async def object360_generate(
    image: UploadFile = File(...),
    texture_resolution: int = Form(1024),
    foreground_ratio: float = Form(0.85),
):
    if not sf3d_ready():
        raise HTTPException(status_code=412, detail='Stable Fast 3D no está instalado. Ejecuta scripts/install-sf3d.ps1.')
    job_id = uuid.uuid4().hex[:12]
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / 'input.png'
    try:
        raw = await image.read()
        pil = Image.open(io.BytesIO(raw)).convert('RGB')
        pil.save(input_path, format='PNG')
        glb = await asyncio.to_thread(
            run_sf3d,
            input_path,
            job_dir,
            texture_resolution,
            foreground_ratio,
        )
        relative = glb.relative_to(OUTPUT_DIR).as_posix()
        return {
            'job_id': job_id,
            'glb_url': f'/outputs/{relative}',
            'texture_resolution': texture_resolution,
            'foreground_ratio': foreground_ratio,
        }
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f'Error generando el sujeto 360°: {exc}') from exc


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='info')
