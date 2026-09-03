import './style.css';
import { SceneViewer } from './viewer.js';

const API = 'http://127.0.0.1:18787';

const app = document.querySelector('#app');
app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brandmark">3D</div>
        <div><h1>PhotoWorld 3D</h1><p>Foto → espacio 3D local con GPU</p></div>
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
          <button id="objectBtn" class="secondary" disabled>Generar 360° rápido</button>
        </div>

        <div class="settings-360 mode-card">
          <div class="mode-title">
            <div><strong>360° rápido</strong><span>Stable Fast 3D · una sola inferencia</span></div>
            <span class="mode-pill fast">Rápido</span>
          </div>
          <label>Calidad de textura
            <select id="quality360">
              <option value="1024" selected>Alta · textura 1024</option>
              <option value="2048">Máxima · textura 2048</option>
              <option value="512">Prueba rápida · textura 512</option>
            </select>
          </label>
          <label>Encuadre del sujeto
            <input id="foregroundRatio" type="range" min="0.65" max="0.92" step="0.01" value="0.85" />
          </label>
          <div id="sf3dNote" class="note compact">El modo rápido usa Stable Fast 3D.</div>
        </div>

        <div class="hq360-card mode-card">
          <div class="mode-title">
            <div><strong>360° Alta Fidelidad</strong><span>6 vistas IA → reconstrucción multivista</span></div>
            <span class="mode-pill hq">HD</span>
          </div>
          <label>Detalle de las vistas IA
            <select id="hqSteps">
              <option value="28">Rápido · 28 pasos</option>
              <option value="50">Equilibrado · 50 pasos</option>
              <option value="75" selected>Detalle humano · 75 pasos</option>
              <option value="100">Máximo detalle · 100 pasos</option>
            </select>
          </label>
          <label>Semilla
            <input id="hqSeed" class="number-input" type="number" min="0" max="2147483647" value="42" />
          </label>
          <div class="hq-actions">
            <button id="viewsBtn" class="secondary" disabled>1. Generar 6 vistas IA</button>
            <button id="reconstructBtn" class="primary" disabled>2. Reconstruir 360 HD</button>
          </div>
          <div id="hqNote" class="note compact">Instala el motor HD con scripts/install-hq360.ps1.</div>
          <div id="hqViews" class="views-grid" hidden></div>
        </div>

        <div class="status">
          <div class="status-row"><span>Motor IA</span><strong id="engineState">Fuera de línea</strong></div>
          <div class="status-row"><span>Dispositivo</span><strong id="deviceState">—</strong></div>
          <div class="status-row"><span>Profundidad</span><strong id="modelState">Depth Anything V2 Small</strong></div>
          <div class="status-row"><span>360° rápido</span><strong id="sf3dState">No detectado</strong></div>
          <div class="status-row"><span>360° HD</span><strong id="hqState">No detectado</strong></div>
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
            <label id="depthWrap" class="range-wrap">Profundidad <input id="depthRange" type="range" min="0.3" max="3.5" step="0.05" value="1.55" /></label>
            <button id="resetBtn" type="button">Recentrar</button>
          </div>
        </div>
        <div class="stage">
          <div id="viewer"></div>
          <div id="emptyStage" class="empty-stage"><div><strong>Tu foto todavía está en 2D</strong><span>Elige escena 3D, 360° rápido o el nuevo modo 360° HD.</span></div></div>
          <div id="processing" class="processing"><div class="processing-card"><div class="spinner"></div><strong id="processingTitle">Procesando con GPU</strong><span id="processingText">Preparando el modelo local…</span></div></div>
          <div id="toast" class="toast"></div>
          <div class="help">Mouse: orbitar · rueda: zoom · WASD: mover · Q/E: bajar/subir</div>
        </div>
      </section>
    </section>
  </main>
