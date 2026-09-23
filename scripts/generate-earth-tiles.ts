/**
 * 太阳系漫游 · 批次 P0 真实地表切片金字塔生成工具 (NASA BMNG D1 扇区)
 * 遵循 260923 Pro model 优化审计指令：
 * 1. 严格使用 NASA 官方 BMNG 2004-09 21600x21600 D1 扇区（覆盖 90°E~180°E, 0°~90°N，东亚/中国/珠江口）；
 * 2. 引入 verifyQuadrantSource 扇区白名单校验，严禁使用覆盖南半球的 C2 源；
 * 3. 保持全球 L0–4（682 块）底图，重新切出真实珠江口 L5–L9 地区包（34 块）；
 * 4. 导出标准化 SurfaceDatasetManifest (v2.1.0)，标明 D1 真实数据源、SHA-256 与 463m 原生 GSD。
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { SurfaceDatasetManifest } from '../src/contracts/surface';
import { bmngBounds, verifyQuadrantSource, nativeGsdMeters } from '../src/world-support/bmng';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GLOBAL_SOURCE_PATH = path.resolve('assets-cache/bmng/world.200409.3x21600x10800.jpg');
const D1_SOURCE_PATH = path.resolve('assets-cache/bmng/world.200409.3x21600x21600.D1.jpg');
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
  console.log('🌍 太阳系漫游 · 批次 P0 真实地表切片生成工具 (NASA BMNG D1)');
  console.log(`全球 Base Map 源图: ${GLOBAL_SOURCE_PATH}`);
  console.log(`500m D1 真实分块源图: ${D1_SOURCE_PATH}`);
  console.log(`瓦片输出目录: ${OUTPUT_BASE_DIR}`);
  console.log('='.repeat(80));

  if (!fs.existsSync(GLOBAL_SOURCE_PATH)) {
    throw new Error(`Global base map not found: ${GLOBAL_SOURCE_PATH}`);
  }
  if (!fs.existsSync(D1_SOURCE_PATH)) {
    throw new Error(`500m D1 source not found: ${D1_SOURCE_PATH}`);
  }

  // 1. 扇区白名单准入校验 (严格遵循 P0 要求)
  console.log('🔍 正在核验 D1 象限扇区与经纬范围...');
  const d1Bounds = bmngBounds('D1');
  verifyQuadrantSource(
    {
      id: 'world.200409.3x21600x21600.D1.jpg',
      width: 21600,
      height: 21600,
      bounds: d1Bounds,
    },
    'D1'
  );
  const nativeGsd = nativeGsdMeters(
    { id: 'D1', width: 21600, height: 21600, bounds: d1Bounds },
    22.3
  );
  console.log(`✅ D1 扇区核验通过: 90°E~180°E, 0°~90°N (珠江口真实原生 GSD: N-S ${nativeGsd.northSouth.toFixed(1)}m, E-W ${nativeGsd.eastWest.toFixed(1)}m)`);

  // 2. 计算源图 SHA-256
  console.log('🔍 正在核验源图 SHA-256 哈希...');
  const globalSha256 = calculateSha256(GLOBAL_SOURCE_PATH);
  console.log(`全球源图 SHA-256: ${globalSha256}`);
  const d1Sha256 = calculateSha256(D1_SOURCE_PATH);
  console.log(`500m D1 源图 SHA-256: ${d1Sha256}`);

  // 3. 准备输出目录
  if (!fs.existsSync(OUTPUT_BASE_DIR)) {
    fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
  }

  // 4. 构建待切瓦片清单
  // 4.1 全局 L0–4 (682 块)
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

  // 4.2 珠江口地区包 (L5–L9，涵盖 30–50km 尺度)
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

  // 5. 检查全局 L0–4 是否已完整存在
  const generatedTileKeys: string[] = [];
  const missingGlobalCoords: TileCoord[] = [];
  for (const c of globalCoords) {
    const key = `${c.z}/${c.x}/${c.y}`;
    const outPath = path.join(OUTPUT_BASE_DIR, `${key}.jpg`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
      generatedTileKeys.push(key);
    } else {
      missingGlobalCoords.push(c);
    }
  }

  // 6. 启动 Headless Edge
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  const BATCH_SIZE = 32;

  // 7. 如果全局 L0–4 有缺失则补全
  if (missingGlobalCoords.length > 0) {
    console.log(`\n🚀 [阶段 1/2] 正在加载全球 21600x10800 Base Map 并补全缺失的 ${missingGlobalCoords.length} 块瓦片...`);
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

    for (let i = 0; i < missingGlobalCoords.length; i += BATCH_SIZE) {
      const batch = missingGlobalCoords.slice(i, i + BATCH_SIZE);
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
    }
  } else {
    console.log(`✅ 全局 L0–4 (682 块) 已完整存在于磁盘，无需重复切图。`);
  }

  // 8. 第二阶段：从 500m D1 真实分块 (21600x21600) 切出珠江口真实地区包 (L5–L9, 34 块)
  console.log(`\n🚀 [阶段 2/2] 正在加载 500m 真实 D1 分块并重切珠江口 (L5–L9) 真实高精包...`);
  const d1B64 = fs.readFileSync(D1_SOURCE_PATH).toString('base64');
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
  }, 'data:image/jpeg;base64,' + d1B64);

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
        // D1 覆盖: 经度 90°E ~ 180°E, 纬度 0° ~ 90°N
        const numCols = Math.pow(2, c.z + 1);
        const numRows = Math.pow(2, c.z);
        const lonSpan = 360 / numCols;
        const latSpan = 180 / numRows;
        const lonMin = -180 + c.x * lonSpan;
        const lonMax = lonMin + lonSpan;
        const latMax = 90 - c.y * latSpan;
        const latMin = latMax - latSpan;

        // 对应在 D1 图像中的像素坐标 (左上角 90°E, 90°N)
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
      if (!generatedTileKeys.includes(key)) {
        generatedTileKeys.push(key);
      }
    }
    process.stdout.write(`\r已生成珠江口 D1 真实瓦片: ${i + results.length}/${prdCoords.length}`);
  }
  console.log('\n✅ 珠江口真实 D1 高精地区包生成完毕！');

  await browser.close();

  // 9. 写入标准化 SurfaceDatasetManifest (升级为 v2.1.0)
  const manifest: SurfaceDatasetManifest = {
    bodyId: 'earth',
    datasetId: 'nasa-blue-marble-200409-tiles',
    version: '2.1.0',
    source: 'NASA Earth Observatory / Blue Marble Next Generation',
    sourceDate: '2004-09',
    sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/',
    sourceSha256: d1Sha256,
    sourceResolution: '21600x10800 (Global Base Map), 21600x21600 (500m D1 East Asia Regional)',
    nativeGsdKm: 0.463,
    processingVersion: '2.1-d1-east-asia-quadrant',
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
        nativeGsdKm: 0.463,
        source: 'NASA MODIS BMNG D1 500m true composite (90°E~180°E, 0°~90°N)',
      },
    ],
  };

  const manifestPath = path.join(OUTPUT_BASE_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n' + '='.repeat(80));
  console.log(`🎉 全部生成成功！共收录 ${generatedTileKeys.length} 块 512x512 真实 JPEG 瓦片！`);
  console.log(`📋 数据集清单已更新: ${manifestPath}`);
  console.log('='.repeat(80));
}

run().catch((err) => {
  console.error('\n❌ 切片生成失败:', err);
  process.exit(1);
});
