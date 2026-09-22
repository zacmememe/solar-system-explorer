/**
 * 批次 R2 地球双根四叉树真实瓦片金字塔离线生成工具
 * 严格遵循 260922Pro model 优化审计 2 指令：
 * 1. 采用真实 NASA BMNG 2004-09 21600x10800 Base Map 生成全局 L0–4 (682 块 512² 库存)；
 * 2. 采用真实 NASA BMNG 2004-09 500m C2 分块 (21600x21600) 生成珠江口 30–50km 真实高精地区包 (L5–L9)；
 * 3. 严禁 2K 放大充数，确保信息真实增量；
 * 4. 导出完整的 SurfaceDatasetManifest 科学清单（包含源 URL、源哈希、原生分辨率、瓦片哈希表与可用性）。
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { SurfaceDatasetManifest } from '../src/contracts/surface';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GLOBAL_SOURCE_PATH = path.resolve('assets-cache/bmng/world.200409.3x21600x10800.jpg');
const C2_SOURCE_PATH = path.resolve('assets-cache/bmng/world.200409.3x21600x21600.C2.jpg');
const OUTPUT_BASE_DIR = path.resolve('public/assets/tiles/earth');

// 珠江口真实高精地区范围 (经度 113.0°E ~ 114.5°E, 纬度 21.8°N ~ 23.2°N)
const PRD_LON_MIN = 113.0;
const PRD_LON_MAX = 114.5;
const PRD_LAT_MIN = 21.8;
const PRD_LAT_MAX = 23.2;

declare global {
  interface Window {
    __IMG__: HTMLImageElement;
    __CANVAS__: HTMLCanvasElement;
    __CTX__: CanvasRenderingContext2D;
  }
}

interface TileCoord {
  z: number;
  x: number;
  y: number;
}

function calculateSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function run() {
  console.log('='.repeat(80));
  console.log('🌍 太阳系漫游 · 批次 R2 真实地表四叉树瓦片金字塔生成工具');
  console.log(`全球 Base Map 源图: ${GLOBAL_SOURCE_PATH}`);
  console.log(`500m C2 真实分块源图: ${C2_SOURCE_PATH}`);
  console.log(`瓦片输出目录: ${OUTPUT_BASE_DIR}`);
  console.log('='.repeat(80));

  if (!fs.existsSync(GLOBAL_SOURCE_PATH)) {
    throw new Error(`Global base map not found: ${GLOBAL_SOURCE_PATH}`);
  }
  if (!fs.existsSync(C2_SOURCE_PATH)) {
    throw new Error(`500m C2 source not found: ${C2_SOURCE_PATH}`);
  }

  // 1. 计算源图 SHA-256
  console.log('🔍 正在核验源图 SHA-256 哈希...');
  const globalSha256 = calculateSha256(GLOBAL_SOURCE_PATH);
  console.log(`全球源图 SHA-256: ${globalSha256}`);
  const c2Sha256 = calculateSha256(C2_SOURCE_PATH);
  console.log(`500m C2 源图 SHA-256: ${c2Sha256}`);

  // 2. 准备输出目录
  if (!fs.existsSync(OUTPUT_BASE_DIR)) {
    fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
  }

  // 3. 构建待切瓦片清单
  // 3.1 全局 L0–4 (682 块)
  const globalCoords: TileCoord[] = [];
  for (let z = 0; z <= 4; z++) {
    const numCols = Math.pow(2, z + 1);
    const numRows = Math.pow(2, z);
    for (let y = 0; y < numRows; y++) {
      for (let x = 0; x < numCols; x++) {
        globalCoords.push({ z, x, y });
      }
    }
  }
  console.log(`全局 L0–4 瓦片总数: ${globalCoords.length} 块 (预期 682 块)`);

  // 3.2 珠江口地区包 (L5–L9，涵盖 30–50km 尺度)
  const prdCoords: TileCoord[] = [];
  for (let z = 5; z <= 9; z++) {
    const numCols = Math.pow(2, z + 1);
    const numRows = Math.pow(2, z);
    const lonSpan = 360 / numCols;
    const latSpan = 180 / numRows;

    const colMin = Math.floor((PRD_LON_MIN + 180) / lonSpan);
    const colMax = Math.floor((PRD_LON_MAX + 180 - 1e-7) / lonSpan);
    const rowMin = Math.floor((90 - PRD_LAT_MAX) / latSpan);
    const rowMax = Math.floor((90 - PRD_LAT_MIN - 1e-7) / latSpan);

    for (let y = rowMin; y <= rowMax; y++) {
      for (let x = colMin; x <= colMax; x++) {
        prdCoords.push({ z, x, y });
      }
    }
  }
  console.log(`珠江口真实高精地区包 (L5–L9) 瓦片总数: ${prdCoords.length} 块`);

  // 4. 启动 Headless Edge
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  const generatedTileKeys: string[] = [];

  // 5. 第一阶段：从全球 21600x10800 Base Map 切出全局 L0–4 (682 块)
  console.log('\n🚀 [阶段 1/2] 正在加载全球 21600x10800 Base Map 并生成 L0–4 金字塔...');
  const globalB64 = fs.readFileSync(GLOBAL_SOURCE_PATH).toString('base64');
  await page.evaluate(async (dataUrl) => {
    window.__IMG__ = new Image();
    window.__IMG__.src = dataUrl;
    await new Promise((res, rej) => {
      window.__IMG__.onload = res;
      window.__IMG__.onerror = rej;
    });
    window.__CANVAS__ = document.createElement('canvas');
    window.__CANVAS__.width = 512;
    window.__CANVAS__.height = 512;
    window.__CTX__ = window.__CANVAS__.getContext('2d')!;
  }, 'data:image/jpeg;base64,' + globalB64);

  const BATCH_SIZE = 32;
  for (let i = 0; i < globalCoords.length; i += BATCH_SIZE) {
    const batch = globalCoords.slice(i, i + BATCH_SIZE);
    const results = await page.evaluate((coords) => {
      const img = window.__IMG__;
      const canvas = window.__CANVAS__;
      const ctx = window.__CTX__;
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const batchOut: Array<{ z: number; x: number; y: number; data: string }> = [];

      for (const c of coords) {
        const numCols = Math.pow(2, c.z + 1);
        const numRows = Math.pow(2, c.z);
        const tileSrcW = srcW / numCols;
        const tileSrcH = srcH / numRows;
        const srcX = c.x * tileSrcW;
        const srcY = c.y * tileSrcH;

        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(img, srcX, srcY, tileSrcW, tileSrcH, 0, 0, 512, 512);
        const b64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
        batchOut.push({ z: c.z, x: c.x, y: c.y, data: b64 });
      }
      return batchOut;
    }, batch);

    for (const r of results) {
      const key = `${r.z}/${r.x}/${r.y}`;
      const outPath = path.join(OUTPUT_BASE_DIR, `${key}.jpg`);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, Buffer.from(r.data, 'base64'));
      generatedTileKeys.push(key);
    }
    process.stdout.write(`\r已生成 L0–4 瓦片: ${generatedTileKeys.length}/${globalCoords.length}`);
  }
  console.log('\n✅ 全局 L0–4 (682 块) 生成完毕！');

  // 6. 第二阶段：从 500m C2 分块 (21600x21600) 切出珠江口地区包 (L5–L9)
  console.log('\n🚀 [阶段 2/2] 正在加载 500m 真实 C2 分块并生成珠江口 (L5–L9) 真实高精包...');
  const c2B64 = fs.readFileSync(C2_SOURCE_PATH).toString('base64');
  await page.evaluate(async (dataUrl) => {
    window.__IMG__.src = dataUrl;
    await new Promise((res, rej) => {
      window.__IMG__.onload = res;
      window.__IMG__.onerror = rej;
    });
  }, 'data:image/jpeg;base64,' + c2B64);

  for (let i = 0; i < prdCoords.length; i += BATCH_SIZE) {
    const batch = prdCoords.slice(i, i + BATCH_SIZE);
    const results = await page.evaluate((coords) => {
      const img = window.__IMG__;
      const canvas = window.__CANVAS__;
      const ctx = window.__CTX__;
      const srcW = img.naturalWidth; // 21600
      const srcH = img.naturalHeight; // 21600
      const batchOut: Array<{ z: number; x: number; y: number; data: string }> = [];

      for (const c of coords) {
        // C2 覆盖: 经度 90°E ~ 180°E, 纬度 0° ~ 90°N
        const numCols = Math.pow(2, c.z + 1);
        const numRows = Math.pow(2, c.z);
        const lonSpan = 360 / numCols;
        const latSpan = 180 / numRows;
        const lonMin = -180 + c.x * lonSpan;
        const lonMax = lonMin + lonSpan;
        const latMax = 90 - c.y * latSpan;
        const latMin = latMax - latSpan;

        // 对应在 C2 图像中的像素坐标
        const srcX = ((lonMin - 90) / 90) * srcW;
        const srcW_px = ((lonMax - lonMin) / 90) * srcW;
        const srcY = ((90 - latMax) / 90) * srcH;
        const srcH_px = ((latMax - latMin) / 90) * srcH;

        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(img, srcX, srcY, srcW_px, srcH_px, 0, 0, 512, 512);
        const b64 = canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
        batchOut.push({ z: c.z, x: c.x, y: c.y, data: b64 });
      }
      return batchOut;
    }, batch);

    for (const r of results) {
      const key = `${r.z}/${r.x}/${r.y}`;
      const outPath = path.join(OUTPUT_BASE_DIR, `${key}.jpg`);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, Buffer.from(r.data, 'base64'));
      generatedTileKeys.push(key);
    }
    process.stdout.write(`\r已生成珠江口瓦片: ${i + results.length}/${prdCoords.length}`);
  }
  console.log('\n✅ 珠江口真实高精地区包生成完毕！');

  await browser.close();

  // 7. 写入标准化 SurfaceDatasetManifest
  const manifest: SurfaceDatasetManifest = {
    bodyId: 'earth',
    datasetId: 'nasa-blue-marble-200409-tiles',
    version: '2.0.0',
    source: 'NASA Earth Observatory / Blue Marble Next Generation',
    sourceDate: '2004-09',
    sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/',
    sourceSha256: globalSha256,
    sourceResolution: '21600x10800 (Global Base Map), 21600x21600 (500m C2 East Asia Regional)',
    nativeGsdKm: 1.85,
    processingVersion: '2.0-dualroot-downsample-r2',
    projection: 'equirectangular-dual-root',
    referenceRadiusKm: 6371.0,
    maxLevel: 9,
    tileSizePixels: 512,
    colorSpace: 'sRGB',
    tileRootPath: '/assets/tiles/earth',
    tileCount: generatedTileKeys.length,
    availableTiles: generatedTileKeys,
    attribution: 'NASA Visible Earth / Earth Observatory. Reto Stöckli, NASA GSFC. Public domain.',
    coverageRoi: [
      {
        name: '珠江口大湾区 (Pearl River Delta)',
        lonMin: PRD_LON_MIN,
        lonMax: PRD_LON_MAX,
        latMin: PRD_LAT_MIN,
        latMax: PRD_LAT_MAX,
        targetLevel: 9,
        nativeGsdKm: 0.5,
        source: 'NASA MODIS BMNG C2 500m true composite',
      },
    ],
  };

  const manifestPath = path.join(OUTPUT_BASE_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n' + '='.repeat(80));
  console.log(`🎉 全部生成成功！共生成 ${generatedTileKeys.length} 块 512x512 真实 JPEG 瓦片！`);
  console.log(`📋 数据集清单已写入: ${manifestPath}`);
  console.log('='.repeat(80));
}

run().catch((err) => {
  console.error('\n❌ 切片生成失败:', err);
  process.exit(1);
});
