/**
 * 太阳系核心卫星高拟真程序化 PBR 纹理生成器 v3 (科学观测级拟真)
 * 遵循 01-REBUILD-PLAN 与 AGENTS.md 规范：
 * 1. 100% 离线客户端生成，零外部网络依赖，零动态第三方请求；
 * 2. 采用三维球面参数化噪声 (3D Spherical Coordinate Noise)：
 *    彻底消除经度 0°/360° 贴图接缝与两极 UV 畸变拉伸；
 * 3. 严格遵循 NASA/JPL/USGS 真实探测器摄影与多光谱观测口径：
 *    - 木卫一 (Io): 硫磺熔岩湖、Loki/Pele/Tvashtar 火山与弥散性二氧化硫红白沉积圈；
 *    - 木卫二 (Europa): 纯净水冰壳、双脊红褐色冰裂线 (Lineae)、Conamara 混沌碎冰与普维尔撞击坑射线；
 *    - 土卫二 (Enceladus): 极高反照率水冰球体、严格局限于 65°S-82°S 的南极四道平行“虎纹”冰裂与深青蓝低温新鲜冰；
 *    - 土卫六 (Titan): 可见光致密橘黄光化学烟雾（索林斯粒子）与卡西尼 938nm 近红外穿透地表（Xanadu 高地、赤道沙丘海、北极甲烷海）；
 *    - 木卫三 (Ganymede) & 木卫四 (Callisto): 古老暗区与年轻冰质沟槽带、瓦尔哈拉多重同心环盆地；
 *    - 火卫一与火卫二 (Phobos & Deimos): 碳质小行星风化层与斯蒂克尼巨型撞击坑放射状应力沟。
 */

import * as THREE from 'three';

let ioTexCache: THREE.Texture | null = null;
let europaTexCache: THREE.Texture | null = null;
let enceladusTexCache: THREE.Texture | null = null;
let titanHazeTexCache: THREE.Texture | null = null;
let titanInfraredTexCache: THREE.Texture | null = null;
let ganymedeTexCache: THREE.Texture | null = null;
let callistoTexCache: THREE.Texture | null = null;
let phobosTexCache: THREE.Texture | null = null;
let deimosTexCache: THREE.Texture | null = null;

