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

  // 真实活火山数据库（纬度，经度，羽流沉降半径弧度，破火山口熔岩湖半径弧度）
  const volcanoes = [
    { name: 'Loki Patera', lat: 13.0, lon: -51.0, plumeR: 0.28, lakeR: 0.075, ringCol: [200, 75, 20] },
    { name: 'Pele', lat: -18.7, lon: -104.7, plumeR: 0.48, lakeR: 0.048, ringCol: [225, 30, 15] },
    { name: 'Tvashtar', lat: 62.0, lon: -123.0, plumeR: 0.28, lakeR: 0.055, ringCol: [215, 60, 18] },
    { name: 'Prometheus', lat: -1.5, lon: -154.0, plumeR: 0.22, lakeR: 0.040, ringCol: [210, 85, 25] },
    { name: 'Amirani', lat: 24.0, lon: -119.0, plumeR: 0.24, lakeR: 0.045, ringCol: [205, 70, 22] },
    { name: 'Babbar', lat: -39.0, lon: -88.0, plumeR: 0.18, lakeR: 0.038, ringCol: [195, 75, 28] },
    { name: 'Pillan', lat: -12.3, lon: -243.2, plumeR: 0.26, lakeR: 0.050, ringCol: [218, 45, 16] },
    { name: 'Tupan', lat: -18.7, lon: -141.1, plumeR: 0.20, lakeR: 0.042, ringCol: [205, 65, 20] },
    { name: 'Culann', lat: -20.2, lon: -160.1, plumeR: 0.22, lakeR: 0.044, ringCol: [210, 55, 18] },
    { name: 'Marduk', lat: -28.0, lon: -210.0, plumeR: 0.18, lakeR: 0.035, ringCol: [190, 80, 24] },
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

      // 三维球面无缝多频高保真噪声
      const n1 = fbm3D(px * 3.5, py * 3.5, pz * 3.5, 4);
      const n2 = fbm3D(px * 8.5, py * 8.5, pz * 8.5, 3);
      const nDetail = fbm3D(px * 24.0, py * 24.0, pz * 24.0, 2);

      // 木卫一标志性色系：富硫化物柠檬黄-芥末黄-橙色基底
      let r = 232 + (n1 - 0.5) * 40;
      let g = 188 + (n1 - 0.5) * 55;
      let b = 48 + (n1 - 0.5) * 32;

      // 局部红褐硫多聚体色斑 (S3/S4 聚合物火山沉降)
      if (n1 > 0.58) {
        const factor = (n1 - 0.58) / 0.42;
        r = r * (1 - factor * 0.30) + 195 * (factor * 0.30);
        g = g * (1 - factor * 0.60) + 75 * (factor * 0.60);
        b = b * (1 - factor * 0.75) + 20 * (factor * 0.75);
      }

      // 两极浅色二氧化硫霜冻沉积 (SO2 frost fields, 纯净淡黄白)
      if (latAbs > 0.50) {
        const frost = (latAbs - 0.50) / 0.50;
        r = r * (1 - frost * 0.5) + 248 * (frost * 0.5);
        g = g * (1 - frost * 0.4) + 246 * (frost * 0.4);
        b = b * (1 - frost * 0.6) + 225 * (frost * 0.6);
      }

      // 计算各大活火山羽流环沉降与核心熔岩湖
      for (const v of volcanoes) {
        const dist = angularDistance(px, py, pz, v.vec[0], v.vec[1], v.vec[2]);
        if (dist < v.plumeR) {
          const plumeNorm = dist / v.plumeR;
          // Pele 火山专属：巨大跨越上千公里的鲜艳红橙色同心沉降环
          const ringStrength = Math.exp(-Math.pow((plumeNorm - 0.68) / 0.22, 2)) * 0.85;
          r = r * (1 - ringStrength) + v.ringCol[0] * ringStrength;
          g = g * (1 - ringStrength) + v.ringCol[1] * ringStrength;
          b = b * (1 - ringStrength) + v.ringCol[2] * ringStrength;

          // 核心破火山口超深黑色熔岩湖 (Basaltic lava lake, RGB 极低以配合黑夜侧熔岩自发光着色)
          if (dist < v.lakeR) {
            const lakeFactor = Math.pow(1.0 - dist / v.lakeR, 1.6);
            r = r * (1 - lakeFactor) + 22 * lakeFactor;
            g = g * (1 - lakeFactor) + 18 * lakeFactor;
            b = b * (1 - lakeFactor) + 16 * lakeFactor;
          }
        }
      }

      // 微观颗粒质感
      r += (n2 - 0.5) * 10 + (nDetail - 0.5) * 8;
      g += (n2 - 0.5) * 8 + (nDetail - 0.5) * 6;
      b += (n2 - 0.5) * 5 + (nDetail - 0.5) * 4;

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

  // 1. 环球主要大裂谷与次级双脊裂隙大圆法向量 (16道多尺度潮汐裂隙网络)
  const lineaePlanes = [
    { nx: 0.35, ny: 0.85, nz: 0.38, width: 0.024, colR: 155, colG: 50, colB: 30, doubleRidge: true },
    { nx: -0.72, ny: 0.45, nz: 0.52, width: 0.026, colR: 160, colG: 54, colB: 32, doubleRidge: true },
    { nx: 0.65, ny: -0.38, nz: 0.65, width: 0.022, colR: 145, colG: 46, colB: 28, doubleRidge: true },
    { nx: -0.28, ny: -0.88, nz: 0.38, width: 0.028, colR: 152, colG: 52, colB: 32, doubleRidge: true },
    { nx: 0.82, ny: 0.32, nz: -0.46, width: 0.020, colR: 138, colG: 44, colB: 26, doubleRidge: true },
    { nx: -0.45, ny: 0.72, nz: -0.52, width: 0.022, colR: 148, colG: 48, colB: 30, doubleRidge: true },
    { nx: 0.15, ny: -0.92, nz: -0.35, width: 0.014, colR: 136, colG: 46, colB: 28, doubleRidge: false },
    { nx: -0.55, ny: -0.25, nz: 0.79, width: 0.013, colR: 140, colG: 48, colB: 30, doubleRidge: false },
    { nx: 0.42, ny: 0.65, nz: -0.63, width: 0.015, colR: 130, colG: 42, colB: 26, doubleRidge: false },
    { nx: -0.85, ny: 0.12, nz: -0.51, width: 0.012, colR: 132, colG: 44, colB: 28, doubleRidge: false },
    { nx: 0.22, ny: 0.48, nz: 0.85, width: 0.016, colR: 146, colG: 52, colB: 32, doubleRidge: false },
    { nx: -0.38, ny: 0.82, nz: 0.43, width: 0.011, colR: 125, colG: 40, colB: 24, doubleRidge: false },
    { nx: 0.71, ny: -0.62, nz: -0.33, width: 0.013, colR: 138, colG: 48, colB: 30, doubleRidge: false },
    { nx: -0.18, ny: 0.35, nz: -0.92, width: 0.015, colR: 136, colG: 46, colB: 28, doubleRidge: false },
    { nx: 0.58, ny: 0.75, nz: 0.31, width: 0.012, colR: 128, colG: 42, colB: 26, doubleRidge: false },
    { nx: -0.68, ny: -0.55, nz: 0.48, width: 0.014, colR: 134, colG: 44, colB: 28, doubleRidge: false },
  ];

  // 2. 柯纳马拉混沌地形中心 (Conamara Chaos: lat 12°N, lon -87°)
  const chaosCenter1 = latLonToVec3(12.0, -87.0);
  const chaosCenter2 = latLonToVec3(-22.0, 45.0);

  // 3. 普维尔年轻冰溅巨型撞击坑 (Pwyll Crater: lat -25.2°, lon -88.6°)
  const pwyllCenter = latLonToVec3(-25.2, -88.6);
  const pwyllR = 0.045; // 撞击坑碗与中央暗环
  const pwyllRayR = 0.52; // 千公里冰溅辐射纹跨度

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

      // 全球纯净水冰壳底色（冷亮浅灰白，Albedo ~0.67）
      let r = 238 + (nBase - 0.5) * 14;
      let g = 242 + (nBase - 0.5) * 12;
      let b = 250 + (nBase - 0.5) * 8;

      // 计算红褐色双脊线裂缝网络 (Cycloidal Double Ridges)
      for (const lp of lineaePlanes) {
        const cycloidCurve = Math.sin(px * 5.5 + pz * 5.0) * 0.012 + Math.cos(py * 6.8) * 0.006;
        const planeDist = Math.abs(px * lp.nx + py * lp.ny + pz * lp.nz + cycloidCurve);
        const perturbedDist = planeDist + (nDetail - 0.5) * 0.006;

        if (perturbedDist < lp.width) {
          const t = perturbedDist / lp.width;
          const haloWeight = Math.pow(1.0 - t, 1.4) * 0.72;
          r = r * (1 - haloWeight) + lp.colR * haloWeight;
          g = g * (1 - haloWeight) + lp.colG * haloWeight;
          b = b * (1 - haloWeight) + lp.colB * haloWeight;

          // 双脊构造：中央深谷 (槽沟) + 两侧挤压上隆高反照水冰脊肩
          if (lp.doubleRidge) {
            if (t < 0.28) {
              const ridgeDepth = (1.0 - t / 0.28) * 0.48;
              r = r * (1 - ridgeDepth) + 55 * ridgeDepth;
              g = g * (1 - ridgeDepth) + 18 * ridgeDepth;
              b = b * (1 - ridgeDepth) + 10 * ridgeDepth;
            } else if (t < 0.55) {
              // 脊肩新鲜洁净挤出冰提亮
              const shoulder = Math.sin(((t - 0.28) / 0.27) * Math.PI) * 0.25;
              r += shoulder * 40;
              g += shoulder * 35;
              b += shoulder * 30;
            }
          }
        }
      }

      // 混沌碎冰地形 (Conamara Chaos)
      const distChaos1 = angularDistance(px, py, pz, chaosCenter1[0], chaosCenter1[1], chaosCenter1[2]);
      if (distChaos1 < 0.24) {
        const chaosFactor = Math.pow(1.0 - distChaos1 / 0.24, 1.4) * (0.38 + (nDetail - 0.5) * 0.35);
        r = r * (1 - chaosFactor) + 152 * chaosFactor;
        g = g * (1 - chaosFactor) + 72 * chaosFactor;
        b = b * (1 - chaosFactor) + 44 * chaosFactor;
      }
      const distChaos2 = angularDistance(px, py, pz, chaosCenter2[0], chaosCenter2[1], chaosCenter2[2]);
      if (distChaos2 < 0.19) {
        const chaosFactor = Math.pow(1.0 - distChaos2 / 0.19, 1.4) * (0.34 + (nDetail - 0.5) * 0.28);
        r = r * (1 - chaosFactor) + 156 * chaosFactor;
        g = g * (1 - chaosFactor) + 76 * chaosFactor;
        b = b * (1 - chaosFactor) + 48 * chaosFactor;
      }

      // 普维尔 (Pwyll) 巨型撞击坑与跨越千公里冰溅放射纹
      const distPwyll = angularDistance(px, py, pz, pwyllCenter[0], pwyllCenter[1], pwyllCenter[2]);
      if (distPwyll < pwyllRayR) {
        // 计算从撞击坑中心出发的射线方位角
        const dX = px - pwyllCenter[0];
        const dY = py - pwyllCenter[1];
        const dZ = pz - pwyllCenter[2];
        const rayAngle = Math.atan2(dY, Math.sqrt(dX * dX + dZ * dZ));
        const rayNoise = fbm3D(px * 12.0, py * 12.0, pz * 12.0, 3);
        const rayBeam = Math.pow(Math.max(0.0, Math.cos((rayAngle + rayNoise * 0.5) * 16.0)), 2.5);
        const rayAttenuation = Math.pow(1.0 - distPwyll / pwyllRayR, 1.3);
        const rayBright = rayBeam * rayAttenuation * 0.55;

        // 洁净冰溅纹覆盖提亮（覆盖在红褐色裂谷之上）
        r = r * (1 - rayBright) + 255 * rayBright;
        g = g * (1 - rayBright) + 255 * rayBright;
        b = b * (1 - rayBright) + 255 * rayBright;

        // 坑底与环状暗晕
        if (distPwyll < pwyllR) {
          const coreNorm = distPwyll / pwyllR;
          if (coreNorm < 0.35) {
            // 中央纯白冰峰
            const peak = (1.0 - coreNorm / 0.35);
            r = r * (1 - peak) + 255 * peak;
            g = g * (1 - peak) + 255 * peak;
            b = b * (1 - peak) + 255 * peak;
          } else {
            // 环形暗晕坑壁
            const darkRim = Math.sin(((coreNorm - 0.35) / 0.65) * Math.PI) * 0.45;
            r = r * (1 - darkRim) + 85 * darkRim;
            g = g * (1 - darkRim) + 45 * darkRim;
            b = b * (1 - darkRim) + 35 * darkRim;
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

  // 1. 古老深色重撞击陆块区 (Dark Cratered Regios)
  const darkRegios = [
    { name: 'Galileo Regio', lat: 35.0, lon: -130.0, r: 0.54, dark: 0.52 },
    { name: 'Marius Regio', lat: -5.0, lon: -185.0, r: 0.44, dark: 0.48 },
    { name: 'Nicholson Regio', lat: -33.0, lon: -10.0, r: 0.40, dark: 0.46 },
    { name: 'Perrine Regio', lat: 25.0, lon: 35.0, r: 0.38, dark: 0.45 },
  ].map((reg) => ({ ...reg, vec: latLonToVec3(reg.lat, reg.lon) }));

  // 2. 年轻高反照率冰溅射线撞击坑 (Bright Rayed Craters)
  const rayCraters = [
    { name: 'Osiris', lat: -38.0, lon: -166.4, coreR: 0.038, rayR: 0.40 },
    { name: 'Tros', lat: 11.1, lon: 27.3, coreR: 0.032, rayR: 0.34 },
  ].map((c) => ({ ...c, vec: latLonToVec3(c.lat, c.lon) }));

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const latDeg = (phi * 180) / Math.PI;
    const latAbs = Math.abs(latDeg);
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      // 全球大尺度与构造沟槽断裂噪声
      const nMacro = fbm3D(px * 3.2, py * 3.2, pz * 3.2, 4);
      const nSulci = fbm3D(px * 18.0, py * 18.0, pz * 18.0, 3);
      const nCraters = fbm3D(px * 36.0, py * 36.0, pz * 36.0, 2);

      // 默认基底：明亮浅色年轻构造冰槽带 (Uruk/Babylon Sulci，Albedo ~0.45)
      // 细密平行的构造张裂槽纹理
      const grooveLines = Math.sin((px * 24.0 + pz * 24.0 + (nSulci - 0.5) * 6.0) * Math.PI) * 0.5 + 0.5;
      let r = 168 + (nSulci - 0.5) * 25 + grooveLines * 18;
      let g = 176 + (nSulci - 0.5) * 28 + grooveLines * 18;
      let b = 196 + (nSulci - 0.5) * 32 + grooveLines * 22;

      // 叠加古老深色重撞击陆区 (Galileo / Marius / Nicholson Regio)
      let maxDarkInfluence = 0.0;
      for (const reg of darkRegios) {
        const dist = angularDistance(px, py, pz, reg.vec[0], reg.vec[1], reg.vec[2]);
        const perturbedDist = dist + (nMacro - 0.5) * 0.15;
        if (perturbedDist < reg.r) {
          const factor = Math.pow(1.0 - perturbedDist / reg.r, 1.2) * reg.dark;
          maxDarkInfluence = Math.max(maxDarkInfluence, factor);
        }
      }

      // 暗区着色：古老重度撞击碳质硅酸盐泥岩（深灰褐色，反照率 ~0.15）
      if (maxDarkInfluence > 0.0) {
        const darkR = 72 + (nCraters - 0.5) * 20;
        const darkG = 76 + (nCraters - 0.5) * 22;
        const darkB = 86 + (nCraters - 0.5) * 25;
        r = r * (1 - maxDarkInfluence) + darkR * maxDarkInfluence;
        g = g * (1 - maxDarkInfluence) + darkG * maxDarkInfluence;
        b = b * (1 - maxDarkInfluence) + darkB * maxDarkInfluence;
      }

      // 叠加年轻冰溅射线撞击坑 (Osiris & Tros)
      for (const c of rayCraters) {
        const distC = angularDistance(px, py, pz, c.vec[0], c.vec[1], c.vec[2]);
        if (distC < c.rayR) {
          const dX = px - c.vec[0];
          const dY = py - c.vec[1];
          const dZ = pz - c.vec[2];
          const rayAngle = Math.atan2(dY, Math.sqrt(dX * dX + dZ * dZ));
          const rayNoise = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 3);
          const rayBeam = Math.pow(Math.max(0.0, Math.cos((rayAngle + rayNoise * 0.4) * 12.0)), 2.8);
          const rayFalloff = Math.pow(1.0 - distC / c.rayR, 1.4);
          const rayIntensity = rayBeam * rayFalloff * 0.65;

          r = r * (1 - rayIntensity) + 245 * rayIntensity;
          g = g * (1 - rayIntensity) + 250 * rayIntensity;
          b = b * (1 - rayIntensity) + 255 * rayIntensity;

          if (distC < c.coreR) {
            const coreFactor = 1.0 - distC / c.coreR;
            r = r * (1 - coreFactor) + 255 * coreFactor;
            g = g * (1 - coreFactor) + 255 * coreFactor;
            b = b * (1 - coreFactor) + 255 * coreFactor;
          }
        }
      }

      // 磁层诱导极地水冰霜帽 (Polar Frost Caps: 纬度 > 52° 区域)
      if (latAbs > 50.0) {
        const frostNorm = Math.pow((latAbs - 50.0) / 40.0, 1.2) * 0.35;
        r = r * (1 - frostNorm) + 235 * frostNorm;
        g = g * (1 - frostNorm) + 242 * frostNorm;
        b = b * (1 - frostNorm) + 255 * frostNorm;
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

  // 1. 瓦尔哈拉巨型多环撞击盆地 (Valhalla Multi-ring Basin: lat 16.0°N, lon -57.0°)
  const valhallaCenter = latLonToVec3(16.0, -57.0);

  // 2. 阿斯加德多环撞击盆地 (Asgard Basin: lat 32.0°N, lon -140.0°)
  const asgardCenter = latLonToVec3(32.0, -140.0);

  // 3. 著名年轻霜冻高亮撞击坑 (如 Lofn, Har, Burr)
  const brightCraters = [
    { name: 'Lofn', lat: -56.0, lon: -23.0, r: 0.045 },
    { name: 'Har', lat: 3.5, lon: -358.0, r: 0.038 },
    { name: 'Burr', lat: 42.0, lon: -134.0, r: 0.035 },
  ].map((c) => ({ ...c, vec: latLonToVec3(c.lat, c.lon) }));

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      // 40 亿年未更新的撞击坑饱和古老地貌
      const nCraters1 = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 4);
      const nCraters2 = fbm3D(px * 24.0, py * 24.0, pz * 24.0, 3);
      const nDetail = fbm3D(px * 48.0, py * 48.0, pz * 48.0, 2);

      // 测光基底（深暗碳质冰岩，NASA 观测级中灰拉伸，避免死黑）
      let r = 115 + (nCraters1 - 0.5) * 36;
      let g = 120 + (nCraters1 - 0.5) * 38;
      let b = 135 + (nCraters1 - 0.5) * 42;

      // 退化撞击坑坑缘白霜升华微晶提亮 (Frost-rimmed micro craters)
      if (nCraters2 > 0.62) {
        const rimFrost = (nCraters2 - 0.62) / 0.38;
        r += rimFrost * 55;
        g += rimFrost * 60;
        b += rimFrost * 75;
      }

      // 1. 瓦尔哈拉巨型多环断裂带构造
      const distV = angularDistance(px, py, pz, valhallaCenter[0], valhallaCenter[1], valhallaCenter[2]);
      if (distV < 0.72) {
        // 中央明亮撞击重熔核 (Bright Palimpsest)
        if (distV < 0.11) {
          const coreFactor = Math.pow(1.0 - distV / 0.11, 1.4);
          r = r * (1 - coreFactor) + 225 * coreFactor;
          g = g * (1 - coreFactor) + 235 * coreFactor;
          b = b * (1 - coreFactor) + 250 * coreFactor;
        } else {
          // 15 重向外递减的同心断崖波纹 (Concentric Scarps)
          const ringPhase = Math.pow(distV / 0.72, 0.85) * 14.0 * Math.PI;
          const ringVal = Math.cos(ringPhase);
          const ringAmp = Math.pow(1.0 - distV / 0.72, 1.2) * 0.75;
          if (ringVal > 0.15) {
            const scarpIntensity = ((ringVal - 0.15) / 0.85) * ringAmp;
            r += scarpIntensity * 65;
            g += scarpIntensity * 70;
            b += scarpIntensity * 85;
          }
        }
      }

      // 2. 阿斯加德多环盆地构造 (Asgard Basin)
      const distA = angularDistance(px, py, pz, asgardCenter[0], asgardCenter[1], asgardCenter[2]);
      if (distA < 0.40) {
        if (distA < 0.08) {
          const coreA = (1.0 - distA / 0.08) * 0.65;
          r += coreA * 70;
          g += coreA * 75;
          b += coreA * 85;
        } else {
          const ringA = Math.cos((distA / 0.40) * 8.0 * Math.PI);
          if (ringA > 0.2) {
            const ringFactor = ((ringA - 0.2) / 0.8) * (1.0 - distA / 0.40) * 0.45;
            r += ringFactor * 38;
            g += ringFactor * 42;
            b += ringFactor * 52;
          }
        }
      }

      // 3. 著名年轻高亮霜冻撞击坑
      for (const bc of brightCraters) {
        const distC = angularDistance(px, py, pz, bc.vec[0], bc.vec[1], bc.vec[2]);
        if (distC < bc.r) {
          const f = (1.0 - distC / bc.r);
          r += f * 85;
          g += f * 90;
          b += f * 105;
        }
      }

      // 微观颗粒
      r += (nDetail - 0.5) * 8;
      g += (nDetail - 0.5) * 8;
      b += (nDetail - 0.5) * 10;

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

  // 1024x512 程序示意，非测量地形或探测器原图
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 1. 火卫一特征撞击构造中心坐标
  // 斯蒂克尼巨型撞击坑 (Stickney: 对齐 3D 几何网格凹陷方向 (0.95, 0.15, 0.25), 直径 9km，占星体近一半直径)
  const stickneyCenter = latLonToVec3(8.7, 14.7);
  // 利姆托克撞击坑 (Limtoc: lat -11°S, lon 10°E, 斯蒂克尼坑底次级大撞击坑)
  const limtocCenter = latLonToVec3(-11.0, 10.0);
  // 霍尔撞击坑 (Hall: lat -80°S, lon -210°, 南极巨坑)
  const hallCenter = latLonToVec3(-80.0, -210.0);

  // 2. 火卫二特征撞击坑中心坐标
  // 斯威夫特撞击坑 (Swift: lat 12.5°N, lon 1.8°W)
  const swiftCenter = latLonToVec3(12.5, -1.8);
  // 伏尔泰撞击坑 (Voltaire: lat 22.0°N, lon 3.5°W)
  const voltaireCenter = latLonToVec3(22.0, -3.5);

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      if (isPhobos) {
        // --- 火卫一：程序表土与特征坑示意，未进行测光定标 ---
        const nRegolith = fbm3D(px * 16.0, py * 16.0, pz * 16.0, 5);
        const nMicro = fbm3D(px * 32.0, py * 32.0, pz * 32.0, 3);

        // 低饱和灰褐色示意，不是 HiRISE 色彩还原
        let r = 128 + (nRegolith - 0.5) * 44 + (nMicro - 0.5) * 16;
        let g = 120 + (nRegolith - 0.5) * 40 + (nMicro - 0.5) * 14;
        let b = 112 + (nRegolith - 0.5) * 38 + (nMicro - 0.5) * 14;

        // 1. 斯蒂克尼巨型陨石坑 (Stickney Crater)
        const distS = angularDistance(px, py, pz, stickneyCenter[0], stickneyCenter[1], stickneyCenter[2]);
        if (distS < 0.42) {
          // 阶梯状断崖与坑底深渊暗化
          const pitRatio = distS / 0.42;
          const pitDepth = Math.pow(1.0 - pitRatio, 1.4) * 0.65;
          r *= (1.0 - pitDepth * 0.72);
          g *= (1.0 - pitDepth * 0.72);
          b *= (1.0 - pitDepth * 0.72);

          // 坑壁滑坡露头高反照率新鲜块石 (HiRISE 拍摄到的亮蓝灰露头)
          if (pitRatio > 0.58 && pitRatio < 0.95) {
            const outcrop = Math.sin((pitRatio - 0.58) / 0.37 * Math.PI);
            r += outcrop * 28.0;
            g += outcrop * 34.0;
            b += outcrop * 42.0;
          }
        }

        // 2. 利姆托克坑 (Limtoc) 次级深坑
        const distL = angularDistance(px, py, pz, limtocCenter[0], limtocCenter[1], limtocCenter[2]);
        if (distL < 0.14) {
          const lDepth = (1.0 - distL / 0.14) * 0.52;
          r *= (1.0 - lDepth * 0.6);
          g *= (1.0 - lDepth * 0.6);
          b *= (1.0 - lDepth * 0.6);
        }

        // 3. 霍尔坑 (Hall)
        const distH = angularDistance(px, py, pz, hallCenter[0], hallCenter[1], hallCenter[2]);
        if (distH < 0.18) {
          const hDepth = (1.0 - distH / 0.18) * 0.48;
          r *= (1.0 - hDepth * 0.5);
          g *= (1.0 - hDepth * 0.5);
          b *= (1.0 - hDepth * 0.5);
        }

        // 4. 环绕全星的放射状应力槽沟系 (Parallel Stress Grooves / Fractures)
        // 沟槽成因尚不确定；仅作低对比示意，不能把周期波纹当测量高程
        const groovePhase = phi * 36.0 + Math.sin(theta * 4.0 + 1.2) * 2.2;
        const grooveLine = Math.pow(Math.abs(Math.sin(groovePhase)), 10.0);
        if (grooveLine > 0.30) {
          const grooveShadow = (grooveLine - 0.30) / 0.70 * 5.0;
          r -= grooveShadow;
          g -= grooveShadow;
          b -= grooveShadow;
        }

        const idx = (y * W + x) * 4;
        data[idx] = Math.min(255, Math.max(0, Math.round(r)));
        data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
        data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
        data[idx + 3] = 255;
      } else {
        // --- 火卫二 (Deimos) 厚风化层毛毯包络与微尘流条带 ---
        const nBlanket = fbm3D(px * 12.0, py * 12.0, pz * 12.0, 4);
        const nDust = fbm3D(px * 24.0, py * 24.0, pz * 24.0, 3);

        // 火卫二表面覆盖数十米松散粉末，整体更显平滑与温润浅炭灰
        let r = 138 + (nBlanket - 0.5) * 36 + (nDust - 0.5) * 16;
        let g = 132 + (nBlanket - 0.5) * 34 + (nDust - 0.5) * 14;
        let b = 124 + (nBlanket - 0.5) * 30 + (nDust - 0.5) * 12;

        // 1. 斯威夫特坑 (Swift)
        const distSw = angularDistance(px, py, pz, swiftCenter[0], swiftCenter[1], swiftCenter[2]);
        if (distSw < 0.16) {
          const swDepth = (1.0 - distSw / 0.16) * 0.42;
          r *= (1.0 - swDepth * 0.55);
          g *= (1.0 - swDepth * 0.55);
          b *= (1.0 - swDepth * 0.55);
        }

        // 2. 伏尔泰坑 (Voltaire)
        const distVo = angularDistance(px, py, pz, voltaireCenter[0], voltaireCenter[1], voltaireCenter[2]);
        if (distVo < 0.22) {
          const voDepth = (1.0 - distVo / 0.22) * 0.50;
          r *= (1.0 - voDepth * 0.6);
          g *= (1.0 - voDepth * 0.6);
          b *= (1.0 - voDepth * 0.6);
        }

        // 3. 坡面亮色微尘流条带 (Bright Streamers)
        // 微重力下顺山脊滑落的明亮细颗粒沉降带
        const streakNoise = fbm3D(px * 32.0, py * 6.0, pz * 32.0, 2);
        if (streakNoise > 0.58) {
          const streakFactor = (streakNoise - 0.58) / 0.42 * 32.0;
          r += streakFactor * 1.15;
          g += streakFactor * 1.10;
          b += streakFactor * 1.00;
        }

        const idx = (y * W + x) * 4;
        data[idx] = Math.min(255, Math.max(0, Math.round(r)));
        data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
        data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
        data[idx + 3] = 255;
      }
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

// ---------------------------------------------------------------------------
// 8. 木卫五 (Amalthea) — 极度拉长的深红天体与高反照率撞击斜坡
// ---------------------------------------------------------------------------
let amaltheaTexCache: THREE.Texture | null = null;
export function getAmaltheaTexture(): THREE.Texture {
  if (amaltheaTexCache) return amaltheaTexCache;
  if (typeof document === 'undefined') return (amaltheaTexCache = createFallbackTexture(185, 28, 28));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 8.0, py * 8.0, pz * 8.0, 4);
      // 深红色铁镁质与硫化物沉降色调
      let r = 160 + (n1 - 0.5) * 45;
      let g = 38 + (n1 - 0.5) * 24;
      let b = 30 + (n1 - 0.5) * 20;

      // 撞击斜坡裸露的亮绿色/黄白色冰质斑块
      if (n1 > 0.68) {
        const spot = (n1 - 0.68) / 0.32;
        r = r * (1 - spot) + 210 * spot;
        g = g * (1 - spot) + 195 * spot;
        b = b * (1 - spot) + 140 * spot;
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
  return (amaltheaTexCache = tex);
}

// ---------------------------------------------------------------------------
// 9. 土卫一 (Mimas) — 死星巨型赫歇尔 (Herschel) 撞击坑
// ---------------------------------------------------------------------------
let mimasTexCache: THREE.Texture | null = null;
export function getMimasTexture(): THREE.Texture {
  if (mimasTexCache) return mimasTexCache;
  if (typeof document === 'undefined') return (mimasTexCache = createFallbackTexture(203, 213, 225));

  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;
  const herschelCenter = latLonToVec3(1.0, -110.0); // 赤道西经 110 度

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const nCraters = fbm3D(px * 12.0, py * 12.0, pz * 12.0, 4);
      let lum = 180 + (nCraters - 0.5) * 35;

      // 赫歇尔巨坑（直径占土卫一 1/3，带有高耸中央峰与环形山壁）
      const distH = angularDistance(px, py, pz, herschelCenter[0], herschelCenter[1], herschelCenter[2]);
      if (distH < 0.42) {
        const t = distH / 0.42; // 0=中央峰，1=环壁
        if (t < 0.14) {
          // 中央山峰高反光
          lum += (1.0 - t / 0.14) * 65;
        } else if (t < 0.75) {
          // 碗状深坑底阴影
          lum -= 55 * Math.sin((t / 0.75) * Math.PI);
        } else {
          // 环壁边缘隆起高光
          lum += 48 * Math.sin(((t - 0.75) / 0.25) * Math.PI);
        }
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = Math.min(255, c + 8); // 微蓝水冰基调
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (mimasTexCache = tex);
}

// ---------------------------------------------------------------------------
// 10. 土卫三 (Tethys) — 奥德修斯大坑与伊萨卡大峡谷
// ---------------------------------------------------------------------------
let tethysTexCache: THREE.Texture | null = null;
export function getTethysTexture(): THREE.Texture {
  if (tethysTexCache) return tethysTexCache;
  if (typeof document === 'undefined') return (tethysTexCache = createFallbackTexture(226, 232, 240));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 4);
      let lum = 215 + (n1 - 0.5) * 25;

      // 伊萨卡大峡谷 (Ithaca Chasma: 极区跨越的大圆深谷)
      const chasmaDist = Math.abs(px * 0.85 + py * 0.15 - pz * 0.48);
      if (chasmaDist < 0.045) {
        const factor = (1.0 - chasmaDist / 0.045);
        lum -= factor * 60;
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = Math.min(255, c + 6);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (tethysTexCache = tex);
}

// ---------------------------------------------------------------------------
// 11. 土卫四 (Dione) & 土卫五 (Rhea)
// ---------------------------------------------------------------------------
let dioneTexCache: THREE.Texture | null = null;
export function getDioneTexture(): THREE.Texture {
  if (dioneTexCache) return dioneTexCache;
  if (typeof document === 'undefined') return (dioneTexCache = createFallbackTexture(148, 163, 184));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 9.0, py * 9.0, pz * 9.0, 4);
      let lum = 155 + (n1 - 0.5) * 35;

      // 后随半球明亮羽状冰崖断层线 (Wispy Chasmata)
      if (px < 0.0) {
        const fracture = Math.sin(px * 24.0 + py * 18.0) * Math.cos(pz * 20.0);
        if (fracture > 0.45) {
          lum += (fracture - 0.45) * 120;
        }
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = Math.min(255, c + 8);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (dioneTexCache = tex);
}

let rheaTexCache: THREE.Texture | null = null;
export function getRheaTexture(): THREE.Texture {
  if (rheaTexCache) return rheaTexCache;
  if (typeof document === 'undefined') return (rheaTexCache = createFallbackTexture(100, 116, 139));

  const W = 512, H = 256;
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

      const nCraters = fbm3D(px * 16.0, py * 16.0, pz * 16.0, 5);
      const lum = 135 + (nCraters - 0.5) * 42;

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = Math.min(255, c + 6);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (rheaTexCache = tex);
}

// ---------------------------------------------------------------------------
// 12. 土卫七 (Hyperion) — 蜂窝海绵状多孔多面体金褐色
// ---------------------------------------------------------------------------
let hyperionTexCache: THREE.Texture | null = null;
export function getHyperionTexture(): THREE.Texture {
  if (hyperionTexCache) return hyperionTexCache;
  if (typeof document === 'undefined') return (hyperionTexCache = createFallbackTexture(217, 119, 6));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 14.0, py * 14.0, pz * 14.0, 4);
      let r = 195 + (n1 - 0.5) * 45;
      let g = 145 + (n1 - 0.5) * 35;
      let b = 65 + (n1 - 0.5) * 25;

      // 极深海绵孔底黑影
      const pit = Math.sin(px * 16.0) * Math.sin(py * 16.0) * Math.sin(pz * 16.0);
      if (pit < -0.15) {
        r *= 0.45; g *= 0.45; b *= 0.45;
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
  return (hyperionTexCache = tex);
}

// ---------------------------------------------------------------------------
// 13. 土卫八 (Iapetus) — 著名极黑极白“阴阳脸”与赤道山脊
// ---------------------------------------------------------------------------
let iapetusTexCache: THREE.Texture | null = null;
export function getIapetusTexture(): THREE.Texture {
  if (iapetusTexCache) return iapetusTexCache;
  if (typeof document === 'undefined') return (iapetusTexCache = createFallbackTexture(71, 85, 105));

  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

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

      const n1 = fbm3D(px * 8.0, py * 8.0, pz * 8.0, 4);

      // 阴阳脸判定：前导半球 (Cassini Regio: 经度 -90° 附近) 极黑 (沥青 3% 反射率)
      // 后随半球 (Roncevaux Terra) 洁白如雪 (60% 反射率)
      let r: number, g: number, b: number;
      const isBlackHemisphere = Math.cos(theta + 0.3) > 0.05;

      if (isBlackHemisphere) {
        // 卡西尼暗区：煤烟沥青深黑
        const darkBase = 28 + (n1 - 0.5) * 16;
        r = darkBase; g = darkBase * 0.9; b = darkBase * 0.8;
      } else {
        // 龙塞斯瓦列斯高地：纯白水冰
        const brightBase = 225 + (n1 - 0.5) * 25;
        r = brightBase; g = brightBase; b = Math.min(255, brightBase + 10);
      }

      // 赤道 20km 巨型核桃山脊亮线
      if (Math.abs(latDeg) < 2.5) {
        const ridge = (1.0 - Math.abs(latDeg) / 2.5) * 45;
        r += ridge; g += ridge; b += ridge;
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
  return (iapetusTexCache = tex);
}

// ---------------------------------------------------------------------------
// 14. 天王星五大卫星 (Miranda, Ariel, Umbriel, Titania, Oberon)
// ---------------------------------------------------------------------------
let mirandaTexCache: THREE.Texture | null = null;
export function getMirandaTexture(): THREE.Texture {
  if (mirandaTexCache) return mirandaTexCache;
  if (typeof document === 'undefined') return (mirandaTexCache = createFallbackTexture(161, 161, 170));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 4);
      let lum = 175 + (n1 - 0.5) * 35;

      // 维罗纳断崖与冠状同心断裂几何斑块 (Coronae)
      const chevron = Math.abs(px - py) < 0.08 || Math.abs(px + pz) < 0.06;
      if (chevron) {
        lum += 55;
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (mirandaTexCache = tex);
}

let arielTexCache: THREE.Texture | null = null;
export function getArielTexture(): THREE.Texture {
  if (arielTexCache) return arielTexCache;
  if (typeof document === 'undefined') return (arielTexCache = createFallbackTexture(228, 228, 231));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 8.0, py * 8.0, pz * 8.0, 4);
      let lum = 210 + (n1 - 0.5) * 30;

      // 裂谷地堑裂缝网络 (Graben networks)
      const rift = Math.sin(px * 20.0 + py * 12.0) * Math.cos(pz * 18.0);
      if (Math.abs(rift) < 0.12) {
        lum -= 45;
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c; data[idx + 1] = c; data[idx + 2] = Math.min(255, c + 5); data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (arielTexCache = tex);
}

let umbrielTexCache: THREE.Texture | null = null;
export function getUmbrielTexture(): THREE.Texture {
  if (umbrielTexCache) return umbrielTexCache;
  if (typeof document === 'undefined') return (umbrielTexCache = createFallbackTexture(82, 82, 91));

  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;
  const wundaCenter = latLonToVec3(-8.0, -85.0); // 翁达环坑

  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosP * Math.cos(theta);
      const py = sinP;
      const pz = cosP * Math.sin(theta);

      const n1 = fbm3D(px * 12.0, py * 12.0, pz * 12.0, 4);
      let lum = 85 + (n1 - 0.5) * 25; // 极度深暗古老表面

      // 翁达 (Wunda) 荧光白环撞击坑
      const distW = angularDistance(px, py, pz, wundaCenter[0], wundaCenter[1], wundaCenter[2]);
      if (distW < 0.22) {
        // 环状白色喷射沉积圈
        const ring = Math.sin((distW / 0.22) * Math.PI);
        lum += ring * 145;
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (umbrielTexCache = tex);
}

let titaniaTexCache: THREE.Texture | null = null;
export function getTitaniaTexture(): THREE.Texture {
  if (titaniaTexCache) return titaniaTexCache;
  if (typeof document === 'undefined') return (titaniaTexCache = createFallbackTexture(113, 113, 122));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 10.0, py * 10.0, pz * 10.0, 4);
      let lum = 135 + (n1 - 0.5) * 35;

      // 墨西拿大峡谷 (Messina Chasma)
      const canyon = Math.abs(px * 0.7 + py * 0.5 - pz * 0.5);
      if (canyon < 0.05) {
        lum -= 45 * (1.0 - canyon / 0.05);
      }

      const idx = (y * W + x) * 4;
      const c = Math.min(255, Math.max(0, Math.round(lum)));
      data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (titaniaTexCache = tex);
}

let oberonTexCache: THREE.Texture | null = null;
export function getOberonTexture(): THREE.Texture {
  if (oberonTexCache) return oberonTexCache;
  if (typeof document === 'undefined') return (oberonTexCache = createFallbackTexture(63, 63, 70));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 12.0, py * 12.0, pz * 12.0, 4);
      // 暗红碳质冰屑色调
      let r = 95 + (n1 - 0.5) * 30;
      let g = 82 + (n1 - 0.5) * 26;
      let b = 78 + (n1 - 0.5) * 25;

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
  return (oberonTexCache = tex);
}

// ---------------------------------------------------------------------------
// 15. 海王星卫星 (Triton & Proteus)
// ---------------------------------------------------------------------------
let tritonTexCache: THREE.Texture | null = null;
export function getTritonTexture(): THREE.Texture {
  if (tritonTexCache) return tritonTexCache;
  if (typeof document === 'undefined') return (tritonTexCache = createFallbackTexture(103, 232, 249));

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

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

      // 真实哈密瓜皮凹陷地形 (Cantaloupe terrain: 多重分形有机蜂窝多边形凹槽)
      const c1 = fbm3D(px * 14.0, py * 14.0, pz * 14.0, 3);
      const c2 = fbm3D(px * 28.0, py * 28.0, pz * 28.0, 2);
      const cantaloupe = (c1 * 0.7 + c2 * 0.3 - 0.5) * 2.0;

      // 极寒低温青蓝灰色水冰与甲烷基底
      let r = 212 + cantaloupe * 22;
      let g = 228 + cantaloupe * 16;
      let b = 238 + cantaloupe * 12;

      // 南极粉白微红氮冰极冠 (South Polar Nitrogen-Methane Ice Cap: 延伸至赤道以南)
      if (latDeg < -10.0) {
        const polar = Math.pow((-latDeg - 10.0) / 80.0, 1.15);
        r = r * (1 - polar) + 246 * polar;
        g = g * (1 - polar) + 214 * polar;
        b = b * (1 - polar) + 218 * polar;

        // 真实液氮冰火山黑色羽流风蚀沉降扇 (Cryovolcanic Geyser Plumes: Voyager 2 观测到的暗色羽流)
        // 8 处离散主喷口 + 随高空风向东北向拉长的扇形黑色烟尘沉降
        for (let gi = 0; gi < 8; gi++) {
          const gLat = -25.0 - gi * 7.5;
          const gLon = -140.0 + gi * 44.0 + Math.sin(gi * 2.3) * 18.0;
          const gCenter = latLonToVec3(gLat, gLon);
          const ventDist = angularDistance(px, py, pz, gCenter[0], gCenter[1], gCenter[2]);
          if (ventDist < 0.045) {
            const ventFactor = Math.pow(1.0 - ventDist / 0.045, 1.8) * 0.90;
            r = r * (1 - ventFactor) + 16 * ventFactor;
            g = g * (1 - ventFactor) + 14 * ventFactor;
            b = b * (1 - ventFactor) + 12 * ventFactor;
          }

          const dTheta = theta - (gLon * Math.PI) / 180.0;
          const dPhi = phi - (gLat * Math.PI) / 180.0;
          const windDist = Math.sqrt(Math.pow(dTheta * 1.6 - dPhi * 0.7, 2) + Math.pow(dPhi * 2.0, 2));

          if (windDist < 0.14 && dTheta > -0.02) {
            const plumeDark = Math.pow(1.0 - windDist / 0.14, 1.4) * 0.82;
            r = r * (1 - plumeDark) + 32 * plumeDark;
            g = g * (1 - plumeDark) + 28 * plumeDark;
            b = b * (1 - plumeDark) + 25 * plumeDark;
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
  return (tritonTexCache = tex);
}

let proteusTexCache: THREE.Texture | null = null;
export function getProteusTexture(): THREE.Texture {
  if (proteusTexCache) return proteusTexCache;
  if (typeof document === 'undefined') return (proteusTexCache = createFallbackTexture(82, 82, 82));

  const W = 512, H = 256;
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

      const n1 = fbm3D(px * 14.0, py * 14.0, pz * 14.0, 4);
      let c = 58 + (n1 - 0.5) * 28;

      const idx = (y * W + x) * 4;
      c = Math.min(255, Math.max(0, Math.round(c)));
      data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (proteusTexCache = tex);
}

// ---------------------------------------------------------------------------
// 通用卫星纹理分发器 (Master Moon Texture Dispatcher)
// ---------------------------------------------------------------------------
export function getMoonTextureByBodyId(bodyId: string): THREE.Texture | null {
  switch (bodyId) {
    case 'io': return getIoTexture();
    case 'europa': return getEuropaTexture();
    case 'ganymede': return getGanymedeTexture();
    case 'callisto': return getCallistoTexture();
    case 'amalthea': return getAmaltheaTexture();
    case 'mimas': return getMimasTexture();
    case 'enceladus': return getEnceladusTexture();
    case 'tethys': return getTethysTexture();
    case 'dione': return getDioneTexture();
    case 'rhea': return getRheaTexture();
    case 'titan': return getTitanNearInfraredTexture();
    case 'hyperion': return getHyperionTexture();
    case 'iapetus': return getIapetusTexture();
    case 'miranda': return getMirandaTexture();
    case 'ariel': return getArielTexture();
    case 'umbriel': return getUmbrielTexture();
    case 'titania': return getTitaniaTexture();
    case 'oberon': return getOberonTexture();
    case 'triton': return getTritonTexture();
    case 'proteus': return getProteusTexture();
    case 'phobos': return getMarsMoonTexture(true);
    case 'deimos': return getMarsMoonTexture(false);
    default: return null;
  }
}

