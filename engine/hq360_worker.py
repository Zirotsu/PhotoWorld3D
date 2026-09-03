import argparse
import gc
import json
from pathlib import Path
import sys

VIEW_SPECS = [
    ('az30', 30, 20),
    ('az90', 90, -10),
    ('az150', 150, 20),
    ('az210', 210, -10),
    ('az270', 270, 20),
    ('az330', 330, -10),
]


def ensure_vendor(vendor_dir: Path):
    if not (vendor_dir / 'run.py').exists():
        raise RuntimeError(f'InstantMesh no está instalado en {vendor_dir}')
    sys.path.insert(0, str(vendor_dir))


def generate_views(args):
    import torch
    import rembg
    from diffusers import DiffusionPipeline, EulerAncestralDiscreteScheduler
    from huggingface_hub import hf_hub_download
    from PIL import Image

    vendor_dir = Path(args.vendor_dir).resolve()
    job_dir = Path(args.job_dir).resolve()
    input_path = Path(args.input).resolve()
    ensure_vendor(vendor_dir)

    from src.utils.infer_util import remove_background, resize_foreground

    if not torch.cuda.is_available():
        raise RuntimeError('360 HD requiere CUDA. PyTorch no detectó una GPU NVIDIA.')

    import random
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    device = torch.device('cuda')
    custom_pipeline = str(vendor_dir / 'zero123plus')

    print('HQ360 Stage 1/2: cargando generador multivista...', flush=True)
    pipeline = DiffusionPipeline.from_pretrained(
        'sudo-ai/zero123plus-v1.2',
        custom_pipeline=custom_pipeline,
        torch_dtype=torch.float16,
    )
    pipeline.scheduler = EulerAncestralDiscreteScheduler.from_config(
        pipeline.scheduler.config,
        timestep_spacing='trailing',
    )

    unet_path = hf_hub_download(
        repo_id='TencentARC/InstantMesh',
        filename='diffusion_pytorch_model.bin',
        repo_type='model',
    )
    state_dict = torch.load(unet_path, map_location='cpu')
    pipeline.unet.load_state_dict(state_dict, strict=True)
    pipeline = pipeline.to(device)

    print('HQ360 Stage 1/2: preparando sujeto...', flush=True)
    source = Image.open(input_path).convert('RGBA')
    rembg_session = rembg.new_session()
    subject = remove_background(source, rembg_session)
    subject = resize_foreground(subject, args.foreground_ratio)
    subject.save(job_dir / 'subject_rgba.png')

    print(f'HQ360 Stage 1/2: generando 6 vistas con {args.diffusion_steps} pasos...', flush=True)
    with torch.inference_mode():
        output = pipeline(
            subject,
            num_inference_steps=args.diffusion_steps,
        ).images[0]

    grid_file = job_dir / 'views_grid.png'
    output.save(grid_file)

    cell_w = output.width // 2
    cell_h = output.height // 3
    views_dir = job_dir / 'views'
    views_dir.mkdir(parents=True, exist_ok=True)

    views = []
    for index, (name, azimuth, elevation) in enumerate(VIEW_SPECS):
        row, col = divmod(index, 2)
        crop = output.crop((
            col * cell_w,
            row * cell_h,
            (col + 1) * cell_w,
            (row + 1) * cell_h,
        )).convert('RGB')
        file_path = views_dir / f'{index + 1:02d}_{name}.png'
        crop.save(file_path, optimize=True)
        views.append({
            'index': index,
            'name': name,
            'azimuth': azimuth,
            'elevation': elevation,
            'file': file_path.relative_to(job_dir).as_posix(),
            'width': crop.width,
            'height': crop.height,
        })

    manifest = {
        'provider': 'InstantMesh Zero123++ white-background UNet',
        'input_file': 'input.png',
        'subject_file': 'subject_rgba.png',
        'grid_file': 'views_grid.png',
        'diffusion_steps': args.diffusion_steps,
        'foreground_ratio': args.foreground_ratio,
        'seed': args.seed,
        'views': views,
    }
    (job_dir / 'views.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

    del pipeline
    gc.collect()
    torch.cuda.empty_cache()
    print('HQ360 Stage 1/2: vistas listas.', flush=True)


def reconstruct(args):
    import numpy as np
    import torch
    import trimesh
    from huggingface_hub import hf_hub_download
    from omegaconf import OmegaConf
    from PIL import Image
    from torchvision.transforms import v2

    vendor_dir = Path(args.vendor_dir).resolve()
    job_dir = Path(args.job_dir).resolve()
    ensure_vendor(vendor_dir)

    from src.utils.camera_util import get_zero123plus_input_cameras
    from src.utils.mesh_util import save_obj_with_mtl
    from src.utils.train_util import instantiate_from_config

    if not torch.cuda.is_available():
        raise RuntimeError('360 HD requiere CUDA. PyTorch no detectó una GPU NVIDIA.')

    manifest_path = job_dir / 'views.json'
    if not manifest_path.exists():
        raise RuntimeError('No existe views.json. Genera las vistas antes de reconstruir.')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    view_records = manifest.get('views', [])
    if len(view_records) != 6:
        raise RuntimeError(f'Se esperaban 6 vistas y encontré {len(view_records)}.')

    config_path = vendor_dir / 'configs' / 'instant-mesh-large.yaml'
    config = OmegaConf.load(config_path)
    model_config = config.model_config
    infer_config = config.infer_config
    device = torch.device('cuda')

    print('HQ360 Stage 2/2: cargando InstantMesh Large...', flush=True)
    model = instantiate_from_config(model_config)

    local_ckpt = Path(infer_config.model_path)
    if not local_ckpt.is_absolute():
        local_ckpt = vendor_dir / local_ckpt
    if local_ckpt.exists():
        model_ckpt_path = str(local_ckpt)
    else:
        model_ckpt_path = hf_hub_download(
            repo_id='TencentARC/InstantMesh',
            filename='instant_mesh_large.ckpt',
            repo_type='model',
        )

    state_dict = torch.load(model_ckpt_path, map_location='cpu')['state_dict']
    state_dict = {k[14:]: v for k, v in state_dict.items() if k.startswith('lrm_generator.')}
    model.load_state_dict(state_dict, strict=True)
    model = model.to(device)
    model.init_flexicubes_geometry(device, fovy=30.0)
    model = model.eval()

    image_tensors = []
    for record in view_records:
        image = Image.open(job_dir / record['file']).convert('RGB')
        array = np.asarray(image, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous().float()
        image_tensors.append(tensor)

    images = torch.stack(image_tensors, dim=0).unsqueeze(0).to(device)
    images = v2.functional.resize(
        images,
        320,
        interpolation=3,
        antialias=True,
    ).clamp(0, 1)

    input_cameras = get_zero123plus_input_cameras(
        batch_size=1,
        radius=4.0,
    ).to(device)

    print('HQ360 Stage 2/2: reconstruyendo geometría...', flush=True)
    with torch.inference_mode():
        planes = model.forward_planes(images, input_cameras)
        mesh_out = model.extract_mesh(
            planes,
            use_texture_map=True,
            **infer_config,
        )

    vertices, faces, uvs, mesh_tex_idx, tex_map = mesh_out
    mesh_dir = job_dir / 'mesh'
    mesh_dir.mkdir(parents=True, exist_ok=True)
    obj_path = mesh_dir / 'hq360.obj'

    save_obj_with_mtl(
        vertices.data.cpu().numpy(),
        uvs.data.cpu().numpy(),
        faces.data.cpu().numpy(),
        mesh_tex_idx.data.cpu().numpy(),
        tex_map.permute(1, 2, 0).data.cpu().numpy(),
        str(obj_path),
    )

    print('HQ360 Stage 2/2: empaquetando GLB...', flush=True)
    scene = trimesh.load(str(obj_path), force='scene', process=False)
    glb_path = mesh_dir / 'hq360.glb'
    scene.export(str(glb_path), file_type='glb')

    result = {
        'provider': 'InstantMesh Large',
        'obj_file': obj_path.relative_to(job_dir).as_posix(),
        'glb_file': glb_path.relative_to(job_dir).as_posix(),
        'vertices_hint': int(vertices.shape[0]),
        'faces_hint': int(faces.shape[0]),
    }
    (job_dir / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')

    del model, planes, mesh_out
    gc.collect()
    torch.cuda.empty_cache()
    print('HQ360 Stage 2/2: GLB listo.', flush=True)


def build_parser():
    parser = argparse.ArgumentParser(description='PhotoWorld 3D high-fidelity 360 worker')
    subparsers = parser.add_subparsers(dest='mode', required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--vendor-dir', required=True)
    common.add_argument('--job-dir', required=True)

    views = subparsers.add_parser('views', parents=[common])
    views.add_argument('--input', required=True)
    views.add_argument('--diffusion-steps', type=int, default=75)
    views.add_argument('--foreground-ratio', type=float, default=0.85)
    views.add_argument('--seed', type=int, default=42)

    subparsers.add_parser('reconstruct', parents=[common])
    return parser


def main():
    args = build_parser().parse_args()
    if args.mode == 'views':
        generate_views(args)
    elif args.mode == 'reconstruct':
        reconstruct(args)
    else:
        raise RuntimeError(f'Modo desconocido: {args.mode}')


if __name__ == '__main__':
    main()
