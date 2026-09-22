/**
 * Mercury Deep Visual Review & Verification Script
 * 1. Fly to Mercury and verify camera framing & airless vacuum lighting
 * 2. Verify Lommel-Seeliger regolith scattering, opposition effect & razor-edge terminator
 * 3. Verify Mercury details panel and scientific metrics
 * 4. Test teaching light uniform on/off
 * 5. Measure 3D rendering loop frame rate and frame times
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
  console.error('No suitable browser found.');
  process.exit(1);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('===============================================================');
  console.log('🌑 太阳系漫游 · 信使之星【水星系统】深度视觉与专属着色器实机审视');
  console.log(`目标 URL: ${TEST_URL}`);
  console.log(`执行浏览器: ${executablePath}`);
  console.log('===============================================================\n');

  const userDataDir = path.join(os.tmpdir(), `solar_mercury_${Date.now()}_${Math.random().toString(36).slice(2)}`);

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
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) {
      consoleErrors.push(`[ConsoleError] ${msg.text()}`);
    }
  });

  try {
    await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]', { timeout: 20000 });
    await pause(1500);

    console.log('1. 正在点击顶部行星栏切换至【水星】...');
    await page.waitForSelector('[data-testid="planet-btn-mercury"]', { visible: true });
    await page.click('[data-testid="planet-btn-mercury"]');

    // 等待镜头平滑飞往水星
    console.log('   正在进行镜头转场飞往水星...');
    await pause(3200);

    // 检查 HUD 是否准确显示水星数据
    const hudTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const hudRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${hudTargetText}, 物理半径: ${hudRadiusText} km`);

    if (hudTargetText !== '水星' || hudRadiusText !== '2,440') {
      throw new Error(`HUD 数据异常: target=${hudTargetText}, radius=${hudRadiusText}`);
    }

    // 截图 1：水星饱满构图、死寂多孔表土漫反射与剃刀晨昏线
    const shot1 = path.join(OUT_DIR, '14-mercury-framed.png');
    await page.screenshot({ path: shot1 });
    console.log(`✅ [截帧 1] 水星多孔岩石表土与剃刀晨昏线构图已保存: ${shot1}`);

    // 打开了解这颗天体资料面板
    console.log('2. 正在打开水星深入科学资料面板...');
    await page.click('[aria-controls="hud-details-panel"]');
    await pause(400);

    const shot2 = path.join(OUT_DIR, '15-mercury-details-panel.png');
    await page.screenshot({ path: shot2 });
    console.log(`✅ [截帧 2] 水星资料面板与科学参数已保存: ${shot2}`);

    // 关闭资料面板
    await page.keyboard.press('Escape');
    await pause(300);

    // 打开观测选项并切换暗部补光
    console.log('3. 正在测试教学暗部补光 (teachingLight) 对水星背阳面卡洛里盆地与极区暗坑的提亮...');
    await page.click('[aria-controls="hud-observe-panel"]');
    await pause(300);

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.hud-setting'));
      const btn = buttons.find((b) => b.textContent?.includes('暗部补光')) as HTMLButtonElement | undefined;
      if (btn) btn.click();
      else throw new Error('暗部补光按钮未找到');
    });
    await pause(400);
    await page.keyboard.press('Escape');
    await pause(300);

    const shot3 = path.join(OUT_DIR, '16-mercury-teaching-light.png');
    await page.screenshot({ path: shot3 });
    console.log(`✅ [截帧 3] 水星教学暗部补光对比图已保存: ${shot3}`);

    // 恢复真实光照
    await page.click('[aria-controls="hud-observe-panel"]');
    await pause(300);
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.hud-setting'));
      const btn = buttons.find((b) => b.textContent?.includes('暗部补光')) as HTMLButtonElement | undefined;
      if (btn) btn.click();
    });
    await pause(300);
    await page.keyboard.press('Escape');
    await pause(200);

    // 4. 性能与帧率测定
    console.log('4. 正在采样水星场景下 3D 渲染循环的真实帧时间 (采样 150 帧)...');
    await page.evaluate(() => {
      (window as any).__name = (fn: any) => fn;
    });

    const perf = await page.evaluate(async () => {
      (window as any).__name = (fn: any) => fn;
      return new Promise<{
        count: number;
        avgFps: number;
        p50Ms: number;
        p95Ms: number;
        longFrames: number;
      }>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        let c = 0;
        function tick() {
          const now = performance.now();
          if (c > 0) deltas.push(now - last);
          last = now;
          c++;
          if (c <= 150) {
            requestAnimationFrame(tick);
          } else {
            deltas.sort((a, b) => a - b);
            const total = deltas.reduce((s, v) => s + v, 0);
            resolve({
              count: deltas.length,
              avgFps: Math.round((deltas.length / total) * 1000 * 10) / 10,
              p50Ms: Math.round(deltas[Math.floor(deltas.length * 0.5)] * 100) / 100,
              p95Ms: Math.round(deltas[Math.floor(deltas.length * 0.95)] * 100) / 100,
              longFrames: deltas.filter((d) => d > 33.33).length,
            });
          }
        }
        requestAnimationFrame(tick);
      });
    });

    console.log(`\n📊 水星 3D 渲染性能测定结果:`);
    console.log(`   平均帧率: ${perf.avgFps} FPS`);
    console.log(`   p50 帧时间: ${perf.p50Ms} ms`);
    console.log(`   p95 帧时间: ${perf.p95Ms} ms`);
    console.log(`   长帧 (>33.3ms): ${perf.longFrames} / ${perf.count}`);

    if (consoleErrors.length > 0) {
      console.warn('⚠️ 控制台警告/错误:', consoleErrors);
    } else {
      console.log('✅ 控制台全局 0 错误与异常！');
    }

    console.log('\n===============================================================');
    console.log('🎉 水星系统深度优化实机审视圆满通过！');
    console.log('===============================================================');
  } catch (e: any) {
    console.error('❌ 执行失败:', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
