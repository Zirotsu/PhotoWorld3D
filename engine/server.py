import asyncio
import io
import json
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

HQ360_VENDOR_DIR = ENGINE_DIR / 'vendor' / 'InstantMesh'
HQ360_VENV = ENGINE_DIR / '.venv-hq360'
HQ360_WORKER = ENGINE_DIR / 'hq360_worker.py'

PORT = int(os.getenv('PHOTOWORLD_PORT', '18787'))

app = FastAPI(title='PhotoWorld 3D Local AI Engine', version='0.3.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.mount('/outputs', StaticFiles(directory=str(OUTPUT_DIR)), name='outputs')


def venv_python(venv: Path) -> Path:
    if os.name == 'nt':
        return venv / 'Scripts' / 'python.exe'
    return venv / 'bin' / 'python'


def sf3d_python() -> Path:
    return venv_python(SF3D_VENV)


def hq360_python() -> Path:
    return venv_python(HQ360_VENV)


def sf3d_ready() -> bool:
    return (SF3D_DIR / 'run.py').exists() and sf3d_python().exists()


def hq360_ready() -> bool:
    return (
        (HQ360_VENDOR_DIR / 'run.py').exists()
        and (HQ360_VENDOR_DIR / 'configs' / 'instant-mesh-large.yaml').exists()
        and hq360_python().exists()
        and HQ360_WORKER.exists()
    )


@app.get('/api/health')
def health():
    return {
        'ok': True,
        'service': 'photoworld3d-local-engine',
        'version': '0.3.0',
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


@app.get('/api/hq360/status')
def hq360_status():
    return {
        'ready': hq360_ready(),
        'vendor_found': (HQ360_VENDOR_DIR / 'run.py').exists(),
        'venv_found': hq360_python().exists(),
        'worker_found': HQ360_WORKER.exists(),
        'provider': 'InstantMesh + Zero123++',
        'pipeline': 'multiview-6 -> sparse-view reconstruction -> textured GLB',
        'experimental': True,
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


def run_hq360_worker(mode: str, job_dir: Path, **kwargs) -> dict:
    if not hq360_ready():
        raise RuntimeError('El motor 360 HD no está instalado. Ejecuta scripts/install-hq360.ps1.')

    cmd = [
        str(hq360_python()),
        str(HQ360_WORKER),
        mode,
        '--vendor-dir',
        str(HQ360_VENDOR_DIR),
        '--job-dir',
        str(job_dir),
    ]
    for key, value in kwargs.items():
        if value is None:
            continue
        cmd.extend([f'--{key.replace("_", "-")}', str(value)])

    env = os.environ.copy()
    env.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
    env.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
    print('Launching HQ360:', ' '.join(cmd), flush=True)
    proc = subprocess.run(
        cmd,
        cwd=str(ENGINE_DIR),
        env=env,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    if proc.stdout:
        print(proc.stdout[-16000:], flush=True)
    if proc.returncode != 0:
        error = (proc.stderr or proc.stdout or 'El worker 360 HD terminó con error.')[-10000:]
        (job_dir / 'hq360_error.log').write_text(error, encoding='utf-8', errors='replace')
        raise RuntimeError(error)

    result_path = job_dir / ('views.json' if mode == 'views' else 'result.json')
    if not result_path.exists():
        raise RuntimeError(f'El worker terminó sin crear {result_path.name}.')
    return json.loads(result_path.read_text(encoding='utf-8'))


@app.post('/api/hq360/views')
async def hq360_views(
    image: UploadFile = File(...),
    diffusion_steps: int = Form(75),
    foreground_ratio: float = Form(0.85),
    seed: int = Form(42),
):
    if not hq360_ready():
        raise HTTPException(status_code=412, detail='El motor 360 HD no está instalado. Ejecuta scripts/install-hq360.ps1.')

    diffusion_steps = max(20, min(100, int(diffusion_steps)))
    foreground_ratio = max(0.65, min(0.92, float(foreground_ratio)))
    seed = int(seed)

    session_id = f'hq-{uuid.uuid4().hex[:12]}'
    job_dir = OUTPUT_DIR / session_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / 'input.png'

    try:
        raw = await image.read()
        pil = Image.open(io.BytesIO(raw)).convert('RGB')
        pil.save(input_path, format='PNG')
        result = await asyncio.to_thread(
            run_hq360_worker,
            'views',
            job_dir,
            input=input_path,
            diffusion_steps=diffusion_steps,
            foreground_ratio=foreground_ratio,
            seed=seed,
        )

        views = []
        for view in result.get('views', []):
            file_path = job_dir / view['file']
            if not file_path.exists():
                continue
            relative = file_path.relative_to(OUTPUT_DIR).as_posix()
            views.append({**view, 'url': f'/outputs/{relative}'})

        grid_path = job_dir / result.get('grid_file', 'views_grid.png')
        grid_url = None
        if grid_path.exists():
            grid_url = f"/outputs/{grid_path.relative_to(OUTPUT_DIR).as_posix()}"

        return {
            'session_id': session_id,
            'views': views,
            'grid_url': grid_url,
            'diffusion_steps': diffusion_steps,
            'foreground_ratio': foreground_ratio,
            'seed': seed,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Error generando vistas 360 HD: {exc}') from exc


def resolve_hq_session(session_id: str) -> Path:
    if not session_id or not session_id.startswith('hq-'):
        raise HTTPException(status_code=400, detail='Sesión 360 HD inválida.')
    job_dir = (OUTPUT_DIR / session_id).resolve()
    if job_dir.parent != OUTPUT_DIR.resolve() or not job_dir.exists():
        raise HTTPException(status_code=404, detail='No encontré esa sesión 360 HD.')
    return job_dir


@app.post('/api/hq360/reconstruct')
async def hq360_reconstruct(
    session_id: str = Form(...),
):
    if not hq360_ready():
        raise HTTPException(status_code=412, detail='El motor 360 HD no está instalado. Ejecuta scripts/install-hq360.ps1.')

    job_dir = resolve_hq_session(session_id)
    manifest = job_dir / 'views.json'
    if not manifest.exists():
        raise HTTPException(status_code=409, detail='Primero genera las seis vistas IA de esta sesión.')

    try:
        result = await asyncio.to_thread(run_hq360_worker, 'reconstruct', job_dir)
        glb = job_dir / result['glb_file']
        if not glb.exists():
            raise RuntimeError('La reconstrucción terminó, pero no encontré el GLB final.')
        relative = glb.relative_to(OUTPUT_DIR).as_posix()
        return {
            'session_id': session_id,
            'glb_url': f'/outputs/{relative}',
            'vertices_hint': result.get('vertices_hint'),
            'faces_hint': result.get('faces_hint'),
            'mode': 'high-fidelity',
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Error reconstruyendo el 360 HD: {exc}') from exc


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='info')
