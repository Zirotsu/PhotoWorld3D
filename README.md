# PhotoWorld 3D

Aplicación de escritorio local para transformar una fotografía en una experiencia 3D interactiva usando la GPU NVIDIA del equipo.

## Modos actuales

- **Escena 3D:** Depth Anything V2 + Three.js para una reconstrucción navegable tipo 2.5D de la fotografía completa.
- **360° rápido:** Stable Fast 3D genera un GLB desde una sola fotografía. Es rápido y útil para preview, pero las zonas ocultas se estiman desde una sola vista.
- **360° Alta Fidelidad:** genera primero seis vistas coherentes y luego las fusiona con InstantMesh Large en una reconstrucción sparse-view texturizada.
- **Todo local:** Electron levanta FastAPI en `127.0.0.1:18787`. Los archivos de trabajo quedan bajo `engine/outputs/`. Internet sólo es necesario para la descarga inicial de repositorios/checkpoints.

## Requisitos recomendados

- Windows 10/11 x64
- NVIDIA RTX con drivers recientes
- Python 3.11 x64
- Node.js LTS + npm
- Git
- Para los motores 3D CUDA en Windows: Visual Studio Build Tools 2022 y CUDA Toolkit 12.8

## Instalación base

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
npm run dev
```

La primera ejecución del modo de profundidad descarga `depth-anything/Depth-Anything-V2-Small-hf`.

## Activar 360° rápido

Stable Fast 3D vive en un entorno separado:

```powershell
.\scripts\install-sf3d.ps1
```

Diagnóstico:

```powershell
.\scripts\doctor-360.ps1
```

## Activar 360° Alta Fidelidad

El pipeline HD tiene otro entorno aislado para no modificar SF3D:

```powershell
.\scripts\install-hq360.ps1
```

Diagnóstico:

```powershell
.\scripts\doctor-hq360.ps1
```

Flujo dentro de la app:

```text
Foto original
  ↓
segmentación del sujeto
  ↓
6 vistas IA (azimut 30/90/150/210/270/330)
  ↓
InstantMesh Large
  ↓
malla + UV + textura
  ↓
GLB local
  ↓
visor 360° esférico
```

La primera ejecución de Alta Fidelidad puede descargar varios GB de checkpoints. Las vistas y el GLB de cada sesión quedan en `engine/outputs/hq-.../`, lo que permite inspeccionar qué imaginó la IA antes de reconstruir.

## Arquitectura

```text
Electron
  └─ Vite UI
      └─ Three.js viewer
          ├─ escena Depth Anything
          ├─ GLB SF3D rápido
          └─ GLB multivista HD

Electron main process
  └─ Python FastAPI :18787
      ├─ .venv           -> Depth Anything
      ├─ .venv-sf3d      -> Stable Fast 3D
      └─ .venv-hq360     -> Zero123++ / InstantMesh
```

## API relevante

- `GET /api/health`
- `GET /api/object360/status`
- `POST /api/object360/generate`
- `GET /api/hq360/status`
- `POST /api/hq360/views`
- `POST /api/hq360/reconstruct`

El modo HD está dividido en dos llamadas deliberadamente. Primero puedes revisar las seis vistas generadas; sólo si te sirven pasas a la reconstrucción final.

## Límites importantes

Ningún sistema puede recuperar literalmente información que nunca estuvo en la fotografía. La espalda, nuca, laterales ocultos y vistas superior/inferior son **estimaciones generativas**. El modo multivista busca que esas estimaciones sean más coherentes entre sí antes de construir la geometría.

### Licencias de modelos

El código propio de PhotoWorld no cambia las licencias de los modelos externos. InstantMesh publica código/model card bajo Apache-2.0, pero el pipeline multivista deriva de Zero123++ y sus pesos upstream han tenido términos no comerciales. Antes de distribuir PhotoWorld como producto comercial, revisa las licencias vigentes de todos los checkpoints que vayas a incluir o descargar. El modo HD de esta rama debe considerarse experimental/prototipo hasta cerrar esa revisión.

## Próximos hitos

1. Selector de sujeto cuando haya más de una persona/objeto.
2. Score automático de coherencia entre las seis vistas y aviso antes de reconstruir.
3. Reparación localizada de cara/pelo y reproyección de la foto original sobre la malla.
4. Fusionar sujeto GLB con la escena de profundidad.
5. Generación de áreas ocultas del escenario.
6. Empaquetado de los tres runtimes Python en el instalador final.
