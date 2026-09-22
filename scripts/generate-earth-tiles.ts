/**
 * 批次 B3 地球双根四叉树瓦片离线生成工具
 * 从现有生产源图 2k_earth_daymap.jpg 生成版本化瓦片金字塔：
 * - L=0 双根 (西半球 0/0/0, 东半球 0/1/0)
 * - L=1 (8 块全球中尺度瓦片)
 * - L=2 (32 块大陆级瓦片)
 * - L=3 ROI 特写 (珠江口大湾区、喜马拉雅山脉)
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SOURCE_IMAGE_PATH = path.resolve('public/assets/textures/earth/2k_earth_daymap.jpg');
const OUTPUT_BASE_DIR = path.resolve('public/assets/tiles/earth');

async function generateTiles() {
  console.log('='.repeat(80));
  console.log('🌍 太阳系漫游 · 批次 B3 地球地理四叉树瓦片金字塔离线生成');
  console.log(`源纹理路径: ${SOURCE_IMAGE_PATH}`);
  console.log(`瓦片输出目录: ${OUTPUT_BASE_DIR}`);
  console.log('='.repeat(80));

  if (!fs.existsSync(SOURCE_IMAGE_PATH)) {
    throw new Error(`Source image not found: ${SOURCE_IMAGE_PATH}`);
  }

  if (!fs.existsSync(OUTPUT_BASE_DIR)) {
    fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // 读取原图为 Base64
  const imageBuffer = fs.readFileSync(SOURCE_IMAGE_PATH);
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  // 定义待切片坐标列表
  const tileCoords: Array<{ z: number; x: number; y: number }> = [];

  // L=0 (2 块)
  tileCoords.push({ z: 0, x: 0, y: 0 }, { z: 0, x: 1, y: 0 });

  // L=1 (8 块: 4列 x 2行)
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 2; y++) {
      tileCoords.push({ z: 1, x, y });
    }
  }

  // L=2 (32 块: 8列 x 4行)
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 4; y++) {
      tileCoords.push({ z: 2, x, y });
    }
  }

  // L=3 ROI 特写:
  // 珠江口大湾区 (~113.5°E, 22.5°N): 经度列号 x = floor((113.5 + 180) / (360 / 16)) = 13, 纬度行号 y = floor((90 - 22.5) / (180 / 8)) = 3
  tileCoords.push({ z: 3, x: 13, y: 3 });
  // 青藏高原喜马拉雅 (~86°E, 28°N): x = floor((86 + 180) / 22.5) = 11, y = floor((90 - 28) / 22.5) = 2
  tileCoords.push({ z: 3, x: 11, y: 2 });

  console.log(`准备生成瓦片总数: ${tileCoords.length} 块...`);

  // 在浏览器中载入图片并通过 Canvas 切片
  await page.evaluate(
    async (imgSrc, coords) => {
      const img = new Image();
      img.src = imgSrc;
      await new Promise((resolve) => (img.onload = resolve));

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;

      (window as any).__GENERATED_TILES__ = {};

      for (const coord of coords) {
        const numCols = Math.pow(2, coord.z + 1);
        const numRows = Math.pow(2, coord.z);

        const tileSrcW = srcW / numCols;
        const tileSrcH = srcH / numRows;

        const srcX = coord.x * tileSrcW;
        const srcY = coord.y * tileSrcH;

        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(img, srcX, srcY, tileSrcW, tileSrcH, 0, 0, 512, 512);

        // 获取 JPEG Data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        (window as any).__GENERATED_TILES__[`${coord.z}/${coord.x}/${coord.y}`] = dataUrl;
      }
    },
    base64Image,
    tileCoords
  );

  const generatedTiles = await page.evaluate(() => (window as any).__GENERATED_TILES__);

  for (const [key, dataUrl] of Object.entries(generatedTiles as Record<string, string>)) {
    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const outPath = path.join(OUTPUT_BASE_DIR, `${key}.jpg`);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
  }

  // 生成 SurfaceDatasetManifest
  const manifest = {
    bodyId: 'earth',
    datasetId: 'nasa-blue-marble-200409-tiles',
    version: '1.0.0',
    source: 'NASA Earth Observatory / Blue Marble Next Generation',
    sourceDate: '2004-09',
    projection: 'equirectangular-dual-root',
    referenceRadiusKm: 6371.0,
    maxLevel: 3,
    tileSizePixels: 512,
    colorSpace: 'sRGB',
    tileRootPath: '/assets/tiles/earth',
    coverageRoi: [
      {
        name: '珠江口大湾区 (Pearl River Delta)',
        lonMin: 112.5,
        lonMax: 115.0,
        latMin: 21.5,
        latMax: 23.5,
        targetLevel: 3,
      },
      {
        name: '青藏高原喜马拉雅山脉 (Himalayas)',
        lonMin: 84.0,
        lonMax: 88.0,
        latMin: 27.0,
        latMax: 29.5,
        targetLevel: 3,
      },
    ],
  };

  const manifestPath = path.join(OUTPUT_BASE_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`✅ 成功生成 ${Object.keys(generatedTiles).length} 块 512x512 JPEG 瓦片！`);
  console.log(`📋 数据集清单已写入: ${manifestPath}`);

  await browser.close();
}

generateTiles().catch((err) => {
  console.error('❌ 切片生成失败:', err);
  process.exit(1);
});
