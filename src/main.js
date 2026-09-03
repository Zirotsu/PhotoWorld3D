import './style.css';
import { SceneViewer } from './viewer.js';

const API = 'http://127.0.0.1:18787';

const app = document.querySelector('#app');
app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brandmark">3D</div>
        <div><h1>PhotoWorld 3D</h1><p>Foto → escena espacial local</p></div>
      </div>
      <div class="badges">
        <span id="engineBadge" class="badge warn">Motor local · conectando</span>
        <span id="gpuBadge" class="badge">GPU · detectando</span>
      </div>
    </header>

    <section class="layout">
      <aside class="panel sidebar">
        <div>
          <p class="section-title">Imagen de origen</p>
          <label id="dropzone" class="dropzone">
            <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" />
            <div id="dropEmpty" class="drop-empty">
              <div class="plus">+</div>
              <strong>Arrastra una foto aquí</strong>
              <span>PNG · JPG · WEBP</span>
            </div>
            <img id="preview" class="preview" alt="Vista previa de la foto cargada" />
          </label>
        </div>

        <div class="actions">
          <button id="depthBtn" class="primary" disabled>Crear escena 3D</button>
          <button id="objectBtn" class="secondary" disabled>Generar sujeto 360°</button>
        </div>

        <div class="settings-360">
          <label>Calidad 360°
            <select id="quality360">
              <option value="1024" selected>Alta · textura 1024</option>
              <option value="2048">Máxima · textura 2048</option>
              <option value="512">Prueba rápida · textura 512</option>
            </select>
          </label>
          <label>Encuadre del sujeto
            <input id="foregroundRatio" type="range" min="0.65" max="0.92" step="0.01" value="0.85" />
          </label>
        </div>

        <div id="sf3dNote" class="note">El modo 360° usa un motor separado y se activa cuando Stable Fast 3D está instalado.</div>

        <div class="status">
          <div class="status-row"><span>Motor IA</span><strong id="engineState">Fuera de línea</strong></div>
          <div class="status-row"><span>Dispositivo</span><strong id="deviceState">—</strong></div>
          <div class="status-row"><span>Profundidad</span><strong id="modelState">Depth Anything V2 Small</strong></div>
          <div class="status-row"><span>Sujeto 360°</span><strong id="sf3dState">No detectado</strong></div>
        </div>
      </aside>

      <section class="panel stage-panel">
        <div class="stage-head">
          <div class="stage-title"><strong id="stageTitle">Visor 3D</strong><span id="stageSubtitle">Carga una foto para comenzar</span></div>
          <div class="toolbar">
            <div id="orbitPresets" class="orbit-presets" hidden>
              <button data-view="front" type="button">Frente</button>
              <button data-view="left" type="button">Izq.</button>
              <button data-view="right" type="button">Der.</button>
              <button data-view="back" type="button">Espalda</button>
              <button data-view="top" type="button">Arriba</button>
              <button data-view="bottom" type="button">Abajo</button>
            </div>
            <button id="pointsBtn" class="active" type="button">Puntos</button>
            <button id="meshBtn" type="button">Malla</button>
            <button id="invertBtn" type="button">Invertir Z</button>
            <label class="range-wrap">Profundidad <input id="depthRange" type="range" min="0.3" max="3.5" step="0.05" value="1.55" /></label>
            <button id="resetBtn" type="button">Recentrar</button>
          </div>
        </div>
        <div class="stage">
          <div id="viewer"></div>
          <div id="emptyStage" class="empty-stage"><div><strong>Tu foto todavía está en 2D</strong><span>El motor local convertirá profundidad en geometría navegable.</span></div></div>
          <div id="processing" class="processing"><div class="processing-card"><div class="spinner"></div><strong id="processingTitle">Procesando con GPU</strong><span id="processingText">Preparando el modelo local…</span></div></div>
          <div id="toast" class="toast"></div>
          <div class="help">Mouse: orbitar · rueda: zoom · WASD: mover · Q/E: bajar/subir</div>
        </div>
      </section>
    </section>
  </main>
`;

const els = Object.fromEntries([
  'fileInput','dropzone','dropEmpty','preview','depthBtn','objectBtn','quality360','foregroundRatio','orbitPresets','engineBadge','gpuBadge','engineState','deviceState','modelState','sf3dState','sf3dNote','processing','processingTitle','processingText','toast','emptyStage','stageTitle','stageSubtitle','pointsBtn','meshBtn','invertBtn','depthRange','resetBtn'
].map((id) => [id, document.getElementById(id)]));

const viewer = new SceneViewer(document.getElementById('viewer'));
let selectedFile = null;
let invert = false;

function setFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  selectedFile = file;
  const url = URL.createObjectURL(file);
  els.preview.src = url;
  els.preview.classList.add('visible');
  els.dropEmpty.style.display = 'none';
  els.depthBtn.disabled = false;
}

els.fileInput.addEventListener('change', (e) => setFile(e.target.files?.[0]));
['dragenter','dragover'].forEach((name) => els.dropzone.addEventListener(name, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach((name) => els.dropzone.addEventListener(name, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
els.dropzone.addEventListener('drop', (e) => setFile(e.dataTransfer?.files?.[0]));

function busy(show, title = '', text = '') {
  els.processing.classList.toggle('visible', show);
  if (title) els.processingTitle.textContent = title;
  if (text) els.processingText.textContent = text;
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.className = `toast visible${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 5200);
}

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  let body = null;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  return body;
}

