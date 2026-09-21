/**
 * 太阳系核心卫星与微卫星高拟真程序化 PBR 纹理生成器
 * 100% 离线 Canvas 2D 生成真实天体表面地貌，零外部网络依赖：
 * 1. 木卫一 (Io)：硫磺熔岩地貌、Loki Patera 与 Pele 活火山破火山口、玄武岩暗斑与二氧化硫白霜；
 * 2. 木卫二 (Europa)：高反照率纯净水冰壳、纵横交错的红褐色双脊冰裂纹 (Lineae) 与 Conamara 混沌地形；
 * 3. 土卫二 (Enceladus)：高反照率水冰球体、南极平行青蓝色“虎纹”裂缝 (Tiger Stripes) 冰喷泉源；
 * 4. 土卫六 (Titan)：自然可见光致密橘黄光化学烟雾，与卡西尼号 938nm 近红外穿透地表（Xanadu 高地与赤道沙丘、北极甲烷海）；
 * 5. 木卫三 (Ganymede) & 木卫四 (Callisto)：古老多边形撞击暗区、浅色沟槽带与瓦尔哈拉多重环撞击盆地；
 * 6. 火卫一与火卫二 (Phobos & Deimos)：斯蒂克尼巨型撞击坑与碳质小行星风化层。
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

/**
 * 1. 木卫一 (Io) - 硫磺地狱与活跃火山破火山口
 */