`;

const els = Object.fromEntries([
  'fileInput','dropzone','dropEmpty','preview','depthBtn','objectBtn','quality360','foregroundRatio',
  'hqSteps','hqSeed','viewsBtn','reconstructBtn','hqViews','hqNote',
  'orbitPresets','engineBadge','gpuBadge','engineState','deviceState','modelState','sf3dState','hqState',
  'sf3dNote','processing','processingTitle','processingText','toast','emptyStage','stageTitle','stageSubtitle',
  'pointsBtn','meshBtn','invertBtn','depthRange','depthWrap','resetBtn'
].map((id) => [id, document.getElementById(id)]));

const viewer = new SceneViewer(document.getElementById('viewer'));
let selectedFile = null;
let invert = false;
let sfReady = false;
let hqReady = false;
let hqSessionId = null;

function updateButtons() {
  els.depthBtn.disabled = !selectedFile;
  els.objectBtn.disabled = !selectedFile || !sfReady;
  els.viewsBtn.disabled = !selectedFile || !hqReady;
  els.reconstructBtn.disabled = !hqReady || !hqSessionId;
}

function resetHqSession() {
  hqSessionId = null;
  els.hqViews.hidden = true;
  els.hqViews.innerHTML = '';
  updateButtons();
}

function setFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  selectedFile = file;
  resetHqSession();
  const url = URL.createObjectURL(file);
  els.preview.src = url;
  els.preview.classList.add('visible');
  els.dropEmpty.style.display = 'none';
  updateButtons();
}

els.fileInput.addEventListener('change', (e) => setFile(e.target.files?.[0]));
['dragenter','dragover'].forEach((name) => els.dropzone.addEventListener(name, (e) => {
  e.preventDefault();
  els.dropzone.classList.add('drag');
}));
['dragleave','drop'].forEach((name) => els.dropzone.addEventListener(name, (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('drag');
}));
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
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 6500);
}

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  let body = null;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  return body;
}

function setStageKind(kind) {
  const isGlb = kind === 'glb';
  els.orbitPresets.hidden = !isGlb;
  els.pointsBtn.hidden = isGlb;
  els.meshBtn.hidden = isGlb;
  els.invertBtn.hidden = isGlb;
  els.depthWrap.hidden = isGlb;
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

    const [sf, hq] = await Promise.all([
      api('/api/object360/status'),
      api('/api/hq360/status'),
    ]);

    sfReady = Boolean(sf.ready);
    hqReady = Boolean(hq.ready);

    els.sf3dState.textContent = sfReady ? 'Listo' : 'No instalado';
    els.sf3dNote.textContent = sfReady
      ? 'Stable Fast 3D conectado. Ideal para previsualizaciones rápidas.'
      : 'Para activar el modo rápido, ejecuta scripts/install-sf3d.ps1.';

    els.hqState.textContent = hqReady ? 'Listo' : 'No instalado';
    els.hqNote.textContent = hqReady
      ? 'InstantMesh conectado. Primero genera 6 vistas coherentes y luego reconstruye el GLB.'
      : 'Para activar Alta Fidelidad, ejecuta scripts/install-hq360.ps1 una vez.';

    updateButtons();
  } catch (error) {
    sfReady = false;
    hqReady = false;
    els.engineBadge.textContent = 'Motor local · fuera de línea';
    els.engineBadge.className = 'badge warn';
    els.engineState.textContent = 'Sin conexión';
    els.gpuBadge.textContent = 'GPU · esperando motor';
    updateButtons();
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
    setStageKind('depth');
    els.emptyStage.style.display = 'none';
    els.stageTitle.textContent = 'Escena 3D reconstruida';
    els.stageSubtitle.textContent = `${result.width}×${result.height} · ${result.device.toUpperCase()} · profundidad relativa`;
    toast('Escena cargada. Ya puedes orbitar y desplazarte dentro de la reconstrucción.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    updateButtons();
  }
});

els.objectBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  busy(true, 'Generando 360° rápido', 'Stable Fast 3D está reconstruyendo geometría y textura con la GPU local…');
  els.objectBtn.disabled = true;
  try {
    const form = new FormData();
    form.append('image', selectedFile);
    form.append('texture_resolution', els.quality360.value);
    form.append('foreground_ratio', els.foregroundRatio.value);
    const result = await api('/api/object360/generate', { method: 'POST', body: form });
    await viewer.loadGlb(`${API}${result.glb_url}`);
    setStageKind('glb');
    els.emptyStage.style.display = 'none';
    els.stageTitle.textContent = 'Sujeto 360° rápido';
    els.stageSubtitle.textContent = `Stable Fast 3D · textura ${result.texture_resolution}px · órbita esférica`;
    toast('360° rápido cargado. El modo HD puede mejorar la geometría usando seis vistas.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    await refreshHealth();
  }
});

function renderHqViews(views) {
  els.hqViews.innerHTML = views.map((view) => `
    <figure class="view-card">
      <img src="${API}${view.url}" alt="Vista ${view.azimuth} grados" />
      <figcaption><strong>${view.azimuth}°</strong><span>${view.elevation >= 0 ? '+' : ''}${view.elevation}° elev.</span></figcaption>
    </figure>
  `).join('');
  els.hqViews.hidden = false;
}

els.viewsBtn.addEventListener('click', async () => {
  if (!selectedFile || !hqReady) return;
  resetHqSession();
  busy(
    true,
    'Generando seis vistas coherentes',
    'Zero123++ + InstantMesh están imaginando los lados ocultos. La primera ejecución también puede descargar varios GB de modelos…'
  );
  els.viewsBtn.disabled = true;
  try {
    const form = new FormData();
    form.append('image', selectedFile);
    form.append('diffusion_steps', els.hqSteps.value);
    form.append('foreground_ratio', els.foregroundRatio.value);
    form.append('seed', els.hqSeed.value || '42');
    const result = await api('/api/hq360/views', { method: 'POST', body: form });
    hqSessionId = result.session_id;
    renderHqViews(result.views);
    els.stageTitle.textContent = 'Vistas IA listas';
    els.stageSubtitle.textContent = `6 cámaras sintéticas · ${result.diffusion_steps} pasos · sesión ${result.session_id}`;
    toast('Las seis vistas están listas. Revísalas y pulsa “Reconstruir 360 HD”.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    updateButtons();
  }
});

els.reconstructBtn.addEventListener('click', async () => {
  if (!hqSessionId || !hqReady) return;
  busy(
    true,
    'Reconstruyendo 360° Alta Fidelidad',
    'InstantMesh está fusionando las seis vistas en una malla texturizada. Esta etapa usa bastante VRAM…'
  );
  els.reconstructBtn.disabled = true;
  try {
    const form = new FormData();
    form.append('session_id', hqSessionId);
    const result = await api('/api/hq360/reconstruct', { method: 'POST', body: form });
    await viewer.loadGlb(`${API}${result.glb_url}`);
    setStageKind('glb');
    els.emptyStage.style.display = 'none';
    els.stageTitle.textContent = 'Sujeto 360° Alta Fidelidad';
    const meshInfo = result.vertices_hint && result.faces_hint
      ? ` · ${result.vertices_hint.toLocaleString()} vértices · ${result.faces_hint.toLocaleString()} caras`
      : '';
    els.stageSubtitle.textContent = `InstantMesh multivista · GLB local${meshInfo}`;
    toast('Reconstrucción HD cargada. Ahora puedes inspeccionar frente, perfil, espalda, arriba y abajo.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(false);
    updateButtons();
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