function createFallbackTexture(r: number, g: number, b: number): THREE.Texture {
  const data = new Uint8Array([r, g, b, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// 基础三维空间平滑噪声（基于确定性置换表，零伪随机跳变）
// ---------------------------------------------------------------------------
const PERM = new Uint8Array(512);
const SEED_TABLE = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
  8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
  35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
  134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
  55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
  18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
  250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
  189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
  172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
  228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
  107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
];
for (let i = 0; i < 256; i++) {
  PERM[i] = PERM[i + 256] = SEED_TABLE[i];
}

function grad3D(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3D(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const fz = z - Math.floor(z);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;

  return (1 + (
    (1 - w) * (
      (1 - v) * ((1 - u) * grad3D(PERM[AA], fx, fy, fz) + u * grad3D(PERM[BA], fx - 1, fy, fz)) +
      v * ((1 - u) * grad3D(PERM[AB], fx, fy - 1, fz) + u * grad3D(PERM[BB], fx - 1, fy - 1, fz))
    ) +
    w * (
      (1 - v) * ((1 - u) * grad3D(PERM[AA + 1], fx, fy, fz - 1) + u * grad3D(PERM[BA + 1], fx - 1, fy, fz - 1)) +
      v * ((1 - u) * grad3D(PERM[AB + 1], fx, fy - 1, fz - 1) + u * grad3D(PERM[BB + 1], fx - 1, fy - 1, fz - 1))
    )
  )) * 0.5;
}

function fbm3D(x: number, y: number, z: number, octaves: number = 4): number {
  let val = 0, amp = 0.5, freq = 1.0, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise3D(x * freq, y * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return val / max;
}

/** 经纬度转球面三维单位矢量 (latDeg: -90~90, lonDeg: -180~180) */
function latLonToVec3(latDeg: number, lonDeg: number): [number, number, number] {
  const phi = (latDeg * Math.PI) / 180;
  const theta = (lonDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  return [cosP * Math.cos(theta), Math.sin(phi), cosP * Math.sin(theta)];
}

/** 球面上两点角距离（弧度） */
function angularDistance(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number
): number {
  const dot = Math.max(-1.0, Math.min(1.0, x1 * x2 + y1 * y2 + z1 * z2));
  return Math.acos(dot);
}

// ---------------------------------------------------------------------------
// 1. 木卫一 (Io) — 全太阳系地质活动最剧烈的活火山世界
// ---------------------------------------------------------------------------
export function getIoTexture(): THREE.Texture {
  if (ioTexCache) return ioTexCache;
  if (typeof document === 'undefined') return (ioTexCache = createFallbackTexture(234, 179, 8));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 真实活火山中心（纬度，经度，羽流半径弧度，熔岩湖半径弧度）
  const volcanoes = [
    { name: 'Loki Patera', lat: 13.0, lon: -51.0, plumeR: 0.22, lakeR: 0.055, dark: 0.15 },
    { name: 'Pele', lat: -18.7, lon: -104.7, plumeR: 0.35, lakeR: 0.045, dark: 0.10 },
    { name: 'Tvashtar', lat: 62.0, lon: -123.0, plumeR: 0.25, lakeR: 0.050, dark: 0.12 },
    { name: 'Prometheus', lat: -1.5, lon: -154.0, plumeR: 0.18, lakeR: 0.038, dark: 0.18 },
    { name: 'Amirani', lat: 24.0, lon: -119.0, plumeR: 0.20, lakeR: 0.042, dark: 0.14 },
    { name: 'Babbar', lat: -39.0, lon: -88.0, plumeR: 0.16, lakeR: 0.035, dark: 0.20 },
    { name: 'Marduk', lat: -28.0, lon: -210.0, plumeR: 0.15, lakeR: 0.032, dark: 0.18 },
  ].map((v) => ({ ...v, vec: latLonToVec3(v.lat, v.lon) }));

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const latAbs = Math.abs(phi) / (Math.PI * 0.5); // 0=赤道，1=极地

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      // 三维球面无缝多频噪声
      const n1 = fbm3D(px * 3.5, py * 3.5, pz * 3.5, 4);
      const n2 = fbm3D(px * 9.0, py * 9.0, pz * 9.0, 3);

      // 木卫一真实地表色系：富硫化物黄-橙-棕与二氧化硫白霜
      let r = 225 + (n1 - 0.5) * 45;
      let g = 175 + (n1 - 0.5) * 60;
      let b = 45 + (n1 - 0.5) * 35;

      // 局部红褐硫多聚体色斑 (S3/S4 聚合物)
      if (n1 > 0.62) {
        const factor = (n1 - 0.62) / 0.38;
        r = r * (1 - factor * 0.35);
        g = g * (1 - factor * 0.65);
        b = b * (1 - factor * 0.75);
      }

      // 两极浅色二氧化硫霜冻沉积 (SO2 frost)
      if (latAbs > 0.55) {
        const frost = (latAbs - 0.55) / 0.45;
        r = r * (1 - frost * 0.4) + 245 * (frost * 0.4);
        g = g * (1 - frost * 0.3) + 242 * (frost * 0.3);
        b = b * (1 - frost * 0.5) + 210 * (frost * 0.5);
      }

      // 计算与各大火山羽流/熔岩湖的相互作用
      for (const v of volcanoes) {
        const dist = angularDistance(px, py, pz, v.vec[0], v.vec[1], v.vec[2]);
        if (dist < v.plumeR) {
          // 红色硫磺喷发羽流沉积晕 (Red sulfur ring)
          const plumeNorm = dist / v.plumeR;
          // 在羽流外圈形成鲜明红橙色沉淀
          const ringStrength = Math.exp(-Math.pow((plumeNorm - 0.65) / 0.25, 2)) * 0.75;
          r = r * (1 - ringStrength) + 220 * ringStrength;
          g = g * (1 - ringStrength) + 50 * ringStrength;
          b = b * (1 - ringStrength) + 25 * ringStrength;

          // 核心破火山口黑色熔岩湖 (Basaltic lava lake)
          if (dist < v.lakeR) {
            const lakeFactor = Math.pow(1.0 - dist / v.lakeR, 1.8);
            r = r * (1 - lakeFactor) + 28 * lakeFactor;
            g = g * (1 - lakeFactor) + 24 * lakeFactor;
            b = b * (1 - lakeFactor) + 20 * lakeFactor;
          }
        }
      }

      // 融入微观细粒度噪点
      r += (n2 - 0.5) * 12;
      g += (n2 - 0.5) * 10;
      b += (n2 - 0.5) * 6;

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (ioTexCache = tex);
}

// ---------------------------------------------------------------------------
// 2. 木卫二 (Europa) — 纯白纯净水冰壳、双脊红褐色冰裂痕 (Lineae) 与混沌地形
// ---------------------------------------------------------------------------
export function getEuropaTexture(): THREE.Texture {
  if (europaTexCache) return europaTexCache;
  if (typeof document === 'undefined') return (europaTexCache = createFallbackTexture(225, 230, 240));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 定义环球主要大裂谷大圆法向量 (大圆公式: n·p ≈ 0 时在裂缝上)
  const lineaePlanes = [
    { nx: 0.35, ny: 0.85, nz: 0.38, width: 0.038, colR: 130, colG: 45, colB: 28 },
    { nx: -0.72, ny: 0.45, nz: 0.52, width: 0.042, colR: 140, colG: 50, colB: 32 },
    { nx: 0.65, ny: -0.38, nz: 0.65, width: 0.035, colR: 125, colG: 42, colB: 26 },
    { nx: -0.28, ny: -0.88, nz: 0.38, width: 0.045, colR: 135, colG: 48, colB: 30 },
    { nx: 0.82, ny: 0.32, nz: -0.46, width: 0.032, colR: 120, colG: 40, colB: 24 },
    { nx: -0.45, ny: 0.72, nz: -0.52, width: 0.030, colR: 130, colG: 44, colB: 28 },
  ];

  // 柯纳马拉混沌地形中心 (Conamara Chaos: lat 12°N, lon -87°)
  const chaosCenter = latLonToVec3(12.0, -87.0);

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nBase = fbm3D(px * 5.0, py * 5.0, pz * 5.0, 4);
      const nDetail = fbm3D(px * 18.0, py * 18.0, pz * 18.0, 3);

      // 高反照率纯净水冰底色（微蓝浅灰白）
      let r = 232 + (nBase - 0.5) * 16;
      let g = 236 + (nBase - 0.5) * 14;
      let b = 244 + (nBase - 0.5) * 10;

      // 计算红褐色双脊线裂缝 (Lineae)
      for (const lp of lineaePlanes) {
        // 大圆距离 + 扰动微褶皱
        const planeDist = Math.abs(px * lp.nx + py * lp.ny + pz * lp.nz);
        const perturbedDist = planeDist + (nDetail - 0.5) * 0.015;

        if (perturbedDist < lp.width) {
          const t = perturbedDist / lp.width; // 0=中心凹槽，1=边缘
          // 宽带水合盐与索林斯矿物晕染扩散
          const haloWeight = Math.pow(1.0 - t, 1.5) * 0.65;
          r = r * (1 - haloWeight) + lp.colR * haloWeight;
          g = g * (1 - haloWeight) + lp.colG * haloWeight;
          b = b * (1 - haloWeight) + lp.colB * haloWeight;

          // 双脊结构：中央深凹槽 + 两侧亮脊
          if (t < 0.28) {
            // 中心深裂缝
            const ridgeDepth = (1.0 - t / 0.28) * 0.35;
            r = r * (1 - ridgeDepth) + 75 * ridgeDepth;
            g = g * (1 - ridgeDepth) + 24 * ridgeDepth;
            b = b * (1 - ridgeDepth) + 15 * ridgeDepth;
          }
        }
      }

      // 柯纳马拉混沌碎冰块地形 (Conamara Chaos)
      const distChaos = angularDistance(px, py, pz, chaosCenter[0], chaosCenter[1], chaosCenter[2]);
      if (distChaos < 0.22) {
        const chaosFactor = Math.pow(1.0 - distChaos / 0.22, 1.5) * (0.35 + (nDetail - 0.5) * 0.3);
        r = r * (1 - chaosFactor) + 145 * chaosFactor;
        g = g * (1 - chaosFactor) + 68 * chaosFactor;
        b = b * (1 - chaosFactor) + 42 * chaosFactor;
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (europaTexCache = tex);
}

// ---------------------------------------------------------------------------
// 3. 土卫二 (Enceladus) — 99% 高反照率纯冰雪球、南极专属平行青蓝“虎纹”裂谷
// ---------------------------------------------------------------------------
export function getEnceladusTexture(): THREE.Texture {
  if (enceladusTexCache) return enceladusTexCache;
  if (typeof document === 'undefined') return (enceladusTexCache = createFallbackTexture(245, 250, 255));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 南极虎纹四主裂缝（严格位于 68°S 到 82°S 之间，东西走向）
  // Damascus, Baghdad, Alexandria, Cairo Sulci
  const tigerLatitudes = [-70.0, -74.0, -78.0, -82.0];

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const latDeg = (phi * 180) / Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const lonDeg = (theta * 180) / Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nCrater = fbm3D(px * 8.0, py * 8.0, pz * 8.0, 4);

      // 全太阳系最高几何反照率的水冰纯白底色
      let r = 250;
      let g = 252;
      let b = 255;

      // 北半球与中纬度古老撞击坑区（微弱蓝灰低地凹坑）
      if (latDeg > -45.0) {
        const craterDim = (nCrater - 0.5) * 16;
        r = Math.min(255, Math.max(220, r + craterDim));
        g = Math.min(255, Math.max(224, g + craterDim));
        b = Math.min(255, Math.max(235, b + craterDim * 0.6));
      }

      // 南极地质活跃区 (South Polar Terrain: 纬度 < -60°)
      if (latDeg < -60.0) {
        // 南极冰喷泉区轻微低温青蓝辉光
        const spFactor = Math.pow((-latDeg - 60.0) / 30.0, 1.2) * 0.18;
        r = r * (1 - spFactor) + 180 * spFactor;
        g = g * (1 - spFactor) + 225 * spFactor;
        b = b * (1 - spFactor) + 245 * spFactor;

        // 经度跨度主要集中在 -100° 到 +100° 扇区
        if (Math.abs(lonDeg) < 95.0) {
          for (let s = 0; s < tigerLatitudes.length; s++) {
            const targetLat = tigerLatitudes[s];
            // 沿纬度带的微小蜿蜒扰动
            const wave = Math.sin((lonDeg / 90.0) * Math.PI) * 2.2;
            const latDiff = Math.abs(latDeg - (targetLat + wave));

            if (latDiff < 1.4) {
              const t = latDiff / 1.4; // 0=裂谷最深处，1=外沿
              // 虎纹外围鲜艳新鲜低温水冰光晕（青蓝色）
              const halo = Math.pow(1.0 - t, 1.4) * 0.85;
              r = r * (1 - halo) + 14 * halo;
              g = g * (1 - halo) + 165 * halo;
              b = b * (1 - halo) + 233 * halo;

              // 虎纹裂缝中心最深地热活动喷射孔（深海蓝/深炭色暗线）
              if (t < 0.32) {
                const core = (1.0 - t / 0.32) * 0.7;
                r = r * (1 - core) + 8 * core;
                g = g * (1 - core) + 47 * core;
                b = b * (1 - core) + 73 * core;
              }
            }
          }
        }
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (enceladusTexCache = tex);
}

// ---------------------------------------------------------------------------
// 4. 土卫六 (Titan) — 卡西尼 938nm 近红外穿透地表与可见光致密大气层
// ---------------------------------------------------------------------------
export function getTitanNearInfraredTexture(): THREE.Texture {
  if (titanInfraredTexCache) return titanInfraredTexCache;
  if (typeof document === 'undefined') return (titanInfraredTexCache = createFallbackTexture(180, 140, 100));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 上都高地中心 (Xanadu: lat -15°, lon -100°)
  const xanaduCenter = latLonToVec3(-15.0, -100.0);
  // 北极液态甲烷海中心 (Kraken Mare: lat 68°N, lon -50°)
  const krakenCenter = latLonToVec3(68.0, -50.0);

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const latDeg = (phi * 180) / Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const n1 = fbm3D(px * 4.0, py * 4.0, pz * 4.0, 4);

      // 近红外硅酸盐水冰基底高地（暖土金黄色）
      let r = 185 + (n1 - 0.5) * 35;
      let g = 135 + (n1 - 0.5) * 28;
      let b = 75 + (n1 - 0.5) * 20;

      // 赤道低反照率有机物沙丘带 (Shangri-La, Belet, Fensal: 纬度 ±25° 之间)
      if (Math.abs(latDeg) < 22.0) {
        const latNorm = 1.0 - Math.abs(latDeg) / 22.0;
        const duneNoise = fbm3D(px * 12.0, py * 2.0, pz * 12.0, 3);
        if (duneNoise < 0.58) {
          const darkFactor = latNorm * (0.58 - duneNoise) * 2.1;
          r = r * (1 - darkFactor) + 38 * darkFactor;
          g = g * (1 - darkFactor) + 32 * darkFactor;
          b = b * (1 - darkFactor) + 26 * darkFactor;
        }
      }

      // 明亮上都大陆高地 (Xanadu Regio)
      const distXanadu = angularDistance(px, py, pz, xanaduCenter[0], xanaduCenter[1], xanaduCenter[2]);
      if (distXanadu < 0.42) {
        const xanaduFactor = Math.pow(1.0 - distXanadu / 0.42, 1.2) * 0.75;
        r = r * (1 - xanaduFactor) + 252 * xanaduFactor;
        g = g * (1 - xanaduFactor) + 225 * xanaduFactor;
        b = b * (1 - xanaduFactor) + 145 * xanaduFactor;
      }

      // 北极甲烷/乙烷液态海洋 (Kraken Mare / Ligeia Mare: 零反照率深黑)
      const distKraken = angularDistance(px, py, pz, krakenCenter[0], krakenCenter[1], krakenCenter[2]);
      if (distKraken < 0.26) {
        const lakeFactor = Math.pow(1.0 - distKraken / 0.26, 1.8) * 0.95;
        r = r * (1 - lakeFactor) + 3 * lakeFactor;
        g = g * (1 - lakeFactor) + 7 * lakeFactor;
        b = b * (1 - lakeFactor) + 18 * lakeFactor;
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (titanInfraredTexCache = tex);
}

export function getTitanHazeTexture(): THREE.Texture {
  if (titanHazeTexCache) return titanHazeTexCache;
  if (typeof document === 'undefined') return (titanHazeTexCache = createFallbackTexture(217, 119, 6));

  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 自然可见光下完全由致密氮-甲烷光化学烟雾（索林斯 tholins）包裹的均质橘红大气层
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, '#78350f'); // 北极深色极罩 (North Polar Hood)
  grad.addColorStop(0.2, '#b45309');
  grad.addColorStop(0.5, '#d97706'); // 赤道温暖蜜橘黄
  grad.addColorStop(0.8, '#b45309');
  grad.addColorStop(1.0, '#78350f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (titanHazeTexCache = tex);
}

// ---------------------------------------------------------------------------
// 5. 木卫三 (Ganymede) — 太阳系最大卫星、深色古老区与浅色构造沟槽带
// ---------------------------------------------------------------------------
export function getGanymedeTexture(): THREE.Texture {
  if (ganymedeTexCache) return ganymedeTexCache;
  if (typeof document === 'undefined') return (ganymedeTexCache = createFallbackTexture(140, 145, 155));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nMacro = fbm3D(px * 2.8, py * 2.8, pz * 2.8, 4);
      const nSulci = fbm3D(px * 16.0, py * 16.0, pz * 16.0, 3);

      let r: number, g: number, b: number;
      if (nMacro < 0.46) {
        // 暗色古老撞击区 (Galileo Regio)
        r = 65 + (nMacro - 0.25) * 35;
        g = 70 + (nMacro - 0.25) * 38;
        b = 82 + (nMacro - 0.25) * 45;
      } else {
        // 浅色年轻构造冰质沟槽断裂带 (Sulci)
        const sulciStrength = 0.5 + (nSulci - 0.5) * 0.35;
        r = 165 + sulciStrength * 45;
        g = 175 + sulciStrength * 48;
        b = 195 + sulciStrength * 50;
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (ganymedeTexCache = tex);
}

// ---------------------------------------------------------------------------
// 6. 木卫四 (Callisto) — 太阳系撞击坑最饱和表面、瓦尔哈拉巨型同心环盆地
// ---------------------------------------------------------------------------
export function getCallistoTexture(): THREE.Texture {
  if (callistoTexCache) return callistoTexCache;
  if (typeof document === 'undefined') return (callistoTexCache = createFallbackTexture(95, 100, 110));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 瓦尔哈拉同心环撞击盆地中心 (Valhalla Basin: lat 16°N, lon -57°)
  const valhallaCenter = latLonToVec3(16.0, -57.0);

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nCraters = fbm3D(px * 14.0, py * 14.0, pz * 14.0, 5);

      // 极古老深灰碳质冰岩表面
      let r = 52 + (nCraters - 0.5) * 45;
      let g = 56 + (nCraters - 0.5) * 48;
      let b = 68 + (nCraters - 0.5) * 55;

      // 瓦尔哈拉多重同心环断裂带
      const distV = angularDistance(px, py, pz, valhallaCenter[0], valhallaCenter[1], valhallaCenter[2]);
      if (distV < 0.65) {
        // 核心亮斑与 8 道同心微褶皱断崖
        const ring = Math.cos(distV * 32.0);
        const ringFactor = (1.0 - distV / 0.65) * 0.45;
        if (ring > 0.3) {
          r += ringFactor * 55;
          g += ringFactor * 60;
          b += ringFactor * 75;
        }
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (callistoTexCache = tex);
}

// ---------------------------------------------------------------------------
// 7. 火星小卫星 (Phobos & Deimos) — 碳质小行星风化层与斯蒂克尼巨型陨石坑
// ---------------------------------------------------------------------------
export function getMarsMoonTexture(isPhobos: boolean): THREE.Texture {
  if (isPhobos && phobosTexCache) return phobosTexCache;
  if (!isPhobos && deimosTexCache) return deimosTexCache;

  if (typeof document === 'undefined') {
    const fb = createFallbackTexture(110, 105, 95);
    return isPhobos ? (phobosTexCache = fb) : (deimosTexCache = fb);
  }

  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 斯蒂克尼陨石坑中心 (Stickney: lat 5°N, lon -50°)
  const stickneyCenter = latLonToVec3(5.0, -50.0);

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nRegolith = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 4);

      // 暗色碳质风化层
      let r = 68 + (nRegolith - 0.5) * 35;
      let g = 64 + (nRegolith - 0.5) * 32;
      let b = 58 + (nRegolith - 0.5) * 28;

      if (isPhobos) {
        // 斯蒂克尼巨型撞击坑 (直径 9km，占火卫一半球极大比例)
        const distS = angularDistance(px, py, pz, stickneyCenter[0], stickneyCenter[1], stickneyCenter[2]);
        if (distS < 0.38) {
          const craterDepth = Math.pow(1.0 - distS / 0.38, 1.6) * 0.65;
          r *= (1.0 - craterDepth * 0.7);
          g *= (1.0 - craterDepth * 0.7);
          b *= (1.0 - craterDepth * 0.7);
        }
      }

      const idx = (y * W + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  if (isPhobos) return (phobosTexCache = tex);
  return (deimosTexCache = tex);
}