async function refreshHealth() {
  try {
    const health = await api('/api/health');
    els.engineBadge.textContent = 'Motor local · listo';
    els.engineBadge.className = 'badge ok';
    els.engineState.textContent = 'Listo';
    els.deviceState.textContent = health.gpu?.name || health.device.toUpperCase();
    els.gpuBadge.textContent = health.device === 'cuda' ? `CUDA · ${health.gpu?.name || 'NVIDIA'}` : 'CPU · sin CUDA';
    els.gpuBadge.className = health.device === 'cuda' ? 'badge ok' : 'badge warn';
    els.modelState.textContent = health.model_id.split('/').pop();

    const sf = await api('/api/object360/status');
    els.sf3dState.textContent = sf.ready ? 'Listo' : 'No instalado';
    els.objectBtn.disabled = !selectedFile || !sf.ready;
    els.sf3dNote.textContent = sf.ready
      ? 'Stable Fast 3D está conectado. Este modo produce un GLB tridimensional independiente del fondo.'
      : 'Para activar 360°, ejecuta scripts/install-sf3d.ps1 una vez en Windows.';
  } catch (error) {
    els.engineBadge.textContent = 'Motor local · fuera de línea';
    els.engineBadge.className = 'badge warn';
    els.engineState.textContent = 'Sin conexión';
    els.gpuBadge.textContent = 'GPU · esperando motor';
  }
}

els.depthBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  busy(true, 'Convirtiendo foto en espacio 3D', 'Estimando profundidad con CUDA y reconstruyendo la geometría…');
  els.depthBtn.disabled = true;
  try {
    const form = new FormData();
    form.append('image', selectedFile);
    const result = await api('/api/scene/depth', { method: 'POST', body: form });
    await viewer.loadDepthScene(`data:image/png;base64,${result.image_png_b64}`, `data:image/png;base64,${result.depth_png_b64}`);
    els.emptyStage.style.display = 'none';
    els.stageTitle.textContent = 'Escena 3D reconstruida';
    els.stageSubtitle.textContent = `${result.width}×${result.height} · ${result.device.toUpperCase()} · profundidad relativa`;
    toast('Escena cargada. Ya puedes orbitar y desplazarte dentro de la reconstrucción.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    els.depthBtn.disabled = false;
  }
});

els.objectBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  busy(true, 'Generando sujeto tridimensional', 'Stable Fast 3D está reconstruyendo geometría y textura con la GPU local…');
  els.objectBtn.disabled = true;
  try {
    const form = new FormData();
    form.append('image', selectedFile);
    form.append('texture_resolution', els.quality360.value);
    form.append('foreground_ratio', els.foregroundRatio.value);
    const result = await api('/api/object360/generate', { method: 'POST', body: form });
    await viewer.loadGlb(`${API}${result.glb_url}`);
    els.emptyStage.style.display = 'none';
    els.stageTitle.textContent = 'Sujeto 360°';
    els.stageSubtitle.textContent = `GLB local · textura ${result.texture_resolution}px · órbita esférica`;
    els.orbitPresets.hidden = false;
    els.pointsBtn.hidden = true;
    els.meshBtn.hidden = true;
    els.invertBtn.hidden = true;
    els.depthRange.closest('label').hidden = true;
    toast('Sujeto 3D cargado. Puedes rodearlo horizontal y verticalmente.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    await refreshHealth();
  }
});

els.pointsBtn.addEventListener('click', () => {
  viewer.setMode('points');
  els.pointsBtn.classList.add('active');
  els.meshBtn.classList.remove('active');
});
els.meshBtn.addEventListener('click', () => {
  viewer.setMode('mesh');
  els.meshBtn.classList.add('active');
  els.pointsBtn.classList.remove('active');
});
els.invertBtn.addEventListener('click', () => {
  invert = !invert;
  viewer.setInverted(invert);
  els.invertBtn.classList.toggle('active', invert);
});
els.depthRange.addEventListener('input', () => viewer.setDepthScale(els.depthRange.value));
els.resetBtn.addEventListener('click', () => viewer.resetCamera());
for (const button of els.orbitPresets.querySelectorAll('button')) {
  button.addEventListener('click', () => viewer.setCameraPreset(button.dataset.view));
}


setInterval(refreshHealth, 5000);
refreshHealth();
