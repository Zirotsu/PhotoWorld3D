import base64
import io
import os
import threading
from dataclasses import dataclass

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

MODEL_ID = os.getenv('PHOTOWORLD_DEPTH_MODEL', 'depth-anything/Depth-Anything-V2-Small-hf')
MAX_DIMENSION = int(os.getenv('PHOTOWORLD_MAX_DIMENSION', '1024'))


@dataclass
class DepthRuntime:
    processor: object | None = None
    model: object | None = None
    lock: threading.Lock = threading.Lock()


runtime = DepthRuntime()


def device_name() -> str:
    return 'cuda' if torch.cuda.is_available() else 'cpu'


def gpu_info() -> dict | None:
    if not torch.cuda.is_available():
        return None
    props = torch.cuda.get_device_properties(0)
    return {
        'name': torch.cuda.get_device_name(0),
        'vram_gb': round(props.total_memory / (1024 ** 3), 2),
        'cuda_version': torch.version.cuda,
        'capability': f'{props.major}.{props.minor}',
    }


def ensure_model():
    if runtime.model is not None:
        return runtime.processor, runtime.model
    with runtime.lock:
        if runtime.model is None:
            print(f'Loading depth model: {MODEL_ID}', flush=True)
            processor = AutoImageProcessor.from_pretrained(MODEL_ID)
            model = AutoModelForDepthEstimation.from_pretrained(MODEL_ID)
            dev = device_name()
            if dev == 'cuda':
                model = model.to(device='cuda', dtype=torch.float16)
            else:
                model = model.to('cpu')
            model.eval()
            runtime.processor = processor
            runtime.model = model
            print(f'Depth model ready on {dev}', flush=True)
    return runtime.processor, runtime.model


def resize_image(image: Image.Image) -> Image.Image:
    image = image.convert('RGB')
    if max(image.size) <= MAX_DIMENSION:
        return image
    clone = image.copy()
    clone.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
    return clone


def png_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format='PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def estimate_depth(image: Image.Image) -> dict:
    image = resize_image(image)
    processor, model = ensure_model()
    dev = device_name()
    inputs = processor(images=image, return_tensors='pt')
    inputs = {k: v.to(dev) for k, v in inputs.items()}

    with torch.inference_mode():
        prediction = model(**inputs).predicted_depth
        prediction = F.interpolate(
            prediction.unsqueeze(1),
            size=(image.height, image.width),
            mode='bicubic',
            align_corners=False,
        ).squeeze(0).squeeze(0)

    depth = prediction.float().cpu().numpy()
    finite = np.isfinite(depth)
    if not finite.any():
        raise RuntimeError('El modelo produjo un mapa de profundidad inválido.')
    lo, hi = np.percentile(depth[finite], [1, 99])
    if hi <= lo:
        hi = lo + 1e-6
    depth = np.clip((depth - lo) / (hi - lo), 0, 1)
    depth_u8 = (depth * 255.0).astype(np.uint8)
    depth_img = Image.fromarray(depth_u8, mode='L')

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return {
        'width': image.width,
        'height': image.height,
        'device': dev,
        'gpu': gpu_info(),
        'image_png_b64': png_b64(image),
        'depth_png_b64': png_b64(depth_img),
    }
