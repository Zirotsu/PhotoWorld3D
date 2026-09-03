import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class SceneViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 4.3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x273249, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(3, 4, 5);
    this.scene.add(key);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.grid = new THREE.GridHelper(12, 24, 0x263348, 0x182131);
    this.grid.position.y = -1.55;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.mode = 'points';
    this.depthScale = 1.55;
    this.inverted = false;
    this.cached = null;
    this.keys = new Set();
    this.lastFrame = performance.now();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.bindKeys();
    this.animate();
  }

  bindKeys() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', () => canvas.focus());
    canvas.addEventListener('keydown', (event) => {
      if (['w','a','s','d','q','e'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        this.keys.add(event.key.toLowerCase());
      }
    });
    canvas.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
    canvas.addEventListener('blur', () => this.keys.clear());
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  clearRoot() {
    this.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if (mat.map) mat.map.dispose();
          mat.dispose?.();
        });
      }
    });
    this.root.clear();
  }

  async loadDepthScene(imageUrl, depthUrl) {
    const [image, depth] = await Promise.all([this.loadImage(imageUrl), this.loadImage(depthUrl)]);
    const maxCols = 220;
    const aspect = image.width / image.height;
    const cols = Math.min(maxCols, image.width);
    const rows = Math.max(2, Math.round(cols / aspect));

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = cols;
    colorCanvas.height = rows;
    const cctx = colorCanvas.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(image, 0, 0, cols, rows);
    const colorData = cctx.getImageData(0, 0, cols, rows).data;

    const depthCanvas = document.createElement('canvas');
    depthCanvas.width = cols;
    depthCanvas.height = rows;
    const dctx = depthCanvas.getContext('2d', { willReadFrequently: true });
    dctx.drawImage(depth, 0, 0, cols, rows);
    const depthData = dctx.getImageData(0, 0, cols, rows).data;

    this.cached = { cols, rows, aspect, colorData, depthData };
    this.grid.visible = false;
    this.rebuildDepthGeometry();
  }

  rebuildDepthGeometry() {
    if (!this.cached) return;
    this.clearRoot();
    const { cols, rows, aspect, colorData, depthData } = this.cached;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const depths = new Float32Array(cols * rows);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const i = y * cols + x;
        const ci = i * 4;
        let d = depthData[ci] / 255;
        if (this.inverted) d = 1 - d;
        depths[i] = d;
        const z = (d - 0.5) * this.depthScale;
        positions[i * 3] = ((x / (cols - 1)) - 0.5) * 2.6 * aspect;
        positions[i * 3 + 1] = (0.5 - (y / (rows - 1))) * 2.6;
        positions[i * 3 + 2] = z;
        colors[i * 3] = colorData[ci] / 255;
        colors[i * 3 + 1] = colorData[ci + 1] / 255;
        colors[i * 3 + 2] = colorData[ci + 2] / 255;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    if (this.mode === 'mesh') {
      const indices = [];
      const threshold = 0.09;
      for (let y = 0; y < rows - 1; y += 1) {
        for (let x = 0; x < cols - 1; x += 1) {
          const a = y * cols + x;
          const b = a + 1;
          const c = a + cols;
          const d = c + 1;
          const max1 = Math.max(depths[a], depths[b], depths[c]);
          const min1 = Math.min(depths[a], depths[b], depths[c]);
          const max2 = Math.max(depths[b], depths[d], depths[c]);
          const min2 = Math.min(depths[b], depths[d], depths[c]);
          if (max1 - min1 < threshold) indices.push(a, c, b);
          if (max2 - min2 < threshold) indices.push(b, c, d);
        }
      }
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide
      });
      this.root.add(new THREE.Mesh(geometry, material));
    } else {
      const material = new THREE.PointsMaterial({
        size: Math.max(0.008, 0.018 * (220 / cols)),
        sizeAttenuation: true,
        vertexColors: true
      });
      this.root.add(new THREE.Points(geometry, material));
    }
    this.resetCamera();
  }

  async loadGlb(url) {
    this.clearRoot();
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    this.root.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.6 / longest;
    model.scale.setScalar(scale);
    const newBox = new THREE.Box3().setFromObject(model);
    const minY = newBox.min.y;
    model.position.y -= minY + 1.35;
    this.grid.visible = true;
    this.resetCamera();
  }

  setMode(mode) {
    if (!['points', 'mesh'].includes(mode)) return;
    this.mode = mode;
    this.rebuildDepthGeometry();
  }

  setDepthScale(value) {
    this.depthScale = Math.min(4, Math.max(0.15, Number(value) || 1.55));
    this.rebuildDepthGeometry();
  }

  setInverted(value) {
    this.inverted = Boolean(value);
    this.rebuildDepthGeometry();
  }

  resetCamera() {
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 0, 4.3);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setCameraPreset(view) {
    const distance = 4.3;
    const target = new THREE.Vector3(0, 0, 0);
    const positions = {
      front: new THREE.Vector3(0, 0, distance),
      back: new THREE.Vector3(0, 0, -distance),
      left: new THREE.Vector3(-distance, 0, 0),
      right: new THREE.Vector3(distance, 0, 0),
      top: new THREE.Vector3(0, distance, 0.001),
      bottom: new THREE.Vector3(0, -distance, 0.001),
    };
    const position = positions[view];
    if (!position) return;
    // A tiny Z offset prevents the top/bottom camera from becoming singular.
    this.camera.up.set(0, 1, 0);
    if (view === 'top') this.camera.up.set(0, 0, -1);
    if (view === 'bottom') this.camera.up.set(0, 0, 1);
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  updateMovement(delta) {
    if (!this.keys.size) return;
    const speed = 1.6 * delta;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has('w')) move.add(forward);
    if (this.keys.has('s')) move.sub(forward);
    if (this.keys.has('d')) move.add(right);
    if (this.keys.has('a')) move.sub(right);
    if (this.keys.has('e')) move.y += 1;
    if (this.keys.has('q')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
  }

  animate = () => {
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.updateMovement(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };
}
