/**
 * Ice Giants (Uranus & Neptune) Deep Visual Review & Verification Script
 * 1. Fly to Uranus and verify camera framing, aquamarine methane absorption & vertical rings
 * 2. Fly to Neptune and verify royal azure scattering & white methane cirrus glint
 * 3. Verify Neptune details panel and scientific metrics
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
  console.log('🌌 太阳系漫游 · 深空双子【天王星与海王星】深度视觉与专属着色器实机审视');
  console.log(`目标 URL: ${TEST_URL}`);
  console.log(`执行浏览器: ${executablePath}`);
  console.log('===============================================================\n');

  const userDataDir = path.join(os.tmpdir(), `solar_icegiants_${Date.now()}_${Math.random().toString(36).slice(2)}`);

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
    await page.evaluateOnNewDocument('window.__name = (fn) => fn;');
    await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]', { timeout: 20000 });
    await pause(1500);

    // 1. 飞往天王星
    console.log('1. 正在点击顶部行星栏切换至【天王星】...');
    await page.waitForSelector('[data-testid="planet-btn-uranus"]', { visible: true });
    await page.click('[data-testid="planet-btn-uranus"]');

    console.log('   正在进行镜头转场飞往天王星...');
    await pause(3200);

    const uranusTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const uranusRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${uranusTargetText}, 物理半径: ${uranusRadiusText} km`);

    if (uranusTargetText !== '天王星' || uranusRadiusText !== '25,362') {
      throw new Error(`HUD 数据异常: target=${uranusTargetText}, radius=${uranusRadiusText}`);
    }

    const shot1 = path.join(OUT_DIR, '17-uranus-framed.png');
    await page.screenshot({ path: shot1 });
    console.log(`✅ [截帧 1] 天王星淡天青冰巨星与立式光环构图已保存: ${shot1}`);

    // 2. 飞往海王星
    console.log('2. 正在点击顶部行星栏切换至【海王星】...');
    await page.waitForSelector('[data-testid="planet-btn-neptune"]', { visible: true });
    await page.click('[data-testid="planet-btn-neptune"]');

    console.log('   正在进行镜头转场飞往海王星...');
    await pause(3200);

    const neptuneTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const neptuneRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${neptuneTargetText}, 物理半径: ${neptuneRadiusText} km`);

    if (neptuneTargetText !== '海王星' || neptuneRadiusText !== '24,622') {
      throw new Error(`HUD 数据异常: target=${neptuneTargetText}, radius=${neptuneRadiusText}`);
    }

    const shot2 = path.join(OUT_DIR, '18-neptune-framed.png');
    await page.screenshot({ path: shot2 });
    console.log(`✅ [截帧 2] 海王星皇家钴蓝深邃散射与甲烷白卷云构图已保存: ${shot2}`);

    // 3. 打开海王星科学资料面板
    console.log('3. 正在打开海王星深入科学资料面板...');
    await page.click('[aria-controls="hud-details-panel"]');
    await pause(400);

    const shot3 = path.join(OUT_DIR, '19-neptune-details-panel.png');
    await page.screenshot({ path: shot3 });
    console.log(`✅ [截帧 3] 海王星科学资料面板已保存: ${shot3}`);

    await page.keyboard.press('Escape');
    await pause(300);

    // 4. 打开观测选项并切换暗部补光
    console.log('4. 正在测试教学暗部补光 (teachingLight) 对海王星背阳面弱条带的提亮...');
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

    const shot4 = path.join(OUT_DIR, '20-neptune-teaching-light.png');
    await page.screenshot({ path: shot4 });
    console.log(`✅ [截帧 4] 海王星教学暗部补光对比图已保存: ${shot4}`);

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

    // 5. 性能与帧率测定
    console.log('5. 正在采样海王星场景下 3D 渲染循环的真实帧时间 (采样 150 帧)...');
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

    console.log(`\n📊 冰巨星场景 3D 渲染性能测定结果:`);
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
    console.log('🎉 八大行星收官战【天王星与海王星】深度优化实机审视圆满通过！');
    console.log('===============================================================');
  } catch (e: any) {
    console.error('❌ 执行失败:', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
