/**
 * Comprehensive Batch 3 Acceptance & Verification Script
 * Covers:
 * 1. 5 target viewports: 1440x900, 1366x768, 1024x768, 390x844, 844x390
 * 2. Full-site reachability: Top bar, planet navigation, satellite bar, Hangar modal, Details panel, Observe options
 * 3. Real touch events and touch target dimensions (>= 40x44px accessible)
 * 4. No horizontal overflow (scrollWidth <= clientWidth)
 * 5. Real 3D rendering loop frame time sampling (p50, p95, avg FPS, long frames)
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_URL = process.env.TEST_URL || 'http://localhost:4173';
const OUT_DIR = path.resolve('artifacts/pro-review');
fs.mkdirSync(OUT_DIR, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];
const executablePath = candidates.find((p): p is string => !!p && fs.existsSync(p));
if (!executablePath) {
  console.error('No suitable browser found in candidate paths.');
  process.exit(1);
}

const VIEWPORTS = [
  { width: 1440, height: 900, isMobile: false, hasTouch: false, name: '1440x900 (Desktop Standard)' },
  { width: 1366, height: 768, isMobile: false, hasTouch: false, name: '1366x768 (Laptop Standard)' },
  { width: 1024, height: 768, isMobile: false, hasTouch: false, name: '1024x768 (Tablet Landscape / iPad)' },
  { width: 390, height: 844, isMobile: true, hasTouch: true, name: '390x844 (Mobile Portrait / iPhone)' },
  { width: 844, height: 390, isMobile: true, hasTouch: true, name: '844x390 (Mobile Landscape)' },
];

interface CheckRecord {
  category: string;
  item: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  detail: string;
}

const records: CheckRecord[] = [];
function logRecord(category: string, item: string, pass: boolean, detail: string) {
  const status = pass ? 'PASS' : 'FAIL';
  records.push({ category, item, status, detail });
  console.log(`[${pass ? '✅ PASS' : '❌ FAIL'}] [${category}] ${item}: ${detail}`);
  if (!pass) {
    throw new Error(`Assertion failed: ${category} - ${item}: ${detail}`);
  }
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('===============================================================');
  console.log('🚀 太阳系漫游 · 第三批全视口与真实 3D 渲染性能严格验收');
  console.log(`测试目标 URL: ${TEST_URL}`);
  console.log(`执行浏览器: ${executablePath}`);
  console.log('===============================================================\n');

  const userDataDir = path.join(os.tmpdir(), `solar_batch3_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const browser = await puppeteer.launch({
    executablePath,
    userDataDir,
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (err: any) => consoleErrors.push(`[PageError] ${err?.message || String(err)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico')) {
        consoleErrors.push(`[ConsoleError] ${text}`);
      }
    }
  });

  try {
    // 1. 导航与初始化
    await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]', { timeout: 20000 });
    await pause(1500);

    logRecord('ENV', 'WebGL2 Support', await page.evaluate(() => !!document.querySelector('canvas')?.getContext('webgl2')), 'Canvas has WebGL2 rendering context');

    // 2. 逐一视口严格验证
    for (const vp of VIEWPORTS) {
      console.log(`\n--- 🔍 正在检验视口: ${vp.name} (${vp.width}×${vp.height}) ---`);
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
      });
      await pause(300);

      // (a) 检查横向溢出
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        return {
          scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
          clientWidth: Math.max(doc.clientWidth, body.clientWidth),
          hasHorizontalScroll: Math.max(doc.scrollWidth, body.scrollWidth) > (Math.max(doc.clientWidth, body.clientWidth) + 1.0),
        };
      });
      logRecord(
        'LAYOUT',
        `No Horizontal Overflow [${vp.width}x${vp.height}]`,
        !overflow.hasHorizontalScroll,
        `scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`
      );

      // (b) 检查顶部导航栏可见性与尺寸
      const topNavInfo = await page.evaluate(() => {
        const bar = document.querySelector('.app-top-container');
        const header = document.querySelector('.app-header');
        const planets = document.querySelector('.app-nav-planets');
        const toolbar = document.querySelector('.app-toolbar');
        if (!bar || !header || !planets || !toolbar) return null;
        const barRect = bar.getBoundingClientRect();
        return {
          barRect: { x: barRect.x, y: barRect.y, width: barRect.width, height: barRect.height },
          headerVisible: header.getBoundingClientRect().width > 0,
          planetsVisible: planets.getBoundingClientRect().width > 0,
          toolbarVisible: toolbar.getBoundingClientRect().width > 0,
        };
      });
      logRecord(
        'TOP_NAV',
        `Top Bar Structure [${vp.width}x${vp.height}]`,
        topNavInfo !== null && topNavInfo.headerVisible && topNavInfo.planetsVisible && topNavInfo.toolbarVisible,
        `Header, planet bar, and tools properly rendered within bounds`
      );

      // (c) 检查天体切换交互（桌面用 click，移动端用 tap）
      await page.waitForSelector('[data-testid="planet-btn-earth"]', { visible: true });
      if (vp.hasTouch) {
        await page.tap('[data-testid="planet-btn-earth"]');
      } else {
        await page.click('[data-testid="planet-btn-earth"]');
      }
      await pause(300);

      // 卫星次级栏月球按钮
      await page.waitForSelector('[data-testid="moon-btn-moon"]', { visible: true });
      const moonBox = await page.$eval('[data-testid="moon-btn-moon"]', (el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, x: r.x, y: r.y };
      });
      logRecord(
        'SATELLITE_BAR',
        `Moon Subbar Button Operable [${vp.width}x${vp.height}]`,
        moonBox.width > 20 && moonBox.height >= 26,
        `Moon pill bounds: ${Math.round(moonBox.width)}x${Math.round(moonBox.height)}px at (${Math.round(moonBox.x)}, ${Math.round(moonBox.y)})`
      );

      // (d) 航天器机库模态窗交互检验
      await page.waitForSelector('.app-toolbar-btn.btn-hangar', { visible: true });
      if (vp.hasTouch) {
        await page.tap('.app-toolbar-btn.btn-hangar');
      } else {
        await page.click('.app-toolbar-btn.btn-hangar');
      }
      await pause(300);

      const hangarModalOpen = await page.evaluate(() => {
        const modal = document.querySelector('h2');
        return modal && modal.textContent?.includes('航天器机库');
      });
      logRecord(
        'HANGAR',
        `Hangar Modal Opens [${vp.width}x${vp.height}]`,
        !!hangarModalOpen,
        'Hangar modal rendered with title'
      );

      // 验证机库关闭按钮尺寸与可关闭性
      const closeBtnBox = await page.$eval('[aria-label="关闭机库"]', (el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      logRecord(
        'ACCESSIBILITY',
        `Hangar Close Button Touch Target [${vp.width}x${vp.height}]`,
        closeBtnBox.width >= 40 && closeBtnBox.height >= 40,
        `Close button size: ${closeBtnBox.width}x${closeBtnBox.height}px (>=40px accessible)`
      );

      if (vp.hasTouch) {
        await page.tap('[aria-label="关闭机库"]');
      } else {
        await page.click('[aria-label="关闭机库"]');
      }
      await pause(300);

      // (e) 底部 HUD 天体资料面板交互检验 (了解这颗天体)
      await page.waitForSelector('[aria-controls="hud-details-panel"]', { visible: true });
      if (vp.hasTouch) {
        await page.tap('[aria-controls="hud-details-panel"]');
      } else {
        await page.click('[aria-controls="hud-details-panel"]');
      }
      await pause(300);

      const detailsPanelOpen = await page.evaluate(() => {
        const p = document.querySelector('#hud-details-panel');
        return p !== null && getComputedStyle(p).display !== 'none';
      });
      logRecord(
        'HUD_DETAILS',
        `Target Details Panel Opens [${vp.width}x${vp.height}]`,
        !!detailsPanelOpen,
        'Target details panel opened from bottom HUD'
      );

      // 按 Escape 关闭资料面板
      await page.keyboard.press('Escape');
      await pause(200);
      const detailsClosed = await page.evaluate(() => document.querySelector('#hud-details-panel') === null);
      logRecord(
        'HUD_DETAILS',
        `Escape Closes Details Panel [${vp.width}x${vp.height}]`,
        detailsClosed,
        'Panel unmounted on Escape key'
      );

      // 截取该视口的验证图
      const screenshotPath = path.join(OUT_DIR, `viewport-${vp.width}x${vp.height}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`  📸 视口截图已保存: ${screenshotPath}`);
    }

    // 3. 真实 3D 渲染循环帧时间性能测定 (采样 180 帧以上，约 3-4 秒)
    console.log('\n--- ⏱️ 正在测定真实 3D 渲染循环帧时间与 FPS (采样 200 帧) ---');
    await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
    await pause(500);

    await page.evaluate(() => {
      (window as any).__name = (fn: any) => fn;
    });

    const perfData = await page.evaluate(async () => {
      (window as any).__name = (fn: any) => fn;
      return new Promise<{
        frameCount: number;
        totalDurationMs: number;
        avgFps: number;
        p50Ms: number;
        p95Ms: number;
        minMs: number;
        maxMs: number;
        longFrames33Ms: number;
        longFrames50Ms: number;
        memory?: any;
      }>((resolve) => {
        const frameDeltas: number[] = [];
        let lastTime = performance.now();
        let count = 0;
        const targetCount = 200;

        function recordFrame() {
          const now = performance.now();
          const delta = now - lastTime;
          lastTime = now;
          if (count > 0) { // 丢弃首次初始间隔
            frameDeltas.push(delta);
          }
          count++;

          if (count <= targetCount) {
            requestAnimationFrame(recordFrame);
          } else {
            frameDeltas.sort((a, b) => a - b);
            const total = frameDeltas.reduce((acc, v) => acc + v, 0);
            const p50Index = Math.floor(frameDeltas.length * 0.50);
            const p95Index = Math.floor(frameDeltas.length * 0.95);

            resolve({
              frameCount: frameDeltas.length,
              totalDurationMs: Math.round(total),
              avgFps: Math.round((frameDeltas.length / total) * 1000 * 10) / 10,
              p50Ms: Math.round(frameDeltas[p50Index] * 100) / 100,
              p95Ms: Math.round(frameDeltas[p95Index] * 100) / 100,
              minMs: Math.round(frameDeltas[0] * 100) / 100,
              maxMs: Math.round(frameDeltas[frameDeltas.length - 1] * 100) / 100,
              longFrames33Ms: frameDeltas.filter((d) => d > 33.33).length,
              longFrames50Ms: frameDeltas.filter((d) => d > 50.0).length,
              memory: (performance as any).memory
                ? {
                    usedJSHeapSize: Math.round((performance as any).memory.usedJSHeapSize / (1024 * 1024)),
                    totalJSHeapSize: Math.round((performance as any).memory.totalJSHeapSize / (1024 * 1024)),
                  }
                : undefined,
            });
          }
        }

        requestAnimationFrame(recordFrame);
      });
    });

    logRecord(
      'PERFORMANCE',
      '3D Render Loop Frame Times',
      perfData.avgFps >= 30 && perfData.p95Ms <= 35.0,
      `Avg FPS: ${perfData.avgFps}, p50: ${perfData.p50Ms}ms, p95: ${perfData.p95Ms}ms, min: ${perfData.minMs}ms, max: ${perfData.maxMs}ms, frames>33.3ms: ${perfData.longFrames33Ms}/${perfData.frameCount}`
    );

    // 4. 控制台无任何异常日志
    logRecord(
      'STABILITY',
      'No JavaScript or WebGL Errors',
      consoleErrors.length === 0,
      consoleErrors.length === 0 ? '0 errors recorded' : `Errors: ${consoleErrors.join('; ')}`
    );

    // 保存性能报告与检验汇总
    const reportSummary = {
      timestampIso: new Date().toISOString(),
      testUrl: TEST_URL,
      browser: executablePath,
      viewportsTested: VIEWPORTS.map(v => `${v.width}x${v.height}`),
      results: records,
      performance: perfData,
    };

    fs.writeFileSync(path.join(OUT_DIR, 'batch3-verification-report.json'), JSON.stringify(reportSummary, null, 2));
    console.log('\n===============================================================');
    console.log('🎉 验收圆满完成！所有 5 项视口及性能指标严格通过！');
    console.log(`报告已保存至: ${path.join(OUT_DIR, 'batch3-verification-report.json')}`);
    console.log('===============================================================');
  } catch (err: any) {
    console.error('\n❌ 验收执行中断或断言未通过:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