export function getIoTexture(): THREE.Texture {
  if (ioTexCache) return ioTexCache;
  if (typeof document === 'undefined') {
    return (ioTexCache = createFallbackTexture(234, 179, 8));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 基础底色：硫磺金黄与芥末微橙斑驳过渡
  const baseGrad = ctx.createLinearGradient(0, 0, 0, 512);
  baseGrad.addColorStop(0.0, '#ca8a04');
  baseGrad.addColorStop(0.2, '#eab308');
  baseGrad.addColorStop(0.5, '#facc15');
  baseGrad.addColorStop(0.8, '#eab308');
  baseGrad.addColorStop(1.0, '#a16207');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 1024, 512);

  // 二氧化硫与硫磺风化层斑驳噪点
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    const r = 4 + Math.random() * 22;
    const alpha = 0.08 + Math.random() * 0.15;
    const isBright = Math.random() > 0.45;
    ctx.fillStyle = isBright
      ? `rgba(254, 240, 138, ${alpha})`
      : `rgba(180, 83, 9, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 极地白色二氧化硫霜冻沉积
  const northFrost = ctx.createLinearGradient(0, 0, 0, 110);
  northFrost.addColorStop(0, 'rgba(254, 249, 195, 0.45)');
  northFrost.addColorStop(1, 'rgba(254, 249, 195, 0.0)');
  ctx.fillStyle = northFrost;
  ctx.fillRect(0, 0, 1024, 110);

  const southFrost = ctx.createLinearGradient(0, 512, 0, 402);
  southFrost.addColorStop(0, 'rgba(254, 249, 195, 0.45)');
  southFrost.addColorStop(1, 'rgba(254, 249, 195, 0.0)');
  ctx.fillStyle = southFrost;
  ctx.fillRect(0, 402, 1024, 110);

  // 著名活火山中心点 (Patera 与喷发羽流环)
  const volcanoes = [
    { x: 380, y: 240, r: 28, name: 'Loki Patera', lava: '#1c1917', plume: '#ef4444' },
    { x: 720, y: 310, r: 34, name: 'Pele', lava: '#292524', plume: '#dc2626' },
    { x: 540, y: 200, r: 20, name: 'Prometheus', lava: '#1c1917', plume: '#f97316' },
    { x: 180, y: 270, r: 24, name: 'Tvashtar', lava: '#451a03', plume: '#ea580c' },
    { x: 880, y: 190, r: 22, name: 'Amirani', lava: '#1c1917', plume: '#b45309' },
    { x: 260, y: 360, r: 18, name: 'Babbar Patera', lava: '#3f3f46', plume: '#e11d48' },
    { x: 620, y: 380, r: 16, name: 'Marduk', lava: '#1c1917', plume: '#f43f5e' },
  ];

  for (const v of volcanoes) {
    // 1. 巨大红色硫磺沉积羽流环 (Red Sulfur Ring)
    const plumeGrad = ctx.createRadialGradient(v.x, v.y, v.r * 0.4, v.x, v.y, v.r * 2.8);
    plumeGrad.addColorStop(0.0, 'rgba(220, 38, 38, 0.7)');
    plumeGrad.addColorStop(0.6, 'rgba(234, 88, 12, 0.4)');
    plumeGrad.addColorStop(1.0, 'rgba(234, 179, 8, 0.0)');
    ctx.fillStyle = plumeGrad;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.r * 2.8, 0, Math.PI * 2);
    ctx.fill();

    // 2. 白色二氧化硫同心霜冻光圈
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.r * 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // 3. 破火山口黑色/深褐玄武岩熔岩湖
    ctx.fillStyle = v.lava;
    ctx.beginPath();
    ctx.ellipse(v.x, v.y, v.r, v.r * 0.75, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. 熔岩裂谷溢流蛛网
    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 2;
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(
        v.x + Math.cos(angle) * (v.r * 1.8 + Math.random() * 15),
        v.y + Math.sin(angle) * (v.r * 1.8 + Math.random() * 15)
      );
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (ioTexCache = tex);
}

/**
 * 2. 木卫二 (Europa) - 纯白冰壳与红褐色交错线状裂隙 (Lineae)
 */
export function getEuropaTexture(): THREE.Texture {
  if (europaTexCache) return europaTexCache;
  if (typeof document === 'undefined') {
    return (europaTexCache = createFallbackTexture(220, 225, 235));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 极高反照率纯净水冰壳底色（微蓝淡白）
  const iceGrad = ctx.createLinearGradient(0, 0, 0, 512);
  iceGrad.addColorStop(0.0, '#e2e8f0');
  iceGrad.addColorStop(0.3, '#f8fafc');
  iceGrad.addColorStop(0.7, '#f1f5f9');
  iceGrad.addColorStop(1.0, '#cbd5e1');
  ctx.fillStyle = iceGrad;
  ctx.fillRect(0, 0, 1024, 512);

  // 潮汐拉伸混沌微小冰丘与微小破裂
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    const r = 2 + Math.random() * 12;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 绘制标志性红褐色双脊冰裂纹 (Lineae)
  // 木卫二表面纵横交错数千公里的构造大裂缝
  const lineaeSeeds = [
    { x1: 50, y1: 80, cx1: 300, cy1: 220, cx2: 600, cy2: 300, x2: 950, y2: 440, w: 4 },
    { x1: 980, y1: 60, cx1: 750, cy1: 200, cx2: 350, cy2: 350, x2: 80, y2: 480, w: 5 },
    { x1: 150, y1: 420, cx1: 400, cy1: 320, cx2: 650, cy2: 150, x2: 850, y2: 100, w: 3.5 },
    { x1: 0, y1: 260, cx1: 280, cy1: 180, cx2: 780, cy2: 380, x2: 1024, y2: 240, w: 4.5 },
    { x1: 220, y1: 20, cx1: 340, cy1: 240, cx2: 460, cy2: 380, x2: 520, y2: 500, w: 3 },
    { x1: 700, y1: 40, cx1: 620, cy1: 210, cx2: 580, cy2: 360, x2: 480, y2: 490, w: 3.2 },
    { x1: 420, y1: 90, cx1: 560, cy1: 280, cx2: 720, cy2: 320, x2: 920, y2: 380, w: 3 },
    { x1: 80, y1: 160, cx1: 240, cy1: 300, cx2: 420, cy2: 420, x2: 600, y2: 470, w: 2.8 },
  ];

  for (const l of lineaeSeeds) {
    // 1. 红褐色富盐水矿物染色扩散带
    ctx.strokeStyle = 'rgba(153, 27, 27, 0.28)';
    ctx.lineWidth = l.w * 3.8;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.bezierCurveTo(l.cx1, l.cy1, l.cx2, l.cy2, l.x2, l.y2);
    ctx.stroke();

    // 2. 主裂纹深红脊线
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.bezierCurveTo(l.cx1, l.cy1, l.cx2, l.cy2, l.x2, l.y2);
    ctx.stroke();

    // 3. 双脊特征（中央深凹槽，两侧明亮隆起）
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(l.x1 + 1.5, l.y1 + 1.5);
    ctx.bezierCurveTo(l.cx1 + 1.5, l.cy1 + 1.5, l.cx2 + 1.5, l.cy2 + 1.5, l.x2 + 1.5, l.y2 + 1.5);
    ctx.stroke();
  }

  // 柯纳马拉混沌地形群 (Conamara Chaos - 破裂冰山翻转漂移区)
  const chaosCenters = [
    { x: 320, y: 250, r: 45 },
    { x: 680, y: 190, r: 38 },
  ];
  for (const c of chaosCenters) {
    const chaosGrad = ctx.createRadialGradient(c.x, c.y, 5, c.x, c.y, c.r);
    chaosGrad.addColorStop(0.0, 'rgba(180, 83, 9, 0.45)');
    chaosGrad.addColorStop(0.7, 'rgba(153, 27, 27, 0.25)');
    chaosGrad.addColorStop(1.0, 'rgba(241, 245, 249, 0.0)');
    ctx.fillStyle = chaosGrad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();

    // 浮冰碎块碎片
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.5;
    for (let p = 0; p < 18; p++) {
      const px = c.x + (Math.random() - 0.5) * c.r * 1.5;
      const py = c.y + (Math.random() - 0.5) * c.r * 1.5;
      ctx.strokeRect(px, py, 6 + Math.random() * 8, 4 + Math.random() * 6);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (europaTexCache = tex);
}

/**
 * 3. 土卫二 (Enceladus) - 纯净反照率水冰与南极深青色“虎纹”裂缝 (Tiger Stripes)
 */
export function getEnceladusTexture(): THREE.Texture {
  if (enceladusTexCache) return enceladusTexCache;
  if (typeof document === 'undefined') {
    return (enceladusTexCache = createFallbackTexture(240, 245, 255));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 全太阳系最高几何反照率 (99% 反射) 的白雪纯冰球体
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1024, 512);

  // 北半球古老撞击坑群（微弱浅蓝灰）
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 220; // 集中于北半球
    const r = 2 + Math.random() * 14;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 南极温热平坦冰原深青蓝晕 (South Polar Terrain - 卡西尼号 CIRS 红外温热异常区)
  const spGrad = ctx.createLinearGradient(0, 512, 0, 240);
  spGrad.addColorStop(0.0, 'rgba(6, 182, 212, 0.45)');
  spGrad.addColorStop(0.4, 'rgba(14, 165, 233, 0.25)');
  spGrad.addColorStop(0.75, 'rgba(56, 189, 248, 0.12)');
  spGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = spGrad;
  ctx.fillRect(0, 240, 1024, 272);

  // 绘制南极四道著名的平行构造断裂带——“虎纹” (Tiger Stripes)
  // Damascus, Baghdad, Alexandria, Cairo Sulci（长达 130km、宽 2km、深 500m）
  const tigerStripes = [
    { y: 310, curve: -28, w: 5.5, label: 'Alexandria Sulcus' },
    { y: 355, curve: -35, w: 7.0, label: 'Cairo Sulcus' },
    { y: 405, curve: -32, w: 8.0, label: 'Baghdad Sulcus' },
    { y: 450, curve: -24, w: 6.0, label: 'Damascus Sulcus' },
  ];

  for (const s of tigerStripes) {
    // 1. 虎纹青蓝色新鲜水冰与喷流沉淀外缘光晕
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.55)';
    ctx.lineWidth = s.w * 2.6;
    ctx.beginPath();
    ctx.moveTo(120, s.y);
    ctx.quadraticCurveTo(512, s.y + s.curve, 904, s.y);
    ctx.stroke();

    // 2. 虎纹深青蓝色中心构造大凹槽
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(140, s.y);
    ctx.quadraticCurveTo(512, s.y + s.curve, 884, s.y);
    ctx.stroke();

    // 3. 核心地热活动喷射孔裂隙深蓝/墨蓝色暗线
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(180, s.y);
    ctx.quadraticCurveTo(512, s.y + s.curve, 844, s.y);
    ctx.stroke();

    // 4. 冰喷泉喷气点亮点 (Geyser Eruption Hotspots)
    ctx.fillStyle = '#ffffff';
    for (let g = 0; g < 7; g++) {
      const gx = 250 + g * 85 + (Math.random() - 0.5) * 20;
      const t = (gx - 120) / (904 - 120);
      const gy = (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * (s.y + s.curve) + t * t * s.y;
      ctx.beginPath();
      ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (enceladusTexCache = tex);
}

/**
 * 4. 土卫六 (Titan) - 卡西尼号 938nm 近红外穿透地表
 * 揭示真实的赤道有机沙丘 (Shangri-La, Belet)、明亮冰质高地 (Xanadu) 与北极液态甲烷海洋 (Kraken Mare)
 */
export function getTitanNearInfraredTexture(): THREE.Texture {
  if (titanInfraredTexCache) return titanInfraredTexCache;
  if (typeof document === 'undefined') {
    return (titanInfraredTexCache = createFallbackTexture(180, 140, 100));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 近红外高地背景反照率 (明亮硅酸盐水冰基底)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
  bgGrad.addColorStop(0.0, '#94a3b8');
  bgGrad.addColorStop(0.2, '#d97706');
  bgGrad.addColorStop(0.5, '#fbbf24');
  bgGrad.addColorStop(0.8, '#d97706');
  bgGrad.addColorStop(1.0, '#64748b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1024, 512);

  // 1. 明亮巨大水冰高地大陆——上都 (Xanadu Regio, 位于经度 ~100°W)
  const xanaduGrad = ctx.createRadialGradient(420, 256, 30, 420, 256, 170);
  xanaduGrad.addColorStop(0.0, '#fef08a');
  xanaduGrad.addColorStop(0.5, '#fde68a');
  xanaduGrad.addColorStop(0.9, '#f59e0b');
  xanaduGrad.addColorStop(1.0, 'rgba(217, 119, 6, 0.0)');
  ctx.fillStyle = xanaduGrad;
  ctx.beginPath();
  ctx.ellipse(420, 256, 190, 130, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // 2. 赤道暗色有机碳氢化合物沙丘带 (Shangri-La, Belet, Fensal)
  // 低反照率固体烃类微粒沉降积聚的黑色沙海
  ctx.fillStyle = '#1e293b';
  const dunes = [
    { x: 120, y: 280, rx: 120, ry: 45, rot: 0.05 },
    { x: 740, y: 270, rx: 190, ry: 55, rot: -0.04 },
    { x: 920, y: 250, rx: 110, ry: 40, rot: 0.02 },
  ];
  for (const d of dunes) {
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.rx, d.ry, d.rot, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. 北极极区液态烃类湖泊与海洋群 (Kraken Mare, Ligeia Mare, Punga Mare)
  // 零反照率深黑液态甲烷与乙烷水体
  ctx.fillStyle = '#020617';
  // 克拉肯海 (Kraken Mare - 土卫六最大甲烷海，面积相当于里海)
  ctx.beginPath();
  ctx.ellipse(530, 70, 75, 45, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // 丽姬亚海 (Ligeia Mare)
  ctx.beginPath();
  ctx.ellipse(660, 60, 50, 35, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // 蓬加海 (Punga Mare)
  ctx.beginPath();
  ctx.ellipse(470, 50, 30, 22, 0.3, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (titanInfraredTexCache = tex);
}

/**
 * 4.1 土卫六可见光浓厚光化学烟雾大气层纹理
 */
export function getTitanHazeTexture(): THREE.Texture {
  if (titanHazeTexCache) return titanHazeTexCache;
  if (typeof document === 'undefined') {
    return (titanHazeTexCache = createFallbackTexture(249, 115, 22));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 纯粹、致密的橘红微蜜色氮-甲烷索林斯（Tholins）光化学烟雾
  const hazeGrad = ctx.createLinearGradient(0, 0, 0, 256);
  hazeGrad.addColorStop(0.0, '#b45309');
  hazeGrad.addColorStop(0.3, '#d97706');
  hazeGrad.addColorStop(0.5, '#f59e0b');
  hazeGrad.addColorStop(0.7, '#d97706');
  hazeGrad.addColorStop(1.0, '#78350f');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, 512, 256);

  // 北半球季节性极区深色烟雾头罩 (North Polar Hood)
  const hoodGrad = ctx.createLinearGradient(0, 0, 0, 60);
  hoodGrad.addColorStop(0.0, 'rgba(120, 53, 15, 0.65)');
  hoodGrad.addColorStop(1.0, 'rgba(120, 53, 15, 0.0)');
  ctx.fillStyle = hoodGrad;
  ctx.fillRect(0, 0, 512, 60);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (titanHazeTexCache = tex);
}

/**
 * 5. 木卫三 (Ganymede) - 暗色古老撞击区与浅色冰质沟槽带 (Sulci)
 */
export function getGanymedeTexture(): THREE.Texture {
  if (ganymedeTexCache) return ganymedeTexCache;
  if (typeof document === 'undefined') {
    return (ganymedeTexCache = createFallbackTexture(156, 163, 175));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 暗色古老多边形陆块底色 (Galileo Regio)
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 1024, 512);

  // 浅色年轻构造冰裂沟槽带网络 (Sulci)
  ctx.fillStyle = '#94a3b8';
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 1024, 0);
    ctx.lineTo(Math.random() * 1024, 512);
    ctx.lineTo(Math.random() * 1024, 512);
    ctx.closePath();
    ctx.fill();
  }

  // 撞击坑冰雪溅射射线纹 (Ray Craters)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  for (let c = 0; c < 35; c++) {
    const cx = Math.random() * 1024;
    const cy = Math.random() * 512;
    const cr = 6 + Math.random() * 14;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 0.4, 0, Math.PI * 2);
    ctx.fill();

    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * cr * 3, cy + Math.sin(angle) * cr * 3);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (ganymedeTexCache = tex);
}

/**
 * 6. 木卫四 (Callisto) - 极古老撞击坑饱和表面与瓦尔哈拉多重环盆地 (Valhalla Basin)
 */
export function getCallistoTexture(): THREE.Texture {
  if (callistoTexCache) return callistoTexCache;
  if (typeof document === 'undefined') {
    return (callistoTexCache = createFallbackTexture(107, 114, 128));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 极度古老的深灰碳质冰岩表面
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 1024, 512);

  // 密集的高密度撞击坑饱和地貌
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    const r = 2 + Math.random() * 10;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 坑边缘白色水冰霜冻反射
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 瓦尔哈拉巨型同心环多重撞击盆地 (Valhalla Impact Basin)
  const valhallaX = 640;
  const valhallaY = 230;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(valhallaX, valhallaY, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.4)';
  for (let ring = 32; ring <= 160; ring += 18) {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(valhallaX, valhallaY, ring, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return (callistoTexCache = tex);
}

/**
 * 7. 火星小卫星 (Phobos & Deimos) - 粗糙撞击坑风化层与斯蒂克尼坑
 */
export function getMarsMoonTexture(isPhobos: boolean): THREE.Texture {
  if (isPhobos && phobosTexCache) return phobosTexCache;
  if (!isPhobos && deimosTexCache) return deimosTexCache;

  if (typeof document === 'undefined') {
    const fallback = createFallbackTexture(120, 110, 100);
    return isPhobos ? (phobosTexCache = fallback) : (deimosTexCache = fallback);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 暗色碳质球粒陨石风化层底色
  ctx.fillStyle = isPhobos ? '#57534e' : '#78716c';
  ctx.fillRect(0, 0, 512, 256);

  // 随机撞击坑凹陷
  for (let i = 0; i < 250; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = 2 + Math.random() * 8;
    ctx.fillStyle = 'rgba(28, 25, 23, 0.4)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 火卫一专属：特征性巨大的斯蒂克尼 (Stickney) 撞击坑与放射应力断裂带
  if (isPhobos) {
    const sx = 220;
    const sy = 120;
    const sr = 46;

    const sGrad = ctx.createRadialGradient(sx, sy, 5, sx, sy, sr);
    sGrad.addColorStop(0.0, '#1c1917');
    sGrad.addColorStop(0.7, '#292524');
    sGrad.addColorStop(1.0, '#78716c');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

    // 放射状深沟断裂线
    ctx.strokeStyle = 'rgba(41, 37, 36, 0.5)';
    ctx.lineWidth = 1.5;
    for (let a = 0; a < 12; a++) {
      const angle = (a / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * sr, sy + Math.sin(angle) * sr);
      ctx.lineTo(sx + Math.cos(angle) * (sr + 80), sy + Math.sin(angle) * (sr + 80));
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (isPhobos) {
    return (phobosTexCache = tex);
  } else {
    return (deimosTexCache = tex);
  }
}
