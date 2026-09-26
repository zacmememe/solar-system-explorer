import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { VehicleMeshBuilder } from '/builder.js';
import { profiles, prepareModel, setPresentationSpan, fitPresentationToViewport, assembleShuttle, configureTextureFiltering, refineMaterials, resourcesOf } from './model.mjs';

const $ = s => document.querySelector(s), stage = $('#stage');
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .001, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
stage.appendChild(renderer.domElement);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; controls.enablePan = false;
controls.minDistance = .25; controls.maxDistance = 30;
const environment = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const studioMap = environment.fromScene(room, .04).texture;
room.dispose(); environment.dispose();
const key = new THREE.DirectionalLight(0xffffff, 2), ambient = new THREE.AmbientLight(0xffffff, .15);
const fill = new THREE.DirectionalLight(0xffffff, .7); fill.position.set(0, 0, 2); camera.add(fill); camera.add(fill.target);
scene.add(key, key.target, ambient);
const decoder = new DRACOLoader(); decoder.setDecoderPath('/draco/');
async function loadCompleteModel(uri) {
  // GLTFLoader normally tolerates missing external textures. A quality sample
  // must fail visibly instead of silently presenting untextured white parts.
  const manager = new THREE.LoadingManager(), failed = [];
  manager.onError = url => failed.push(url);
  const gltf = await new GLTFLoader(manager).setDRACOLoader(decoder).loadAsync(uri);
  if (failed.length) { resourcesOf(gltf.scene)(); throw new Error('模型缺少贴图：' + failed.join(', ')); }
  return gltf;
}
let current = null, disposeCurrent = null, generation = 0, loadState = 'empty', changes = [], angles = 'front';
let referencePixels = null;
function canvasPixels() {
  const c = document.createElement('canvas'); c.width = renderer.domElement.width; c.height = renderer.domElement.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(renderer.domElement, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}
for (const [id, p] of Object.entries(profiles)) $('#vehicle').add(new Option(p.name, id));
$('#vehicle').value = 'cassini';

function resize() { const { width, height } = stage.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); composition(); render(); }
function lighting() {
  const mode = $('#lighting').value;
  scene.environment = mode === 'studio' ? studioMap : null; scene.environmentIntensity = .65;
  ambient.intensity = mode === 'studio' ? .15 : mode === 'assisted' ? .35 : 0;
  fill.intensity = mode === 'assisted' ? .7 : 0;
  const dirs = { front: [4, 6, 5], side: [-7, 2, 1], back: [-3, 2, -6] };
  key.position.set(...dirs[$('#sun').value]); render();
}
function composition() {
  if (!current) return;
  const formation = $('#view').value === 'formation'; controls.enabled = !formation;
  current.removeFromParent(); current.position.set(0, 0, 0); current.rotation.set(0, 0, 0);
  if (formation) {
    camera.position.set(0, 0, 0); camera.quaternion.identity();
    camera.add(current);
    current.position.set(Math.min(.48, Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2.1 * camera.aspect * .55), -.34, -2.1); current.rotation.set(.12, -.38, 0);
    fitPresentationToViewport(current, camera, profiles[$('#vehicle').value].span);
  } else {
    scene.add(current); setPresentationSpan(current, 4);
    const radius = new THREE.Box3().setFromObject(current).getBoundingSphere(new THREE.Sphere()).radius;
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    const d = radius / Math.sin(halfFov) * 1.12 * ($('#view').value === 'detail' ? .46 : 1);
    const positions = { front: [.8, .55, 1], rear: [-.8, .5, -1], belly: [.35, -1, .5] };
    camera.position.set(...positions[angles]).normalize().multiplyScalar(d);
    controls.target.set(0, 0, 0); controls.update(); camera.lookAt(0, 0, 0);
  }
  $('#description').textContent = profiles[$('#vehicle').value].note + ($('#view').value === 'detail' ? ' · 主体放大，长天线可能出框' : '');
  $('#planet').hidden = !formation; render();
}
function snapshot() {
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const box = current ? new THREE.Box3().setFromObject(current) : null, projected = [];
  if (box) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(new THREE.Vector3(x, y, z).project(camera).toArray());
  const materials = [], seen = new Set();
  current?.traverse(o => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !seen.has(m)) { seen.add(m); materials.push({ name: m.name, metalness: m.metalness, roughness: m.roughness, color: m.color?.toArray(), emissive: m.emissive?.toArray(), map: m.map?.name, normalMap: Boolean(m.normalMap), side: m.side }); } });
  return { id: $('#vehicle').value, variant: $('#variant').value, view: $('#view').value, lighting: $('#lighting').value, sun: $('#sun').value, angle: angles, state: loadState, changes, projected, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, memory: { ...renderer.info.memory }, scale: current?.scale.toArray(), metricScale: current?.children[0].scale.toArray(), materials, camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect }, lights: { key: key.intensity, keyPosition: key.position.toArray(), ambient: ambient.intensity, fill: fill.intensity, environment: Boolean(scene.environment) } };
}
function render() {
  renderer.render(scene, camera);
  $('#metrics').textContent = current ? `${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles\n原材质与修整版共用光照 / 非生产验收` : '';
}
async function load(packedPath) {
  const ticket = ++generation, id = $('#vehicle').value, variant = $('#variant').value;
  const packed = typeof packedPath === 'string' && packedPath.startsWith('/derived/');
  loadState = 'loading'; $('#status').textContent = '正在加载…';
  if (current) current.removeFromParent(); disposeCurrent?.(); current = null; disposeCurrent = null; renderer.renderLists.dispose(); render();
  try {
    let raw;
    if (packed) raw = (await loadCompleteModel(packedPath)).scene;
    else if (id === 'iss') raw = VehicleMeshBuilder.buildVehicle('iss');
    else if (id === 'shuttle-d' && ['assembled', 'refined'].includes(variant)) {
      const loaded = await Promise.allSettled(['shuttle-d', 'shuttle-d-door-prt', 'shuttle-d-door-stb', 'shuttle-d-eng', 'shuttle-d-rcs'].map(key => loadCompleteModel('/models/' + key + '.glb')));
      if (loaded.some(x => x.status === 'rejected')) {
        loaded.forEach(x => { if (x.status === 'fulfilled') resourcesOf(x.value.scene)(); });
        throw new Error('航天飞机附件不完整');
      }
      const [body, port, starboard, eng, rcs] = loaded.map(x => x.value.scene);
      raw = assembleShuttle({ body, port, starboard, eng, rcs });
    } else raw = (await loadCompleteModel('/models/' + id + '.glb')).scene;
    const release = resourcesOf(raw);
    if (ticket !== generation) { release(); return; }
    configureTextureFiltering(raw, renderer.capabilities.getMaxAnisotropy());
    changes = !packed && ['refined', 'materials-only'].includes(variant) && id !== 'iss' ? refineMaterials(raw, id) : [];
    try { current = prepareModel(raw, packed ? {} : profiles[id]); } catch (e) { release(); throw e; }
    disposeCurrent = release;
    loadState = 'ready'; $('#name').textContent = profiles[id].name; $('#description').textContent = profiles[id].note;
    $('#status').textContent = changes.length ? changes.join('；') : '保留原始材质。';
    composition(); lighting();
  } catch (e) { if (ticket !== generation) return; loadState = 'error'; $('#status').textContent = '加载失败，不使用替代模型：' + e.message; console.error(e); }
}
controls.addEventListener('change', render);
$('#vehicle').addEventListener('change', load); $('#variant').addEventListener('change', load);
$('#view').addEventListener('change', composition); $('#lighting').addEventListener('change', lighting); $('#sun').addEventListener('change', lighting);
document.querySelectorAll('[data-angle]').forEach(b => b.addEventListener('click', () => { angles = b.dataset.angle; composition(); }));
$('#reset').addEventListener('click', () => { angles = 'front'; composition(); });
new ResizeObserver(resize).observe(stage);
window.vehicleLab = { snapshot, ready: () => loadState === 'ready', raw: () => current,
  recordAppearance: () => { render(); referencePixels = canvasPixels(); },
  compareAppearance: () => {
    render(); const pixels = canvasPixels();
    if (!referencePixels || pixels.length !== referencePixels.length) throw new Error('No matching reference pixels');
    let total = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] || referencePixels[i + 3]) {
      for (let c = 0; c < 4; c++) total += Math.abs(pixels[i + c] - referencePixels[i + c]);
      count += 4;
    }
    referencePixels = null; return { meanAbsoluteError: total / Math.max(1, count), comparedChannels: count };
  },
  exportModel: async () => {
    if (!current || loadState !== 'ready') throw new Error('No complete model to export');
    // Exclude the presentation parent, camera, lights and diagnostic background.
    // An uncalibrated source unit remains uncalibrated; do not invent metres.
    const output = await new GLTFExporter().parseAsync(current.children[0], { binary: true });
    const bytes = new Uint8Array(output); let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(binary), sourceUnitSize: current.userData.size, profile: profiles[$('#vehicle').value], snapshot: snapshot() };
  },
  select: async settings => {
  for (const key of ['vehicle', 'variant', 'view', 'lighting', 'sun']) if (settings[key]) $('#' + key).value = settings[key];
  angles = settings.angle || 'front'; await load(settings.packedPath); return snapshot();
} };
resize(); await load();
