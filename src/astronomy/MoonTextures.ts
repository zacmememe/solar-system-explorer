/**
 * 太阳系核心卫星高拟真程序化 PBR 纹理生成器 v2
 * 100% 离线 Canvas 2D，零外部网络依赖。
 * 全面升级：2048×1024 分辨率，多倍频程噪声，科学准确色彩，更高视觉保真度。
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

/** 简单哈希噪声函数 */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** 双线性插值平滑噪声 */
function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (d - b - c + a) * ux * uy;
}

/** 多倍频程 fBm 分形噪声 */
function fbm(x: number, y: number, octaves: number = 6): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return value / maxValue;
}

/**
 * 1. 木卫一 (Io) — 全太阳系最活跃的火山世界
 * 参考：NASA Galileo SSI 真彩色合成图像
 */
export function getIoTexture(): THREE.Texture {
  if (ioTexCache) return ioTexCache;
  if (typeof document === 'undefined') {
    return (ioTexCache = createFallbackTexture(234, 179, 8));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 基础地形：复杂的硫磺色彩分布（黄-橙-红-白-黑多色混合）
  // 逐像素构建噪声基础
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 6;
      const ny = py / H * 3;
      const n1 = fbm(nx, ny, 7);
      const n2 = fbm(nx * 2 + 5, ny * 2 + 5, 5);
      const n3 = fbm(nx * 0.5 + 10, ny * 0.5 + 10, 4);

      let r, g, b;
      // 多层硫磺色彩混合
      if (n1 < 0.30) {
        // 深橙红色硫磺富集区
        const t = n1 / 0.30;
        r = Math.round(180 + t * 60); g = Math.round(60 + t * 50); b = Math.round(10 + t * 10);
      } else if (n1 < 0.48) {
        // 黄橙硫磺主色调
        const t = (n1 - 0.30) / 0.18;
        r = Math.round(230 + t * 20); g = Math.round(160 + t * 60); b = Math.round(20 + t * 15);
      } else if (n1 < 0.62) {
        // 亮黄芥末色
        const t = (n1 - 0.48) / 0.14;
        r = Math.round(245 + t * 5); g = Math.round(210 + t * 20); b = Math.round(50 + t * 30);
      } else if (n1 < 0.78) {
        // 淡黄白色 SO2 霜冻
        const t = (n1 - 0.62) / 0.16;
        r = Math.round(250 + t * 3); g = Math.round(240 + t * 10); b = Math.round(180 + t * 50);
      } else {
        // 白色/浅黄 SO2 霜冻高反照率区
        const t = (n1 - 0.78) / 0.22;
        r = 253; g = 250; b = Math.round(210 + t * 30);
      }

      // 加入 n2 的次级变化增加细节
      r = Math.min(255, Math.max(0, r + Math.round((n2 - 0.5) * 40)));
      g = Math.min(255, Math.max(0, g + Math.round((n2 - 0.5) * 30)));
      b = Math.min(255, Math.max(0, b + Math.round((n2 - 0.5) * 15)));

      // n3 大尺度区域变化
      r = Math.min(255, Math.max(0, r + Math.round((n3 - 0.5) * 50)));
      g = Math.min(255, Math.max(0, g + Math.round((n3 - 0.5) * 35)));

      const idx = (py * W + px) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 极地 SO2 白霜
  const northFrost = ctx.createLinearGradient(0, 0, 0, H * 0.20);
  northFrost.addColorStop(0, 'rgba(255, 252, 230, 0.60)');
  northFrost.addColorStop(1, 'rgba(255, 252, 230, 0.0)');
  ctx.fillStyle = northFrost;
  ctx.fillRect(0, 0, W, H * 0.22);

  const southFrost = ctx.createLinearGradient(0, H, 0, H * 0.78);
  southFrost.addColorStop(0, 'rgba(255, 252, 230, 0.55)');
  southFrost.addColorStop(1, 'rgba(255, 252, 230, 0.0)');
  ctx.fillStyle = southFrost;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  // 著名活火山与熔岩湖（精确位置与形态）
  const volcanoes = [
    // { x, y, r, name, lava_color, plume_color, ring_count }
    { x: 0.37 * W, y: 0.46 * H, r: 38, lava: '#0d0d0d', plumeOuter: 'rgba(200,30,20,0.55)', plumeInner: 'rgba(80,10,5,0.65)', ringsN: 3 }, // Loki Patera
    { x: 0.70 * W, y: 0.60 * H, r: 45, lava: '#1a0a02', plumeOuter: 'rgba(220,25,15,0.60)', plumeInner: 'rgba(100,15,5,0.70)', ringsN: 4 }, // Pele
    { x: 0.53 * W, y: 0.39 * H, r: 26, lava: '#0d0d0d', plumeOuter: 'rgba(210,85,10,0.50)', plumeInner: 'rgba(90,30,5,0.55)', ringsN: 2 }, // Prometheus
    { x: 0.17 * W, y: 0.52 * H, r: 32, lava: '#1a0a00', plumeOuter: 'rgba(210,70,8,0.48)', plumeInner: 'rgba(80,25,5,0.55)', ringsN: 2 }, // Tvashtar
    { x: 0.86 * W, y: 0.37 * H, r: 28, lava: '#0d0d0d', plumeOuter: 'rgba(180,80,15,0.45)', plumeInner: 'rgba(70,25,5,0.50)', ringsN: 2 }, // Amirani
    { x: 0.25 * W, y: 0.70 * H, r: 22, lava: '#1a1a1a', plumeOuter: 'rgba(195,40,20,0.42)', plumeInner: 'rgba(80,15,5,0.50)', ringsN: 2 }, // Babbar Patera
    { x: 0.60 * W, y: 0.74 * H, r: 20, lava: '#0d0d0d', plumeOuter: 'rgba(210,40,30,0.40)', plumeInner: 'rgba(90,15,5,0.48)', ringsN: 2 }, // Marduk
    { x: 0.08 * W, y: 0.42 * H, r: 18, lava: '#151005', plumeOuter: 'rgba(185,90,10,0.38)', plumeInner: 'rgba(70,28,5,0.44)', ringsN: 2 }, // Masubi
  ];

  for (const v of volcanoes) {
    // 多环同心硫磺沉积圈
    for (let ring = v.ringsN; ring >= 1; ring--) {
      const ringR = v.r * (1.5 + ring * 1.8);
      const opacity = 0.30 / ring;
      const rg = ctx.createRadialGradient(v.x, v.y, v.r * 0.8, v.x, v.y, ringR);
      rg.addColorStop(0, v.plumeInner);
      rg.addColorStop(0.6, v.plumeOuter.replace(/[\d.]+\)$/, `${opacity})`));
      rg.addColorStop(1.0, 'rgba(234,179,8,0.0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(v.x, v.y, ringR, 0, Math.PI * 2);
      ctx.fill();
    }

    // SO2 白霜同心环
    ctx.strokeStyle = 'rgba(255,250,210,0.60)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.r * 2.0, 0, Math.PI * 2);
    ctx.stroke();

    // 破火山口黑色玄武岩熔岩湖
    const lavaGrad = ctx.createRadialGradient(v.x - v.r * 0.2, v.y - v.r * 0.2, 2, v.x, v.y, v.r);
    lavaGrad.addColorStop(0, '#ff5500');
    lavaGrad.addColorStop(0.15, '#cc2200');
    lavaGrad.addColorStop(0.4, '#550000');
    lavaGrad.addColorStop(0.7, v.lava);
    lavaGrad.addColorStop(1, v.lava);
    ctx.fillStyle = lavaGrad;
    ctx.beginPath();
    ctx.ellipse(v.x, v.y, v.r, v.r * 0.72, Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();

    // 熔岩溢流裂缝（更多、更自然）
    ctx.strokeStyle = 'rgba(80,20,5,0.65)';
    ctx.lineWidth = 1.5;
    for (let a = 0; a < 9; a++) {
      const angle = (a / 9) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const len = v.r * 2.0 + hash(a, v.x) * v.r * 1.5;
      ctx.beginPath();
      ctx.moveTo(v.x + Math.cos(angle) * v.r * 0.7, v.y + Math.sin(angle) * v.r * 0.7);
      const cx = v.x + Math.cos(angle + 0.3) * len * 0.6;
      const cy = v.y + Math.sin(angle + 0.3) * len * 0.6;
      ctx.quadraticCurveTo(cx, cy,
        v.x + Math.cos(angle + (Math.random() - 0.5) * 0.8) * len,
        v.y + Math.sin(angle + (Math.random() - 0.5) * 0.8) * len);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (ioTexCache = tex);
}

/**
 * 2. 木卫二 (Europa) — 高反照率冰壳与深褐色线状地形
 * 参考：NASA Galileo 真彩色图像 (PIA01297 等)
 */
export function getEuropaTexture(): THREE.Texture {
  if (europaTexCache) return europaTexCache;
  if (typeof document === 'undefined') {
    return (europaTexCache = createFallbackTexture(220, 225, 235));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 逐像素高精度水冰基底
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 5;
      const ny = py / H * 2.5;
      const n = fbm(nx, ny, 6);

      // 纯净水冰色调：极白到微蓝灰
      const base = 228 + n * 27;
      const r = Math.min(255, Math.round(base + 2));
      const g = Math.min(255, Math.round(base + 5));
      const b = Math.min(255, Math.round(base + 15));

      const idx = (py * W + px) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 极地微弱冰盖变暗
  const northDark = ctx.createLinearGradient(0, 0, 0, H * 0.12);
  northDark.addColorStop(0, 'rgba(190,195,210,0.35)');
  northDark.addColorStop(1, 'rgba(230,235,245,0.0)');
  ctx.fillStyle = northDark;
  ctx.fillRect(0, 0, W, H * 0.12);

  const southDark = ctx.createLinearGradient(0, H, 0, H * 0.88);
  southDark.addColorStop(0, 'rgba(190,195,210,0.35)');
  southDark.addColorStop(1, 'rgba(230,235,245,0.0)');
  ctx.fillStyle = southDark;
  ctx.fillRect(0, H * 0.88, W, H * 0.12);

  // 大型构造断裂 Lineae — 全球纵横交错
  const majorLineae = [
    // 主干大裂纹（宽而显眼）
    { pts: [[0.04,0.15],[0.28,0.38],[0.55,0.48],[0.78,0.62],[0.98,0.72]], w: 8 },
    { pts: [[0.96,0.10],[0.72,0.28],[0.45,0.42],[0.20,0.60],[0.02,0.78]], w: 7 },
    { pts: [[0.12,0.72],[0.38,0.58],[0.62,0.42],[0.85,0.25],[0.98,0.18]], w: 6 },
    { pts: [[0.02,0.48],[0.25,0.36],[0.52,0.30],[0.78,0.40],[0.99,0.52]], w: 6 },
    { pts: [[0.18,0.05],[0.32,0.28],[0.42,0.55],[0.48,0.78],[0.52,0.96]], w: 5 },
    // 次级裂纹
    { pts: [[0.60,0.08],[0.65,0.30],[0.72,0.52],[0.78,0.74],[0.80,0.95]], w: 4 },
    { pts: [[0.82,0.05],[0.75,0.22],[0.68,0.45],[0.62,0.70],[0.58,0.92]], w: 4 },
    { pts: [[0.02,0.30],[0.22,0.32],[0.48,0.38],[0.70,0.50],[0.92,0.62]], w: 4 },
    { pts: [[0.38,0.06],[0.42,0.28],[0.46,0.50],[0.50,0.72],[0.54,0.94]], w: 3.5 },
    { pts: [[0.88,0.20],[0.70,0.35],[0.50,0.55],[0.30,0.72],[0.12,0.88]], w: 3.5 },
    // 细小裂缝网络
    { pts: [[0.10,0.55],[0.25,0.48],[0.40,0.58],[0.55,0.52],[0.70,0.62]], w: 2.5 },
    { pts: [[0.35,0.22],[0.48,0.35],[0.60,0.30],[0.75,0.42],[0.90,0.38]], w: 2 },
  ];

  for (const l of majorLineae) {
    const pts = l.pts.map(p => [p[0] * W, p[1] * H]);

    // 1. 外缘宽矿物染色晕（橙褐色盐水矿物）
    ctx.strokeStyle = 'rgba(120,60,20,0.22)';
    ctx.lineWidth = l.w * 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();

    // 2. 中宽深红褐色主脊
    ctx.strokeStyle = `rgba(100,35,12,0.75)`;
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();

    // 3. 双脊中心亮线（新鲜冰）
    if (l.w > 3) {
      ctx.strokeStyle = 'rgba(245,250,255,0.70)';
      ctx.lineWidth = Math.max(0.8, l.w * 0.18);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const mx = (pts[i - 1][0] + pts[i][0]) / 2;
        const my = (pts[i - 1][1] + pts[i][1]) / 2;
        ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
  }

  // 柯纳马拉混沌地形（破碎冰山区）
  const chaosRegions = [
    { x: 0.30 * W, y: 0.50 * H, w: 140, h: 80, rot: 0.15 },
    { x: 0.65 * W, y: 0.38 * H, w: 120, h: 70, rot: -0.20 },
    { x: 0.50 * W, y: 0.72 * H, w: 100, h: 60, rot: 0.08 },
  ];
  for (const c of chaosRegions) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    const cg = ctx.createRadialGradient(0, 0, 10, 0, 0, Math.max(c.w, c.h));
    cg.addColorStop(0, 'rgba(130,60,25,0.40)');
    cg.addColorStop(0.6, 'rgba(100,40,15,0.22)');
    cg.addColorStop(1, 'rgba(230,235,245,0.0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(0, 0, c.w, c.h, 0, 0, Math.PI * 2);
    ctx.fill();

    // 碎冰块多边形轮廓
    ctx.strokeStyle = 'rgba(80,35,10,0.55)';
    ctx.lineWidth = 1.2;
    for (let p = 0; p < 22; p++) {
      const px = (hash(p, c.x) - 0.5) * c.w * 1.6;
      const py = (hash(p * 3, c.y) - 0.5) * c.h * 1.6;
      const pw = 8 + hash(p + 1, c.y) * 18;
      const ph = 5 + hash(p + 2, c.x) * 12;
      ctx.strokeRect(px, py, pw, ph);
    }
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (europaTexCache = tex);
}

/**
 * 3. 土卫二 (Enceladus) — 极高反照率水冰与南极虎纹
 * 参考：NASA Cassini PIA17202, PIA11114
 */
export function getEnceladusTexture(): THREE.Texture {
  if (enceladusTexCache) return enceladusTexCache;
  if (typeof document === 'undefined') {
    return (enceladusTexCache = createFallbackTexture(240, 245, 255));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 逐像素精确白冰底色（极高反照率 0.99）
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 8;
      const ny = py / H * 4;
      const n = fbm(nx, ny, 5);
      // 极白到微蓝白冰
      const base = 245 + n * 10;
      const r = Math.min(255, Math.round(base));
      const g = Math.min(255, Math.round(base + 1));
      const b = Math.min(255, Math.round(base + 8));
      const idx = (py * W + px) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 北半球古老撞击坑区（微暗灰区）
  const oldTerrain = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  oldTerrain.addColorStop(0, 'rgba(200, 210, 225, 0.28)');
  oldTerrain.addColorStop(1, 'rgba(240, 245, 255, 0.0)');
  ctx.fillStyle = oldTerrain;
  ctx.fillRect(0, 0, W, H * 0.38);

  // 撞击坑（集中于北半球）
  for (let i = 0; i < 280; i++) {
    const x = hash(i, 7) * W;
    const y = hash(i, 11) * H * 0.42; // 北半球
    const r = 3 + hash(i, 13) * 18;
    ctx.fillStyle = `rgba(200,210,225,${0.20 + hash(i, 17) * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 南极热活动区渐变（卡西尼 CIRS 热成像结果）
  const spGrad = ctx.createLinearGradient(0, H, 0, H * 0.48);
  spGrad.addColorStop(0.0, 'rgba(0, 130, 180, 0.50)');
  spGrad.addColorStop(0.25, 'rgba(10, 160, 200, 0.35)');
  spGrad.addColorStop(0.55, 'rgba(30, 190, 220, 0.18)');
  spGrad.addColorStop(0.80, 'rgba(80, 210, 235, 0.08)');
  spGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = spGrad;
  ctx.fillRect(0, H * 0.48, W, H * 0.52);

  // 南极四道平行虎纹（Damascus, Baghdad, Alexandria, Cairo Sulci）
  const tigerStripes = [
    { yCtr: 0.590, curveAmpl: -0.028, wPx: 7.0, color: '#0369a1', glowColor: 'rgba(6,182,212,0.55)' },
    { yCtr: 0.645, curveAmpl: -0.035, wPx: 9.0, color: '#0284c7', glowColor: 'rgba(6,182,212,0.60)' },
    { yCtr: 0.705, curveAmpl: -0.031, wPx: 10.5, color: '#0369a1', glowColor: 'rgba(2,140,190,0.60)' },
    { yCtr: 0.760, curveAmpl: -0.023, wPx: 8.0, color: '#0c4a6e', glowColor: 'rgba(6,150,200,0.55)' },
  ];

  for (const s of tigerStripes) {
    const y0 = s.yCtr * H;
    const amp = s.curveAmpl * H;
    // 构建贝塞尔曲线点
    const x1 = W * 0.04, x2 = W / 2, x3 = W * 0.96;
    const y1 = y0, y2 = y0 + amp, y3 = y0;

    // 外发光晕
    ctx.strokeStyle = s.glowColor;
    ctx.lineWidth = s.wPx * 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(x2, y2, x3, y3);
    ctx.stroke();

    // 主槽深蓝
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.wPx;
    ctx.beginPath();
    ctx.moveTo(x1 + W * 0.02, y1);
    ctx.quadraticCurveTo(x2, y2, x3 - W * 0.02, y3);
    ctx.stroke();

    // 核心最深槽（热液活动渗透线）
    ctx.strokeStyle = '#082f49';
    ctx.lineWidth = s.wPx * 0.30;
    ctx.beginPath();
    ctx.moveTo(x1 + W * 0.05, y1);
    ctx.quadraticCurveTo(x2, y2, x3 - W * 0.05, y3);
    ctx.stroke();

    // 冰喷泉爆发点（热亮白点）
    for (let g = 0; g < 9; g++) {
      const t = (g + 0.5) / 9;
      const gx = x1 + t * (x3 - x1);
      const gy = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * y2 + t * t * y3;
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 5);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.5, 'rgba(200,240,255,0.50)');
      gr.addColorStop(1, 'rgba(0,180,220,0.0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(gx, gy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (enceladusTexCache = tex);
}

/**
 * 4. 土卫六 (Titan) — Cassini 938nm 近红外穿透地表
 * 参考：NASA/ESA Cassini VIMS 近红外合成图像 (PIA14909)
 */
export function getTitanNearInfraredTexture(): THREE.Texture {
  if (titanInfraredTexCache) return titanInfraredTexCache;
  if (typeof document === 'undefined') {
    return (titanInfraredTexCache = createFallbackTexture(180, 140, 100));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 近红外成像：中等反照率有机物基底（橙褐主色调）
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 4;
      const ny = py / H * 2;
      const n1 = fbm(nx, ny, 6);
      const n2 = fbm(nx * 1.5 + 3, ny * 1.5 + 3, 4);

      // 赤道中纬度：橙褐色（有机固体沉积物）
      const latFactor = Math.abs(py / H - 0.5) * 2; // 0=赤道 1=极
      let r = Math.round(180 + n1 * 40 - latFactor * 20);
      let g = Math.round(110 + n1 * 30 - latFactor * 15);
      let b = Math.round(50 + n1 * 20 - latFactor * 10);
      r += Math.round((n2 - 0.5) * 25);
      g += Math.round((n2 - 0.5) * 18);

      const idx = (py * W + px) * 4;
      d[idx] = Math.min(255, Math.max(0, r));
      d[idx + 1] = Math.min(255, Math.max(0, g));
      d[idx + 2] = Math.min(255, Math.max(0, b));
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 上都高地 (Xanadu Regio) — 明亮冰质硅酸盐高原，经度约 90-180°W，纬度 ±30°
  const xanaduX = W * 0.38, xanaduY = H * 0.50;
  const xanaduW = W * 0.21, xanaduH = H * 0.32;
  const xanadu = ctx.createRadialGradient(xanaduX, xanaduY, 20, xanaduX, xanaduY, Math.max(xanaduW, xanaduH));
  xanadu.addColorStop(0.0, 'rgba(245,230,160,0.88)');
  xanadu.addColorStop(0.35, 'rgba(225,200,130,0.72)');
  xanadu.addColorStop(0.70, 'rgba(200,165,100,0.45)');
  xanadu.addColorStop(1.0, 'rgba(175,120,60,0.0)');
  ctx.fillStyle = xanadu;
  ctx.save();
  ctx.translate(xanaduX, xanaduY);
  ctx.rotate(0.15);
  ctx.beginPath();
  ctx.ellipse(0, 0, xanaduW, xanaduH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 香格里拉沙丘带 (Shangri-La) — 赤道暗色有机沙漠，经度约 120°W-240°W
  ctx.fillStyle = 'rgba(25, 15, 5, 0.80)';
  const dunes = [
    { x: W * 0.08, y: H * 0.49, rx: W * 0.095, ry: H * 0.085, rot: 0.04 },
    { x: W * 0.72, y: H * 0.50, rx: W * 0.165, ry: H * 0.095, rot: -0.03 },
    { x: W * 0.90, y: H * 0.48, rx: W * 0.075, ry: H * 0.080, rot: 0.02 },
    { x: W * 0.22, y: H * 0.54, rx: W * 0.065, ry: H * 0.055, rot: -0.05 },
  ];
  for (const dune of dunes) {
    ctx.save();
    ctx.translate(dune.x, dune.y);
    ctx.rotate(dune.rot);
    const dg = ctx.createRadialGradient(0, 0, 5, 0, 0, Math.max(dune.rx, dune.ry));
    dg.addColorStop(0, 'rgba(18,10,3,0.85)');
    dg.addColorStop(0.6, 'rgba(30,18,6,0.65)');
    dg.addColorStop(1, 'rgba(175,120,60,0.0)');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(0, 0, dune.rx, dune.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 北极液态甲烷/乙烷海（零反照率深黑）
  const polarSeas = [
    { x: W * 0.52, y: H * 0.065, rx: W * 0.055, ry: H * 0.052, name: 'Kraken Mare' },
    { x: W * 0.64, y: H * 0.058, rx: W * 0.038, ry: H * 0.040, name: 'Ligeia Mare' },
    { x: W * 0.46, y: H * 0.050, rx: W * 0.024, ry: H * 0.028, name: 'Punga Mare' },
    { x: W * 0.73, y: H * 0.075, rx: W * 0.018, ry: H * 0.022, name: 'Jingpo Lacus' },
    { x: W * 0.38, y: H * 0.045, rx: W * 0.012, ry: H * 0.016, name: 'Bolsena Lacus' },
  ];
  for (const sea of polarSeas) {
    const sg = ctx.createRadialGradient(sea.x, sea.y, 3, sea.x, sea.y, Math.max(sea.rx, sea.ry));
    sg.addColorStop(0, 'rgba(3,5,12,0.92)');
    sg.addColorStop(0.6, 'rgba(5,8,18,0.78)');
    sg.addColorStop(1, 'rgba(30,15,5,0.0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(sea.x, sea.y, sea.rx, sea.ry, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 北极大气云帽（季节性极区深色雾层）
  const northCap = ctx.createLinearGradient(0, 0, 0, H * 0.10);
  northCap.addColorStop(0, 'rgba(70,40,15,0.50)');
  northCap.addColorStop(1, 'rgba(70,40,15,0.0)');
  ctx.fillStyle = northCap;
  ctx.fillRect(0, 0, W, H * 0.10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (titanInfraredTexCache = tex);
}

/**
 * 4.1 土卫六可见光大气烟雾纹理（橙色光化学烟雾层）
 */
export function getTitanHazeTexture(): THREE.Texture {
  if (titanHazeTexCache) return titanHazeTexCache;
  if (typeof document === 'undefined') {
    return (titanHazeTexCache = createFallbackTexture(210, 130, 40));
  }

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 逐像素烟雾层（tholins 光化学烟雾真实颜色：橙红到金黄）
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 5;
      const ny = py / H * 2.5;
      const n = fbm(nx, ny, 5);
      const lat = Math.abs(py / H - 0.5) * 2;

      // 橙色索林斯（光化学烟雾）色调
      const r = Math.round(210 + n * 30 - lat * 15);
      const g = Math.round(105 + n * 35 - lat * 25);
      const b = Math.round(20 + n * 20);

      const idx = (py * W + px) * 4;
      d[idx] = Math.min(255, r); d[idx + 1] = Math.min(255, g); d[idx + 2] = Math.min(255, b); d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 北极深色极区头罩（North Polar Hood）
  const hood = ctx.createLinearGradient(0, 0, 0, H * 0.12);
  hood.addColorStop(0, 'rgba(90,35,8,0.75)');
  hood.addColorStop(1, 'rgba(90,35,8,0.0)');
  ctx.fillStyle = hood;
  ctx.fillRect(0, 0, W, H * 0.14);

  // 南极略暗
  const sHood = ctx.createLinearGradient(0, H, 0, H * 0.90);
  sHood.addColorStop(0, 'rgba(80,30,6,0.40)');
  sHood.addColorStop(1, 'rgba(80,30,6,0.0)');
  ctx.fillStyle = sHood;
  ctx.fillRect(0, H * 0.88, W, H * 0.12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (titanHazeTexCache = tex);
}

/**
 * 5. 木卫三 (Ganymede) — 古老暗色区与年轻冰质沟槽带
 * 参考：NASA Galileo SSI (PIA02278)，Juno PJ34
 */
export function getGanymedeTexture(): THREE.Texture {
  if (ganymedeTexCache) return ganymedeTexCache;
  if (typeof document === 'undefined') {
    return (ganymedeTexCache = createFallbackTexture(156, 163, 175));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 逐像素双区域底色（暗色古地和浅色冰沟带）
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 6;
      const ny = py / H * 3;
      const n1 = fbm(nx, ny, 7);
      const n2 = fbm(nx * 2 + 4, ny * 2 + 4, 5);

      // 双模分布：暗色古老区 vs 浅色沟槽带
      let r, g, b;
      if (n1 < 0.42) {
        // Galileo Regio 风格暗色区：深蓝灰
        const t = n1 / 0.42;
        r = Math.round(55 + t * 35); g = Math.round(60 + t * 38); b = Math.round(75 + t * 45);
      } else if (n1 < 0.58) {
        // 过渡区
        const t = (n1 - 0.42) / 0.16;
        r = Math.round(90 + t * 70); g = Math.round(98 + t * 72); b = Math.round(120 + t * 70);
      } else {
        // 浅色冰质沟槽带：亮蓝灰
        const t = (n1 - 0.58) / 0.42;
        r = Math.round(155 + t * 50); g = Math.round(165 + t * 50); b = Math.round(185 + t * 45);
      }

      r += Math.round((n2 - 0.5) * 22);
      g += Math.round((n2 - 0.5) * 22);
      b += Math.round((n2 - 0.5) * 22);

      const idx = (py * W + px) * 4;
      d[idx] = Math.min(255, Math.max(0, r));
      d[idx + 1] = Math.min(255, Math.max(0, g));
      d[idx + 2] = Math.min(255, Math.max(0, b));
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 极地白色冰盖
  const nPolar = ctx.createLinearGradient(0, 0, 0, H * 0.15);
  nPolar.addColorStop(0, 'rgba(220,225,235,0.50)');
  nPolar.addColorStop(1, 'rgba(220,225,235,0.0)');
  ctx.fillStyle = nPolar;
  ctx.fillRect(0, 0, W, H * 0.16);

  const sPolar = ctx.createLinearGradient(0, H, 0, H * 0.85);
  sPolar.addColorStop(0, 'rgba(220,225,235,0.45)');
  sPolar.addColorStop(1, 'rgba(220,225,235,0.0)');
  ctx.fillStyle = sPolar;
  ctx.fillRect(0, H * 0.84, W, H * 0.16);

  // 大型撞击坑（射线纹特征）
  const craters = [
    { x: W * 0.28, y: H * 0.35, r: 32, bright: true },
    { x: W * 0.62, y: H * 0.55, r: 26, bright: true },
    { x: W * 0.82, y: H * 0.28, r: 20, bright: false },
    { x: W * 0.14, y: H * 0.62, r: 18, bright: true },
    { x: W * 0.48, y: H * 0.72, r: 15, bright: false },
    { x: W * 0.75, y: H * 0.72, r: 12, bright: true },
  ];
  for (const c of craters) {
    // 坑体
    const cg = ctx.createRadialGradient(c.x - c.r * 0.15, c.y - c.r * 0.15, 2, c.x, c.y, c.r);
    cg.addColorStop(0, '#c8d0e0');
    cg.addColorStop(0.35, '#8090a8');
    cg.addColorStop(0.7, '#556070');
    cg.addColorStop(1, 'rgba(60,70,90,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();

    if (c.bright) {
      // 射线纹（新鲜亮冰溅射）
      ctx.strokeStyle = 'rgba(210,220,235,0.50)';
      ctx.lineWidth = 1.2;
      for (let a = 0; a < 12; a++) {
        const angle = (a / 12) * Math.PI * 2;
        const len = c.r * (2.5 + hash(a, c.x) * 3);
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(angle) * c.r * 0.9, c.y + Math.sin(angle) * c.r * 0.9);
        ctx.lineTo(c.x + Math.cos(angle) * len, c.y + Math.sin(angle) * len);
        ctx.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (ganymedeTexCache = tex);
}

/**
 * 6. 木卫四 (Callisto) — 极度古老撞击坑饱和表面与瓦尔哈拉盆地
 * 参考：NASA Galileo (PIA03456)
 */
export function getCallistoTexture(): THREE.Texture {
  if (callistoTexCache) return callistoTexCache;
  if (typeof document === 'undefined') {
    return (callistoTexCache = createFallbackTexture(107, 114, 128));
  }

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 极古老深灰碳质冰岩底色
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 8;
      const ny = py / H * 4;
      const n = fbm(nx, ny, 7);
      const r = Math.round(40 + n * 55);
      const g = Math.round(44 + n * 58);
      const b = Math.round(55 + n * 65);
      const idx = (py * W + px) * 4;
      d[idx] = Math.min(255, r); d[idx + 1] = Math.min(255, g); d[idx + 2] = Math.min(255, b); d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 密集的饱和撞击坑（太阳系最古老表面之一）
  for (let i = 0; i < 1200; i++) {
    const x = hash(i, 3) * W;
    const y = hash(i, 7) * H;
    const r = 2 + hash(i, 11) * 16;
    // 坑内深暗
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(15,18,22,0.75)');
    cg.addColorStop(0.6, 'rgba(25,28,35,0.50)');
    cg.addColorStop(1, 'rgba(45,50,65,0.0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 坑沿水冰霜冻反射
    if (hash(i, 13) > 0.5) {
      ctx.strokeStyle = `rgba(180,190,210,${0.20 + hash(i, 17) * 0.25})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 瓦尔哈拉巨型多重环撞击盆地 (Valhalla Impact Basin, 经度约 0°, 纬度约 +10°)
  const vx = W * 0.62, vy = H * 0.44;
  // 中央亮斑（高反照率冰体）
  const vCenter = ctx.createRadialGradient(vx, vy, 0, vx, vy, 22);
  vCenter.addColorStop(0, '#e8edf5');
  vCenter.addColorStop(0.5, '#b0bcc8');
  vCenter.addColorStop(1, 'rgba(100,115,130,0)');
  ctx.fillStyle = vCenter;
  ctx.beginPath();
  ctx.arc(vx, vy, 22, 0, Math.PI * 2);
  ctx.fill();

  // 多重环结构（每环间距约 60px，共8环）
  for (let ring = 0; ring < 8; ring++) {
    const ringR = 38 + ring * 52;
    const opacity = 0.45 - ring * 0.045;
    ctx.strokeStyle = `rgba(160,175,195,${Math.max(0.10, opacity)})`;
    ctx.lineWidth = 2.0 - ring * 0.18;
    ctx.beginPath();
    ctx.arc(vx, vy, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (callistoTexCache = tex);
}

/**
 * 7. 火星小卫星 Phobos & Deimos
 * 参考：NASA MRO HiRISE (Phobos PIA10368), Viking (Deimos)
 */
export function getMarsMoonTexture(isPhobos: boolean): THREE.Texture {
  if (isPhobos && phobosTexCache) return phobosTexCache;
  if (!isPhobos && deimosTexCache) return deimosTexCache;

  if (typeof document === 'undefined') {
    const fallback = createFallbackTexture(120, 110, 100);
    return isPhobos ? (phobosTexCache = fallback) : (deimosTexCache = fallback);
  }

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 暗色碳质风化层底色（逐像素噪声）
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / W * 8;
      const ny = py / H * 4;
      const n = fbm(nx, ny, 6);
      // 火卫一偏暗灰棕，火卫二偏浅暖灰
      const base = isPhobos ? (55 + n * 55) : (80 + n * 50);
      const tint = isPhobos ? 0.88 : 0.92;
      const r = Math.round(base * tint);
      const g = Math.round(base * 0.92);
      const b = Math.round(base * 0.82);
      const idx = (py * W + px) * 4;
      d[idx] = Math.min(255, r); d[idx + 1] = Math.min(255, g); d[idx + 2] = Math.min(255, b); d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 随机撞击坑群
  const craterCount = isPhobos ? 280 : 220;
  for (let i = 0; i < craterCount; i++) {
    const x = hash(i, 5) * W;
    const y = hash(i, 9) * H;
    const r = 2 + hash(i, 13) * (isPhobos ? 10 : 8);
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(20,18,14,0.70)');
    cg.addColorStop(0.6, 'rgba(35,30,24,0.45)');
    cg.addColorStop(1, 'rgba(80,72,60,0.0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // 坑沿高光
    ctx.strokeStyle = `rgba(140,130,115,${0.25 + hash(i, 17) * 0.20})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isPhobos) {
    // 斯蒂克尼 (Stickney) 巨型撞击坑 — 直径 9km, 约占火卫一半径的 80%
    const sx = W * 0.42, sy = H * 0.47, sr = 65;

    const sGrad = ctx.createRadialGradient(sx - sr * 0.15, sy - sr * 0.15, 4, sx, sy, sr);
    sGrad.addColorStop(0.0, '#0f0d0b');
    sGrad.addColorStop(0.30, '#1e1a15');
    sGrad.addColorStop(0.65, '#302820');
    sGrad.addColorStop(0.85, '#5a4e40');
    sGrad.addColorStop(1.0, 'rgba(80,70,55,0)');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

    // 坑沿高光弧
    ctx.strokeStyle = 'rgba(160,145,120,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 0.88, Math.PI * 1.25, Math.PI * 2.25);
    ctx.stroke();

    // 放射状深沟断裂线（Stickney ejecta grooves）
    ctx.strokeStyle = 'rgba(25,22,18,0.55)';
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2 + 0.2;
      const len = sr + 60 + hash(a, sx) * 90;
      ctx.lineWidth = 1.5 + hash(a + 3, sy) * 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * sr * 0.9, sy + Math.sin(angle) * sr * 0.9);
      ctx.lineTo(sx + Math.cos(angle + (hash(a, 99) - 0.5) * 0.25) * (sr + len),
                 sy + Math.sin(angle + (hash(a, 99) - 0.5) * 0.25) * (sr + len));
      ctx.stroke();
    }
  } else {
    // 火卫二特有：厚厚松散尘埃层使坑缘更模糊
    // 添加几个较清晰的特征坑
    const deimosFeatures = [
      { x: W * 0.35, y: H * 0.42, r: 22 },
      { x: W * 0.62, y: H * 0.55, r: 17 },
      { x: W * 0.20, y: H * 0.60, r: 14 },
    ];
    for (const df of deimosFeatures) {
      const fg = ctx.createRadialGradient(df.x, df.y, 2, df.x, df.y, df.r);
      fg.addColorStop(0, 'rgba(15,12,10,0.65)');
      fg.addColorStop(0.7, 'rgba(30,26,20,0.35)');
      fg.addColorStop(1, 'rgba(90,82,70,0.0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(df.x, df.y, df.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (isPhobos) {
    return (phobosTexCache = tex);
  } else {
    return (deimosTexCache = tex);
  }
}
