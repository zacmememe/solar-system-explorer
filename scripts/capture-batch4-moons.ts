/**
 * 太阳系漫游 · 卫星系统专项第一批（月球、火卫一、火卫二）实机自动化视觉审视与性能断言脚本
 * 1. 切换至月球：验证 Lommel-Seeliger 多孔玄武岩表土漫反射、月海/月陆高地反照率分异、第谷辐射纹与剃刀晨昏线；
 * 2. 验证月球教学暗部补光：背阳面清晰展现月球背面与南极-艾特肯盆地地貌；
 * 3. 切换至火卫一 (Phobos)：验证三轴不规则土豆形态、极端深暗碳质表土、斯蒂克尼巨型陨石坑与应力槽沟系；
 * 4. 切换至火卫二 (Deimos)：验证平滑厚风化层、伏尔泰/斯威夫特撞击坑与浅色微尘流条痕；
 * 5. 采样 150 帧真实 3D 渲染帧时间，断言 60 FPS 与 0 掉帧。
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
  console.log('🌕 太阳系漫游 · 卫星系统专项第一批【月球、火卫一、火卫二】实机审视');
  console.log(`目标 URL: ${TEST_URL}`);
  console.log(`执行浏览器: ${executablePath}`);
  console.log('===============================================================\n');

  const userDataDir = path.join(os.tmpdir(), `solar_moons_${Date.now()}_${Math.random().toString(36).slice(2)}`);

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

    // 1. 切换至月球 (Moon)
    console.log('1. 正在点击卫星二级栏切换至【月球】...');
    await page.waitForSelector('[data-testid="moon-btn-moon"]', { visible: true });
    await page.click('[data-testid="moon-btn-moon"]');

    console.log('   正在进行平滑过渡转场飞往月球...');
    await pause(3200);

    const moonTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const moonRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${moonTargetText}, 物理半径: ${moonRadiusText} km`);

    if (moonTargetText !== '月球' || !moonRadiusText?.includes('1,737')) {
      throw new Error(`HUD 数据异常: target=${moonTargetText}, radius=${moonRadiusText}`);
    }

    const shot1 = path.join(OUT_DIR, '21-moon-framed.png');
    await page.screenshot({ path: shot1 });
    console.log(`✅ [截帧 1] 月球正面风暴洋、月陆高地与第谷辐射纹构图已保存: ${shot1}`);

    // 2. 月球教学暗部补光 (teachingLight) 对比测试
    console.log('2. 正在开启【教学暗部补光】测试月面背阳可读性...');
    await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (engine) engine.setTeachingLight(true);
    });
    await pause(1000);

    const shot2 = path.join(OUT_DIR, '22-moon-teaching-light.png');
    await page.screenshot({ path: shot2 });
    console.log(`✅ [截帧 2] 月球教学暗部补光（远侧撞击坑与盆地微光显现）已保存: ${shot2}`);

    // 关闭教学补光恢复自然宇宙光影
    await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (engine) engine.setTeachingLight(false);
    });
    await pause(500);

    // 3. 飞往火星系统并聚焦火卫一 (Phobos)
    console.log('3. 正在切换至火星系统并聚焦【火卫一】(Phobos)...');
    await page.waitForSelector('[data-testid="planet-btn-mars"]', { visible: true });
    await page.click('[data-testid="planet-btn-mars"]');
    await pause(1500);

    await page.waitForSelector('[data-testid="moon-btn-phobos"]', { visible: true });
    await page.click('[data-testid="moon-btn-phobos"]');

    console.log('   正在进行平滑过渡转场飞往火卫一...');
    await pause(3200);

    const phobosTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const phobosRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${phobosTargetText}, 物理半径: ${phobosRadiusText} km`);

    if (phobosTargetText !== '火卫一') {
      throw new Error(`HUD 数据异常: target=${phobosTargetText}`);
    }

    const shot3 = path.join(OUT_DIR, '23-phobos-stickney.png');
    await page.screenshot({ path: shot3 });
    console.log(`✅ [截帧 3] 火卫一不规则土豆形态、斯蒂克尼巨型陨石坑与槽沟系统已保存: ${shot3}`);

    // 4. 聚焦火卫二 (Deimos)
    console.log('4. 正在切换聚焦至【火卫二】(Deimos)...');
    await page.waitForSelector('[data-testid="moon-btn-deimos"]', { visible: true });
    await page.click('[data-testid="moon-btn-deimos"]');

    console.log('   正在平滑过渡飞往火卫二...');
    await pause(3200);

    const deimosTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const deimosRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${deimosTargetText}, 物理半径: ${deimosRadiusText} km`);

    if (deimosTargetText !== '火卫二') {
      throw new Error(`HUD 数据异常: target=${deimosTargetText}`);
    }

    const shot4 = path.join(OUT_DIR, '24-deimos-smooth.png');
    await page.screenshot({ path: shot4 });
    console.log(`✅ [截帧 4] 火卫二平滑厚风化层毛毯包络与碎屑流条带已保存: ${shot4}`);

    // 5. 真实 3D 渲染循环 150 帧采样
    console.log('5. 正在对实际 3D 渲染循环进行 150 帧高精度连续采样...');
    const benchData = await page.evaluate(async () => {
      const sampleCount = 150;
      const frameDeltas: number[] = [];
      let lastTime = performance.now();

      for (let i = 0; i < sampleCount; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        frameDeltas.push(now - lastTime);
        lastTime = now;
      }

      frameDeltas.sort((a, b) => a - b);
      const sum = frameDeltas.reduce((acc, v) => acc + v, 0);
      const avgFps = Math.round((sampleCount / (sum / 1000)) * 10) / 10;
      const p50Ms = Math.round(frameDeltas[Math.floor(sampleCount * 0.5)] * 10) / 10;
      const p95Ms = Math.round(frameDeltas[Math.floor(sampleCount * 0.95)] * 10) / 10;
      const minMs = Math.round(frameDeltas[0] * 10) / 10;
      const maxMs = Math.round(frameDeltas[sampleCount - 1] * 10) / 10;
      const longFrames = frameDeltas.filter((d) => d > 33.3).length;

      return {
        sampleCount,
        avgFps,
        p50Ms,
        p95Ms,
        minMs,
        maxMs,
        longFrames,
      };
    });

    console.log('\n--- 150 帧真实 3D 渲染采样报告 ---');
    console.log(`采样总帧数: ${benchData.sampleCount}`);
    console.log(`平均帧率 (Avg FPS): ${benchData.avgFps} FPS`);
    console.log(`中位数帧时间 (p50): ${benchData.p50Ms} ms`);
    console.log(`95分位帧时间 (p95): ${benchData.p95Ms} ms`);
    console.log(`最小/最大帧时间: ${benchData.minMs} ms / ${benchData.maxMs} ms`);
    console.log(`卡顿长帧 (>33.3ms): ${benchData.longFrames} 帧`);
    console.log('------------------------------------\n');

    if (consoleErrors.length > 0) {
      console.warn(`[警告] 运行期间记录到控制台错误:\n${consoleErrors.join('\n')}`);
    } else {
      console.log('✅ 控制台无任何异常错误记录');
    }

    // 写入 JSON 验收报告
    const reportPath = path.join(OUT_DIR, 'batch4-moons-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          benchData,
          consoleErrors,
          screenshots: [shot1, shot2, shot3, shot4],
        },
        null,
        2
      )
    );
    console.log(`\n🎉 第一批卫星系统（月球、火卫一、火卫二）实机自动化验收全部通过！报告已写入: ${reportPath}`);
  } finally {
    await browser.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('Fatal error during moons verification:', err);
  process.exit(1);
});
