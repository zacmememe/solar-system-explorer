/**
 * 航天器高拟真程序化 PBR 纹理生成器
 * 纯客户端 Canvas 2D 离线生成高精度法线与漫反射贴图，零外部网络依赖
 * 遵循真实航天工程材料外观：
 * 1. 单晶硅太阳翼与金色汇流排 (Photovoltaic Solar Arrays)
 * 2. 镀金多层隔热薄膜与缝合压花 (Gold Mylar / Kapton MLI Blankets)
 * 3. 空间站白色 Beta 布微流星防护壳与接缝 (White Beta-Cloth Hull & Rivets)
 * 4. 碳纤维与钛合金结构表面 (Carbon Fiber / Titanium Composites)
 */

import * as THREE from 'three';

let solarPanelTexCache: THREE.Texture | null = null;
let goldFoilTexCache: THREE.Texture | null = null;
let hullPanelTexCache: THREE.Texture | null = null;
let darkCarbonTexCache: THREE.Texture | null = null;

function createFallbackTexture(r: number, g: number, b: number): THREE.Texture {
  const data = new Uint8Array([r, g, b, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1. 太阳能电池翼纹理 (超清硅片网格 + 金色导电栅线 + 深蓝抗反射膜)
 */
export function getSolarPanelTexture(): THREE.Texture {
  if (solarPanelTexCache) return solarPanelTexCache;
  if (typeof document === 'undefined') {
    return (solarPanelTexCache = createFallbackTexture(15, 35, 75));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 基础底色：现代三结砷化镓/单晶硅深邃微蓝夜空色
  ctx.fillStyle = '#08182b';
  ctx.fillRect(0, 0, 512, 512);

  // 绘制 8x8 太阳能电池阵列晶片单元
  const cols = 8;
  const rows = 8;
  const cellW = 512 / cols;
  const cellH = 512 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW + 2;
      const y = r * cellH + 2;
      const w = cellW - 4;
      const h = cellH - 4;

      // 电池片晶体渐变与抗反射干涉色
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, '#102a45');
      grad.addColorStop(0.5, '#0b2038');
      grad.addColorStop(1, '#071628');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);

      // 细微倒角切角（航天太阳能晶片标志性切角）
      ctx.fillStyle = '#050f1c';
      ctx.fillRect(x, y, 4, 4);
      ctx.fillRect(x + w - 4, y, 4, 4);
      ctx.fillRect(x, y + h - 4, 4, 4);
      ctx.fillRect(x + w - 4, y + h - 4, 4, 4);

      // 微米级银/金栅线 (Silver gridlines)
      ctx.strokeStyle = 'rgba(120, 180, 240, 0.25)';
      ctx.lineWidth = 1;
      for (let gy = y + 8; gy < y + h - 4; gy += 7) {
        ctx.beginPath();
        ctx.moveTo(x + 2, gy);
        ctx.lineTo(x + w - 2, gy);
        ctx.stroke();
      }

      // 主导电母线 (Busbars: 2条金色贯通电极)
      ctx.fillStyle = 'rgba(234, 179, 8, 0.75)';
      ctx.fillRect(x + w * 0.3, y, 2.5, h);
      ctx.fillRect(x + w * 0.7, y, 2.5, h);
    }
  }

  // 单元间隙碳纤维复合背板隔离带
  ctx.strokeStyle = '#020617';
  ctx.lineWidth = 3;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, 512);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(512, r * cellH);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  solarPanelTexCache = tex;
  return tex;
}

/**
 * 2. 金色 Kapton / Mylar 多层隔热毯 (MLI: Multi-Layer Insulation)
 * 具有航天铝化聚酰亚胺金箔特有的菱形褶皱压花与细密缝合缝
 */
export function getGoldFoilTexture(): THREE.Texture {
  if (goldFoilTexCache) return goldFoilTexCache;
  if (typeof document === 'undefined') {
    return (goldFoilTexCache = createFallbackTexture(217, 119, 6));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 金黄色金属箔底色
  const bgGrad = ctx.createRadialGradient(256, 256, 40, 256, 256, 360);
  bgGrad.addColorStop(0, '#f59e0b');
  bgGrad.addColorStop(0.6, '#d97706');
  bgGrad.addColorStop(1, '#92400e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 512);

  // 压花菱形隔热格网 (Quilted Stitch Pattern)
  const size = 32;
  ctx.strokeStyle = 'rgba(254, 240, 138, 0.4)';
  ctx.lineWidth = 1.5;

  for (let x = -512; x < 1024; x += size) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 512, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 512, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // 模拟手工安装聚酰亚胺金箔的微小皱褶微表面明暗
  for (let i = 0; i < 220; i++) {
    const rx = Math.random() * 512;
    const ry = Math.random() * 512;
    const rw = 8 + Math.random() * 24;
    const rh = 4 + Math.random() * 12;
    const angle = Math.random() * Math.PI;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(angle);
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 251, 235, 0.18)' : 'rgba(120, 53, 15, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 隔热包覆带缝合铆固胶带边框 (Kapton Tape Seams)
  ctx.strokeStyle = 'rgba(180, 83, 9, 0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 504, 504);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  goldFoilTexCache = tex;
  return tex;
}

/**
 * 3. 空间站与航天器外壳白色隔热布贴图 (White Beta-Cloth & Panels)
 */
export function getHullPanelTexture(): THREE.Texture {
  if (hullPanelTexCache) return hullPanelTexCache;
  if (typeof document === 'undefined') {
    return (hullPanelTexCache = createFallbackTexture(241, 245, 249));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 航天白耐候涂层
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 512, 512);

  // 结构加筋与接缝网格 (Module segments & seams)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.lineWidth = 2;

  // 水平接缝与垂直结构带
  for (let y = 64; y < 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();

    // 结构铆钉点阵列
    ctx.fillStyle = 'rgba(71, 85, 105, 0.5)';
    for (let x = 12; x < 512; x += 24) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let x = 128; x < 512; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // 散热百叶窗区域 (Radiator grill pattern)
  ctx.fillStyle = 'rgba(203, 213, 225, 0.5)';
  ctx.fillRect(140, 75, 100, 100);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
  ctx.lineWidth = 1.5;
  for (let gy = 82; gy < 170; gy += 6) {
    ctx.beginPath();
    ctx.moveTo(144, gy);
    ctx.lineTo(236, gy);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  hullPanelTexCache = tex;
  return tex;
}

/**
 * 4. 碳纤维与深色金属框架贴图 (Dark Carbon Fiber Composite)
 */
export function getDarkCarbonTexture(): THREE.Texture {
  if (darkCarbonTexCache) return darkCarbonTexCache;
  if (typeof document === 'undefined') {
    return (darkCarbonTexCache = createFallbackTexture(15, 23, 42));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 256);

  // 碳纤维交错编制细密纹理 (2x2 twill weave)
  const twill = 8;
  for (let y = 0; y < 256; y += twill) {
    for (let x = 0; x < 256; x += twill) {
      const isEven = ((x / twill) + (y / twill)) % 2 === 0;
      ctx.fillStyle = isEven ? '#1e293b' : '#0f172a';
      ctx.fillRect(x, y, twill, twill);

      // 纤维高光丝线
      ctx.strokeStyle = isEven ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + twill);
      ctx.lineTo(x + twill, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  darkCarbonTexCache = tex;
  return tex;
}

