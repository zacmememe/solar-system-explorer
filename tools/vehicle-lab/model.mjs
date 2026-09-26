import * as THREE from 'three';

export const profiles = {
  iss: { name: '国际空间站', note: '当前外观基准', rotation: [0, 0, 0], span: .6375 },
  cassini: { name: '卡西尼', note: 'NASA 模型 · 材质与取景样机', rotation: [0, 0, 0], span: .82 },
  'shuttle-d': { name: '航天飞机', note: 'NASA D · 尾部斜后方伴飞', rotation: [-Math.PI / 2, -Math.PI / 2, 0], formationRotation: [.24, Math.PI + .58, 0], span: .6375 },
  voyager: { name: '旅行者', note: '原材质 · 细长结构取景检查', rotation: [0, 0, 0], span: .95 },
  juno: { name: '朱诺', note: 'NASA 模型 · 太阳翼反射材质修正', rotation: [Math.PI / 3, 0, .25], span: .8 },
};

/** metricRoot retains calibration; presentationRoot alone controls apparent size. */
export function prepareModel(raw, { rotation = [0, 0, 0], metricScale = 1 } = {}) {
  if (!Number.isFinite(metricScale) || metricScale <= 0) throw new Error('Invalid metric scale');
  const metricRoot = new THREE.Group();
  metricRoot.name = 'metricRoot';
  const oriented = new THREE.Group(); oriented.add(raw); metricRoot.add(oriented);
  oriented.rotation.set(...rotation, 'YXZ');
  oriented.updateMatrixWorld(true);
  const originalBox = new THREE.Box3().setFromObject(oriented);
  if (originalBox.isEmpty()) throw new Error('Empty vehicle geometry');
  const center = originalBox.getCenter(new THREE.Vector3());
  oriented.position.sub(center);
  metricRoot.scale.setScalar(metricScale);
  metricRoot.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(metricRoot).getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) throw new Error('Invalid vehicle bounds');
  const root = new THREE.Group();
  root.name = 'presentationRoot';
  root.add(metricRoot);
  root.userData = { maxDim, size: size.toArray(), metricScale };
  return root;
}

// Source-unit circles measured from the hash-pinned body and accessory geometry.
// body POSITION accessors 60 (3 main mounts), 120/124 (OMS mounts).
// These are attachment coordinates, not metre dimensions or historical gimbal states.
export const shuttleMounts = [
  { part: 'eng', center: [-498.616407, .040460, 64.745241], normal: [-.966709, .000050, .255878] },
  { part: 'eng', center: [-523.191267, -56.032769, -47.808479], normal: [-.984422, .000035, .175822] },
  { part: 'eng', center: [-523.191267, 55.306991, -48.045397], normal: [-.984421, 0, .175829] },
  { part: 'rcs', center: [-516.056732, -87.228930, 101.897374], normal: [-.999931, 0, .011740] },
  { part: 'rcs', center: [-515.989314, 87.718092, 101.914350], normal: [-.999897, .000001, .014346] },
];
export function assembleShuttle(parts) {
  const raw = new THREE.Group();
  raw.add(parts.body, parts.port, parts.starboard);
  const sourceNormal = new THREE.Vector3(-.999968, -.007987, .00000105).normalize();
  const used = new Set();
  for (const [i, mount] of shuttleMounts.entries()) {
    const holder = new THREE.Group(); holder.name = 'nozzle-mount-' + i;
    const sourceCenter = new THREE.Vector3(5.754056, -.217610, -.092874).multiplyScalar(mount.part === 'rcs' ? .5 : 1);
    holder.quaternion.setFromUnitVectors(sourceNormal, new THREE.Vector3(...mount.normal).normalize());
    holder.position.fromArray(mount.center).sub(sourceCenter.applyQuaternion(holder.quaternion));
    // Clone only the scene graph; retain shared source geometry/material/texture.
    holder.add(used.has(mount.part) ? parts[mount.part].clone(true) : parts[mount.part]); used.add(mount.part);
    raw.add(holder);
  }
  return raw;
}

export function setPresentationSpan(root, span) {
  if (!Number.isFinite(span) || span <= 0) throw new Error('Invalid presentation span');
  root.scale.setScalar(span / root.userData.maxDim);
  root.updateMatrixWorld(true);
}

/** Keep appendages in frame without changing the camera or the calibrated child. */
export function fitPresentationToViewport(root, camera, span, margin = .92) {
  const fits = () => {
    root.updateWorldMatrix(true, true); camera.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      if (![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.x) > margin || Math.abs(p.y) > margin || Math.abs(p.z) >= 1) return false;
    }
    return true;
  };
  setPresentationSpan(root, span);
  if (fits()) return span;
  let low = span * .000001, high = span;
  setPresentationSpan(root, low);
  if (!fits()) throw new Error('Presentation anchor is outside the view');
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2; setPresentationSpan(root, middle);
    if (fits()) low = middle; else high = middle;
  }
  setPresentationSpan(root, low); return low;
}

export function configureTextureFiltering(raw, maxAnisotropy = 8) {
  const seen = new Set();
  raw.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) {
      for (const value of Object.values(m)) if (value?.isTexture && !seen.has(value)) {
        seen.add(value); value.anisotropy = Math.min(8, maxAnisotropy);
      }
    }
  });
}

export function refineMaterials(raw, id) {
  const changes = [], visited = new Set();
  raw.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || visited.has(m)) continue;
      visited.add(m);
      if (id === 'shuttle-d' && m.name === 'shut-bay' && m.normalMap) {
        // The source assigns the same colour image to baseColor and tangent normals.
        m.normalMap = null;
        changes.push('shut-bay: removed colour-image normal map');
      }
      if (id === 'cassini' && (m.name === 'foil_gold' || m.name === 'foil_gold_2')) {
        // GLTFLoader flips Y for meshes using derivative tangents. Preserve that
        // sign when changing strength, or folds invert again after GLB round-trip.
        m.normalScale.set(1.2 * Math.sign(m.normalScale.x || 1), 1.2 * Math.sign(m.normalScale.y || 1));
        m.roughness = .36;
        changes.push(m.name + ': foil normals 2→1.2, roughness 0.30→0.36');
      }
      if (id === 'juno' && (m.name === 'shiny_panels' || m.name === 'solar_panels')) {
        // Covered photovoltaic cells are not solid metal plates. Keep the source
        // colour, texture and roughness; restore their diffuse response without
        // emission or brighter scene lighting. This is a visual approximation,
        // not a measured optical model of Juno's multilayer solar cells.
        m.metalness = 0;
        changes.push(m.name + ': covered-cell surface, metalness 1→0');
      }
      m.needsUpdate = true;
    }
  });
  return changes;
}

/** Record even unused source textures before a material edit, then dispose once. */
export function resourcesOf(raw) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  raw.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  return () => {
    geometries.forEach(x => x.dispose());
    textures.forEach(x => { x.dispose(); x.source?.data?.close?.(); });
    materials.forEach(x => x.dispose());
    raw.removeFromParent();
  };
}
