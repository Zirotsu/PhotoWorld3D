# PhotoWorld 3D

Aplicación de escritorio local para transformar una fotografía en una experiencia 3D interactiva usando la GPU NVIDIA del equipo.

## Qué hace el MVP

- **Escena 3D:** usa Depth Anything V2 en PyTorch/CUDA para estimar profundidad de una fotografía completa y reconstruir una nube de puntos o malla navegable en Three.js.
- **Sujeto 360°:** integración opcional con Stable Fast 3D para generar un archivo GLB real desde una fotografía y orbitar alrededor del sujeto.
- **Todo local:** Electron levanta un motor FastAPI local en `127.0.0.1:8787`; las imágenes no necesitan salir del PC salvo la descarga inicial de pesos.
- **Controles:** mouse para orbitar, rueda para zoom, WASD para desplazarse, Q/E para bajar/subir.

## Requisitos recomendados

- Windows 10/11 x64
- NVIDIA RTX con drivers recientes
- Python 3.11 x64
- Node.js LTS + npm
- Git

## Instalación rápida

Abre PowerShell en la carpeta del proyecto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
npm run dev
```

La primera ejecución del modo de profundidad descargará el checkpoint `depth-anything/Depth-Anything-V2-Small-hf`.

## Activar sujeto 360°

Stable Fast 3D vive en un entorno Python separado para no romper las dependencias del motor principal:

```powershell
.\scripts\install-sf3d.ps1
```

Después sigue la autenticación de Hugging Face que muestra el script y reinicia `npm run dev`.

## Arquitectura

```text
Electron
  └─ Vite UI
      └─ Three.js viewer
          ├─ depth point cloud / mesh
          └─ GLB 360 viewer

Electron main process
  └─ Python FastAPI local :8787
      ├─ Depth Anything V2 -> CUDA
      └─ Stable Fast 3D adapter -> CUDA
```

## Límites del MVP

El modo **Escena 3D** reconstruye sólo la geometría que puede inferirse de la cámara original. Al mirar completamente detrás de una persona u objeto habrá zonas sin información. El modo **Sujeto 360°** sí genera geometría nueva para caras no observadas, por lo que esas partes son una estimación generativa y no información recuperada de la fotografía.

## Próximos hitos

1. Segmentación automática de personas/objetos y selector de sujeto.
2. Fusionar sujeto GLB generado con la escena de profundidad.
3. Generación de áreas ocultas del escenario y relleno multi-vista.
4. Colisiones y navegación en primera persona.
5. Empaquetado del motor Python para que el instalador final no requiera Python del sistema.
