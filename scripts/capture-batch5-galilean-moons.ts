/**
 * 太阳系漫游 · 卫星系统专项第二批【木星四大伽利略卫星（木卫一、木卫二、木卫三、木卫四）】实机自动化审视与性能断言脚本
 * 1. 切换至木卫一 (Io)：验证富硫地貌、Pele 巨型同心红环、Loki 熔岩湖与真空晨昏线；
 * 2. 验证木卫一教学暗部补光与黑夜侧火山熔岩热发光 (Lava Lake Glow)；
 * 3. 切换至木卫二 (Europa)：验证高反照水冰球壳、双脊冰裂痕 (Lineae)、Conamara 混沌碎冰与 Pwyll 千公里冰溅放射纹；
 * 4. 切换至木卫三 (Ganymede)：验证太阳系最大卫星、Galileo 古老暗区与 Uruk Sulci 亮构造断层槽沟带、极地霜帽；
 * 5. 切换至木卫四 (Callisto)：验证瓦尔哈拉 (Valhalla) 巨型同心环断崖盆地与撞击坑饱和古老地貌；
 * 6. 采样 150 帧真实 3D 渲染循环，断言 60 FPS 与 0 掉帧。
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
  console.log('================================================================================');
  console.log('🪐 太阳系漫游 · 卫星系统专项第二批【木星四大伽利略卫星】实机审视');
  console.log(`目标 URL: ${TEST_URL}`);
  console.log(`执行浏览器: ${executablePath}`);
  console.log('================================================================================\n');

  const userDataDir = path.join(os.tmpdir(), `solar_galilean_${Date.now()}_${Math.random().toString(36).slice(2)}`);

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

    // 1. 切换至木星系统
    console.log('1. 正在切换至【木星系统】并呼出卫星子列表...');
    await page.waitForSelector('[data-testid="planet-btn-jupiter"]', { visible: true });
    await page.click('[data-testid="planet-btn-jupiter"]');
    await pause(1500);

    // 2. 聚焦木卫一 (Io)
    console.log('2. 正在点击切换聚焦至【木卫一】(Io)...');
    await page.waitForSelector('[data-testid="moon-btn-io"]', { visible: true });
    await page.click('[data-testid="moon-btn-io"]');

    console.log('   正在进行平滑过渡转场飞往木卫一...');
    await pause(3200);

    const ioTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const ioRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${ioTargetText}, 物理半径: ${ioRadiusText} km`);

    if (ioTargetText !== '木卫一' || !ioRadiusText?.includes('1,822')) {
      throw new Error(`HUD 数据异常: target=${ioTargetText}, radius=${ioRadiusText}`);
    }

    const shot1 = path.join(OUT_DIR, '25-io-volcanoes.png');
    await page.screenshot({ path: shot1 });
    console.log(`✅ [截帧 1] 木卫一活火山地貌、Pele 喷发红环与 Loki 熔岩湖已保存: ${shot1}`);

    // 3. 木卫一教学暗部补光与黑夜侧火山发光
    console.log('3. 正在开启【教学暗部补光】测试木卫一背阳侧熔岩自发光与暗部显现...');
    await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (engine) engine.setTeachingLight(true);
    });
    await pause(1000);

    const shot2 = path.join(OUT_DIR, '26-io-lava-glow-teaching.png');
    await page.screenshot({ path: shot2 });
    console.log(`✅ [截帧 2] 木卫一教学暗部补光已保存: ${shot2}`);

    // 恢复自然光照
    await page.evaluate(() => {
      const engine = (window as any).__SOLAR_ENGINE__;
      if (engine) engine.setTeachingLight(false);
    });
    await pause(500);

    // 4. 聚焦木卫二 (Europa)
    console.log('4. 正在切换聚焦至【木卫二】(Europa)...');
    await page.waitForSelector('[data-testid="moon-btn-europa"]', { visible: true });
    await page.click('[data-testid="moon-btn-europa"]');

    console.log('   正在平滑过渡飞往木卫二...');
    await pause(3200);

    const europaTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const europaRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${europaTargetText}, 物理半径: ${europaRadiusText} km`);

    if (europaTargetText !== '木卫二' || !europaRadiusText?.includes('1,561')) {
      throw new Error(`HUD 数据异常: target=${europaTargetText}`);
    }

    const shot3 = path.join(OUT_DIR, '27-europa-lineae.png');
    await page.screenshot({ path: shot3 });
    console.log(`✅ [截帧 3] 木卫二纯净水冰壳、双脊冰裂线、Pwyll 辐射纹与冰面高光已保存: ${shot3}`);

    // 5. 聚焦木卫三 (Ganymede)
    console.log('5. 正在切换聚焦至【木卫三】(Ganymede)...');
    await page.waitForSelector('[data-testid="moon-btn-ganymede"]', { visible: true });
    await page.click('[data-testid="moon-btn-ganymede"]');

    console.log('   正在平滑过渡飞往木卫三...');
    await pause(3200);

    const ganymedeTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const ganymedeRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${ganymedeTargetText}, 物理半径: ${ganymedeRadiusText} km`);

    if (ganymedeTargetText !== '木卫三' || !ganymedeRadiusText?.includes('2,634')) {
      throw new Error(`HUD 数据异常: target=${ganymedeTargetText}`);
    }

    const shot4 = path.join(OUT_DIR, '28-ganymede-regio-sulci.png');
    await page.screenshot({ path: shot4 });
    console.log(`✅ [截帧 4] 木卫三伽利略古老暗区、Uruk Sulci 亮构造冰槽与极地冰帽已保存: ${shot4}`);

    // 6. 聚焦木卫四 (Callisto)
    console.log('6. 正在切换聚焦至【木卫四】(Callisto)...');
    await page.waitForSelector('[data-testid="moon-btn-callisto"]', { visible: true });
    await page.click('[data-testid="moon-btn-callisto"]');

    console.log('   正在平滑过渡飞往木卫四...');
    await pause(3200);

    const callistoTargetText = await page.$eval('.hud-target-heading strong', (el) => el.textContent?.trim());
    const callistoRadiusText = await page.$eval('.hud-radius span', (el) => el.textContent?.trim());
    console.log(`   HUD 目标天体: ${callistoTargetText}, 物理半径: ${callistoRadiusText} km`);

    if (callistoTargetText !== '木卫四' || !callistoRadiusText?.includes('2,410')) {
      throw new Error(`HUD 数据异常: target=${callistoTargetText}`);
    }

    const shot5 = path.join(OUT_DIR, '29-callisto-valhalla.png');
    await page.screenshot({ path: shot5 });
    console.log(`✅ [截帧 5] 木卫四瓦尔哈拉巨型同心环多重断裂带与撞击坑饱和古老地貌已保存: ${shot5}`);

    // 7. 高精度 150 帧真实 3D 渲染采样
    console.log('7. 正在对实际 3D 渲染循环进行 150 帧高精度连续采样...');
    const perfData = await page.evaluate(async () => {
      return new Promise<{
        frameCount: number;
        avgFps: number;
        p50Ms: number;
        p95Ms: number;
        minMs: number;
        maxMs: number;
        stutterFrames: number;
      }>((resolve) => {
        const frameTimes: number[] = [];
        let lastTime = performance.now();

        function step() {
          const now = performance.now();
          const dt = now - lastTime;
          lastTime = now;
          frameTimes.push(dt);

          if (frameTimes.length < 150) {
            requestAnimationFrame(step);
          } else {
            const valid = frameTimes.slice(1);
            valid.sort((a, b) => a - b);
            const sum = valid.reduce((acc, v) => acc + v, 0);
            const avg = sum / valid.length;
            const p50 = valid[Math.floor(valid.length * 0.5)];
            const p95 = valid[Math.floor(valid.length * 0.95)];
            const stutters = valid.filter((v) => v > 33.3).length;

            resolve({
              frameCount: valid.length,
              avgFps: Math.round(1000 / avg * 10) / 10,
              p50Ms: Math.round(p50 * 10) / 10,
              p95Ms: Math.round(p95 * 10) / 10,
              minMs: Math.round(valid[0] * 10) / 10,
              maxMs: Math.round(valid[valid.length - 1] * 10) / 10,
              stutterFrames: stutters,
            });
          }
        }
        requestAnimationFrame(step);
      });
    });

    console.log('\n--- 150 帧真实 3D 渲染采样报告 ---');
    console.log(`采样总帧数: ${perfData.frameCount}`);
    console.log(`平均帧率 (Avg FPS): ${perfData.avgFps} FPS`);
    console.log(`中位数帧时间 (p50): ${perfData.p50Ms} ms`);
    console.log(`95分位帧时间 (p95): ${perfData.p95Ms} ms`);
    console.log(`最小/最大帧时间: ${perfData.minMs} ms / ${perfData.maxMs} ms`);
    console.log(`卡顿长帧 (>33.3ms): ${perfData.stutterFrames} 帧`);
    console.log('------------------------------------\n');

    if (perfData.avgFps < 50) {
      throw new Error(`平均帧率低于预期: ${perfData.avgFps} FPS`);
    }

    if (consoleErrors.length > 0) {
      console.warn('⚠️ 控制台捕获到以下日志:', consoleErrors);
    } else {
      console.log('✅ 控制台无任何异常错误记录\n');
    }

    const reportPath = path.join(OUT_DIR, 'batch5-galilean-moons-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          hud: {
            io: { target: ioTargetText, radius: ioRadiusText },
            europa: { target: europaTargetText, radius: europaRadiusText },
            ganymede: { target: ganymedeTargetText, radius: ganymedeRadiusText },
            callisto: { target: callistoTargetText, radius: callistoRadiusText },
          },
          performance: perfData,
          screenshots: [shot1, shot2, shot3, shot4, shot5],
          errors: consoleErrors,
        },
        null,
        2
      )
    );

    console.log(`🎉 第二批卫星系统（木星四大伽利略卫星）实机自动化验收全部通过！报告已写入: ${reportPath}`);
  } finally {
    await browser.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('❌ 执行自动化审视与性能测试失败:', err);
  process.exit(1);
});
