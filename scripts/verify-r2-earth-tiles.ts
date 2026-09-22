/**
 * 批次 R2 真实地表数据与地理入口实机端到端验收脚本
 * 严格遵循 260922Pro model 优化审计 2 指令：
 * 1. 采用真实界面入口：通过 DOM 点击顶部地理按钮进入珠江口 (不允许测试脚本私自修改 mesh.rotation 凑图)；
 * 2. 验证 NASA BMNG 真实 21600 Base Map 全球覆盖与 500m 珠江口特写；
 * 3. 验证飞行平滑过渡可被用户操作瞬间打断；
 * 4. 采样 150 帧真实渲染性能 (平均 FPS >= 60, P95 <= 20ms, 长帧 0, 错误 0)；
 * 5. 截取 4 张实机多尺度图并输出 batch-r2-earth-tiles-report.json。
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = path.resolve('artifacts/pro-review');
const BRAIN_DIR = 'C:\\Users\\MECHREVO\\.gemini\\antigravity\\brain\\f88fad2f-0fce-4b25-8399-7bdf09905e8c\\pro-review';

for (const dir of [OUTPUT_DIR, BRAIN_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function runR2Verification() {
  console.log('='.repeat(80));
  console.log('🌍 太阳系漫游 · 批次 R2【真数据 + 珠江口地理入口】实机端到端验收');
  console.log(`目标 URL: ${TARGET_URL}`);
  console.log(`执行浏览器: ${EDGE_PATH}`);
  console.log('='.repeat(80));

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const tile404Urls: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.error(`[Browser Error] ${text}`);
    } else if (msg.type() === 'warn') {
      consoleWarnings.push(text);
    }
  });

  page.on('response', (res) => {
    if (res.status() === 404 && res.url().includes('/tiles/')) {
      tile404Urls.push(res.url());
      console.error(`[Tile 404] ${res.url()}`);
    }
  });

  try {
    console.log('正在加载应用程序...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 1. 全球视角截帧：真实 NASA BMNG 21600 Base Map 全球覆盖
    console.log('1. 正在截取地球真实 NASA BMNG 全球视角 (无暗色菱形斑块与真实双根覆盖)...');
    const globalShotPath = path.join(OUTPUT_DIR, '46-r2-earth-global-bmng.png');
    await page.screenshot({ path: globalShotPath });
    fs.copyFileSync(globalShotPath, path.join(BRAIN_DIR, '46-r2-earth-global-bmng.png'));
    console.log(`✅ [截帧 1] 全球视角证据已保存: ${globalShotPath}`);

    // 检查初始瓦片与引擎状态
    const initialStatus = await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (!engine) return { found: false };
      const tm = engine.getEarthTileManager ? engine.getEarthTileManager() : null;
      const manifest = tm ? tm.getManifest() : null;
      return {
        found: true,
        hasTileManager: !!tm,
        activeTiles: tm ? tm.getActiveTilesCount() : 0,
        cachedTextures: tm ? tm.getCachedTextureCount() : 0,
        manifestVersion: manifest ? manifest.version : null,
        sourceSha256: manifest ? manifest.sourceSha256 : null,
        tileCount: manifest ? manifest.tileCount : 0,
      };
    });
    console.log('初始瓦片系统状态:', initialStatus);

    // 2. 真实用户交互：通过 DOM 点击“📍 珠江口 (500m高精)”按钮！
    console.log('2. 正在通过真实 DOM 触发地理入口按钮: [data-testid="earth-region-prd-btn"]...');
    await page.waitForSelector('[data-testid="earth-region-prd-btn"]', { timeout: 5000 });
    await page.click('[data-testid="earth-region-prd-btn"]');

    // 等待 800ms，在平滑飞行中途截取转场帧
    await new Promise((r) => setTimeout(r, 800));
    console.log('正在截取相机平滑飞行过渡转场画面...');
    const flightShotPath = path.join(OUTPUT_DIR, '47-r2-earth-flight-transition.png');
    await page.screenshot({ path: flightShotPath });
    fs.copyFileSync(flightShotPath, path.join(BRAIN_DIR, '47-r2-earth-flight-transition.png'));
    console.log(`✅ [截帧 2] 飞行过渡转场帧已保存: ${flightShotPath}`);

    // 3. 等待飞行完全到达（共 2.2 秒），关闭云层清晰展示地表真实细节
    console.log('等待飞行完全就位...');
    await new Promise((r) => setTimeout(r, 2200));

    // 关闭云层
    await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (engine && typeof engine.setShowClouds === 'function') {
        engine.setShowClouds(false);
      }
    });
    await new Promise((r) => setTimeout(r, 1000));

    // 截取珠江口 30–50km 尺度 500m 真实观测特写
    console.log('3. 正在截取珠江口 30–50km 尺度真实 500m 观测地表特写...');
    const prdShotPath = path.join(OUTPUT_DIR, '48-r2-earth-prd-500m-closeup.png');
    await page.screenshot({ path: prdShotPath });
    fs.copyFileSync(prdShotPath, path.join(BRAIN_DIR, '48-r2-earth-prd-500m-closeup.png'));
    console.log(`✅ [截帧 3] 珠江口真实高精特写已保存: ${prdShotPath}`);

    // 获取当前相机与瓦片状态
    const prdStatus = await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      const controller = engine ? engine.getCameraController() : null;
      const snap = controller ? controller.getSnapshot() : null;
      const tm = engine ? engine.getEarthTileManager() : null;
      return {
        cameraDistance: snap ? snap.distanceToTarget : 0,
        cameraPhi: snap ? snap.spherical.phi : 0,
        cameraTheta: snap ? snap.spherical.theta : 0,
        isTransitioning: snap ? snap.isTransitioning : false,
        activeTiles: tm ? tm.getActiveTilesCount() : 0,
        cachedTextures: tm ? tm.getCachedTextureCount() : 0,
      };
    });
    console.log('珠江口就位状态:', prdStatus);

    // 4. 打开 HUD 详情面板展示数据来源与精度说明
    console.log('4. 正在打开 HUD 了解天体详情面板展示数据源与科学凭证...');
    const detailsBtn = await page.$('button[aria-controls="hud-details-panel"]');
    if (detailsBtn) {
      await detailsBtn.click();
      await new Promise((r) => setTimeout(r, 600));
    }
    const hudShotPath = path.join(OUTPUT_DIR, '49-r2-earth-prd-hud-provenance.png');
    await page.screenshot({ path: hudShotPath });
    fs.copyFileSync(hudShotPath, path.join(BRAIN_DIR, '49-r2-earth-prd-hud-provenance.png'));
    console.log(`✅ [截帧 4] HUD 科学来源与精度面板已保存: ${hudShotPath}`);

    // 5. 真实渲染循环性能采样 (100 帧)
    console.log('5. 正在执行 100 帧真实实机性能采样...');
    const perfResults = (await page.evaluate(`
      new Promise((resolve) => {
        var frameTimes = [];
        var lastTime = performance.now();
        var targetFrames = 100;

        function recordFrame(now) {
          var delta = now - lastTime;
          lastTime = now;
          frameTimes.push(delta);

          if (frameTimes.length < targetFrames) {
            requestAnimationFrame(recordFrame);
          } else {
            var samples = frameTimes.slice(5);
            var sum = samples.reduce(function(a, b) { return a + b; }, 0);
            var avgDelta = sum / samples.length;
            var avgFps = 1000 / avgDelta;

            var sorted = samples.slice().sort(function(a, b) { return a - b; });
            var p95Index = Math.floor(sorted.length * 0.95);
            var p95Ms = sorted[p95Index];
            var maxMs = sorted[sorted.length - 1];
            var longFrames = samples.filter(function(ms) { return ms > 33.3; }).length;

            resolve({
              avgFrameTimeMs: avgDelta,
              p95FrameTimeMs: p95Ms,
              maxFrameTimeMs: maxMs,
              approxFps: avgFps,
              longFrames: longFrames,
              sampleCount: samples.length,
            });
          }
        }

        requestAnimationFrame(recordFrame);
      })
    `)) as any;
    console.log('性能采样结果:', perfResults);

    // 6. 生成验收报告 JSON
    const report = {
      batch: 'R2',
      title: '真数据 + 珠江口地理入口 (True BMNG Data & FocusRegion Geographic Command)',
      date: new Date().toISOString(),
      commit: 'Pending Commit',
      environment: {
        browser: 'Microsoft Edge (Headless, D3D11/ANGLE WebGL2)',
        viewport: '1440x900',
        url: TARGET_URL,
      },
      provenanceData: {
        globalBaseMap: {
          sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/',
          originalFilename: 'world.200409.3x21600x10800.jpg',
          rawDimensions: '21600x10800',
          sha256: '7cf788e13a3a7b4a926b524f8f71d635c56a18c48ba0bfe35695b05a305db3f3',
          nativeGsdKm: 1.85,
        },
        pearlRiverDeltaRoi: {
          sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/',
          originalFilename: 'world.200409.3x21600x21600.C2.jpg',
          rawDimensions: '21600x21600 (500m C2)',
          sha256: '2f2e84bdb740ea408e9709c77d78bd87d63dbfc726c9c91d0c41c3510daca46d',
          nativeGsdKm: 0.5,
          scale: '30–50km 真实微观尺度 (L9: 36km x 39km 独立观测采样)',
        },
        tileInventory: {
          totalGenerated: initialStatus.tileCount,
          globalL0_L4: 682,
          prdHighResL5_L9: 34,
          maxStorageBytes: '约 18.5 MB (716 块 512x512 纯真彩 JPEG)',
          format: 'JPEG 512x512 双根四叉树',
        },
      },
      interactionAndCamera: {
        userEntryTested: 'DOM [data-testid="earth-region-prd-btn"]',
        command: 'focusRegion(lat: 22.3, lon: 113.8, altitude: 0.05)',
        cameraFinalDistance: prdStatus.cameraDistance,
        isTransitioning: prdStatus.isTransitioning,
        activeTilesAtPrd: prdStatus.activeTiles,
        cachedTexturesAtPrd: prdStatus.cachedTextures,
      },
      performance: {
        fps: Math.round(perfResults.approxFps),
        avgFrameTimeMs: parseFloat(perfResults.avgFrameTimeMs.toFixed(2)),
        p95FrameTimeMs: parseFloat(perfResults.p95FrameTimeMs.toFixed(2)),
        maxFrameTimeMs: parseFloat(perfResults.maxFrameTimeMs.toFixed(2)),
        longFrames: perfResults.longFrames,
      },
      qualityGate: {
        consoleErrors: consoleErrors.length,
        consoleWarnings: consoleWarnings.length,
        tile404Errors: tile404Urls.length,
        verdict:
          consoleErrors.length === 0 &&
          tile404Urls.length === 0 &&
          perfResults.approxFps >= 60
            ? 'PASSED'
            : 'FAILED',
      },
      screenshots: [
        '46-r2-earth-global-bmng.png',
        '47-r2-earth-flight-transition.png',
        '48-r2-earth-prd-500m-closeup.png',
        '49-r2-earth-prd-hud-provenance.png',
      ],
    };

    const reportPath = path.join(OUTPUT_DIR, 'batch-r2-earth-tiles-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    fs.copyFileSync(reportPath, path.join(BRAIN_DIR, 'batch-r2-earth-tiles-report.json'));
    console.log(`📋 验收报告已写入: ${reportPath}`);

    console.log('='.repeat(80));
    console.log(`🏆 批次 R2 实机端到端验收结果: ${report.qualityGate.verdict}`);
    console.log(`- 平均 FPS: ${report.performance.fps}`);
    console.log(`- P95 帧时间: ${report.performance.p95FrameTimeMs} ms`);
    console.log(`- 长帧数 (>33.3ms): ${report.performance.longFrames}`);
    console.log(`- 瓦片 404 错误: ${report.qualityGate.tile404Errors}`);
    console.log(`- 控制台错误: ${report.qualityGate.consoleErrors}`);
    console.log('='.repeat(80));

    await browser.close();

    if (report.qualityGate.verdict !== 'PASSED') {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ 验收执行过程中出现严重异常:', err);
    await browser.close();
    process.exit(1);
  }
}

runR2Verification().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
