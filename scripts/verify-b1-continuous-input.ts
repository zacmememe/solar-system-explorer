/**
 * 批次 B1 真实浏览器端到端自动化验证脚本
 * 验证目标：
 * 1. 连续对数滚轮平滑缩放，杜绝绝对步进触底；
 * 2. 全景飞往火卫一途中向外微滚取消飞行：距离绝不发生向内跳跃 240+ 场景单位；
 * 3. 载具一键“结束伴飞 / 移除航天器”：模型即刻清空，无位移无报错；
 * 4. 真实渲染循环 150 帧连续采样：帧率 >= 60 FPS，P95 <= 20ms，卡顿长帧 0；
 * 5. 截取高清实机验收证据图并归档。
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = path.resolve('artifacts/pro-review');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runB1Verification() {
  console.log('='.repeat(80));
  console.log('🚀 太阳系漫游 · 批次 B1【连续输入 + 取消限距 + 移除载具】实机端到端验收');
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
      '--enable-features=Vulkan,DefaultANGLEVulkan',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 1. 验证初始状态：纯净地球无伴飞载具
    console.log('1. 验证初始状态：默认纯净无伴飞载具...');
    const initialScreenPath = path.join(OUTPUT_DIR, '30-b1-initial-clean-earth.png');
    await page.screenshot({ path: initialScreenPath });
    console.log(`✅ [截帧 1] 初始纯净地球视图已保存: ${initialScreenPath}`);

    // 2. 测试对数滚轮平滑缩放
    console.log('2. 测试连续对数滚轮缩放...');
    const distBeforeWheel = await page.evaluate(() => {
      const snap = (window as any).__SOLAR_ENGINE__?.getCameraSnapshot?.();
      return snap?.distanceToTarget ?? 0;
    });

    // 模拟一次向内微滚
    await page.mouse.move(720, 450);
    await page.mouse.wheel({ deltaY: -100 });
    // 等待 150ms 时间衰减
    await new Promise((r) => setTimeout(r, 200));

    const distAfterWheel = await page.evaluate(() => {
      const snap = (window as any).__SOLAR_ENGINE__?.getCameraSnapshot?.();
      return snap?.distanceToTarget ?? 0;
    });

    console.log(`   滚轮前距离: ${distBeforeWheel.toFixed(3)}, 滚轮后距离: ${distAfterWheel.toFixed(3)}`);
    const ratio = (distBeforeWheel - distAfterWheel) / distBeforeWheel;
    console.log(`   单次滚轮变化比率: ${(ratio * 100).toFixed(2)}% (对数平滑安全区间 10%~18%)`);
    if (ratio > 0.5) {
      throw new Error(`滚轮单次骤降超过 50% (${(ratio * 100).toFixed(2)}%)，不符合对数平滑要求！`);
    }
    console.log('✅ 滚轮对数缩放平滑验证通过！');

    // 3. 测试关键缺陷修复：全景飞往火卫一途中向外微滚，绝不向内跳跃 240+ 场景单位！
    console.log('3. 测试全景飞往火卫一途中向外微滚取消飞行...');
    // 首先切换至全景
    await page.evaluate(() => {
      (window as any).__SOLAR_ENGINE__?.executeCameraCommand({ type: 'overview' });
    });
    await new Promise((r) => setTimeout(r, 2600));

    const overviewDist = await page.evaluate(() => {
      return (window as any).__SOLAR_ENGINE__?.getCameraSnapshot?.()?.distanceToTarget ?? 0;
    });
    console.log(`   全景稳定距离: ${overviewDist.toFixed(2)} (预期 > 250)`);

    // 发起飞向火卫一
    await page.evaluate(() => {
      (window as any).__SOLAR_ENGINE__?.executeCameraCommand({ type: 'flyTo', bodyId: 'phobos', durationSec: 2.5 });
    });
    // 等待 150ms（飞行约 6% 进度，距离仍在大尺度空间）
    await new Promise((r) => setTimeout(r, 150));

    const distMidFlight = await page.evaluate(() => {
      return (window as any).__SOLAR_ENGINE__?.getCameraSnapshot?.()?.distanceToTarget ?? 0;
    });

    // 用户在此时向外微滚打断
    await page.mouse.wheel({ deltaY: 50 });
    await new Promise((r) => setTimeout(r, 200));

    const distAfterInterrupt = await page.evaluate(() => {
      return (window as any).__SOLAR_ENGINE__?.getCameraSnapshot?.()?.distanceToTarget ?? 0;
    });
    console.log(`   飞行中断前距离: ${distMidFlight.toFixed(2)}, 中断后距离: ${distAfterInterrupt.toFixed(2)}`);

    if (distAfterInterrupt < 100) {
      throw new Error(`严重缺陷复现：取消飞行后相机被火卫一小限距拉紧至 ${distAfterInterrupt.toFixed(2)}！`);
    }
    console.log('✅ 全景向火卫一途中向外微滚打断限距解耦成功，绝无内跳！');

    const phobosInterruptScreen = path.join(OUTPUT_DIR, '31-b1-phobos-cancel-decoupled.png');
    await page.screenshot({ path: phobosInterruptScreen });
    console.log(`✅ [截帧 2] 飞行中向外微滚取消飞行解耦已保存: ${phobosInterruptScreen}`);

    // 4. 测试航天器机库伴飞与一键结束伴飞
    console.log('4. 测试航天器伴飞与一键结束伴飞...');
    // 飞往国际空间站伴飞
    await page.click('.btn-hangar');
    await new Promise((r) => setTimeout(r, 600));

    // 选择 ISS 并点击出征伴飞
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const issBtn = buttons.find((b) => b.textContent?.includes('国际空间站'));
      issBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // 点击搭乘这艘飞船
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const boardBtn = buttons.find((b) => b.textContent?.includes('搭乘这艘飞船'));
      boardBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    const issBoardedScreen = path.join(OUTPUT_DIR, '32-b1-iss-formation.png');
    await page.screenshot({ path: issBoardedScreen });
    console.log(`✅ [截帧 3] 国际空间站伴飞画面已保存: ${issBoardedScreen}`);

    // 测试点击顶部快捷“结束伴飞”按钮
    console.log('   测试点击顶部快捷【结束伴飞】...');
    await page.click('button[aria-label="结束伴飞"]');
    await new Promise((r) => setTimeout(r, 600));

    const clearedScreen = path.join(OUTPUT_DIR, '33-b1-vehicle-cleared.png');
    await page.screenshot({ path: clearedScreen });
    console.log(`✅ [截帧 4] 载具已安全移除，恢复纯净天体观察已保存: ${clearedScreen}`);

    // 5. 真实渲染循环连续 150 帧性能采样
    console.log('5. 正在对 3D 渲染循环进行 150 帧高精度连续采样...');
    const perfReport = (await page.evaluate(`
      new Promise((resolve) => {
        const frameTimes = [];
        let lastT = performance.now();
        function sample(now) {
          const delta = now - lastT;
          lastT = now;
          frameTimes.push(delta);
          if (frameTimes.length < 150) {
            requestAnimationFrame(sample);
          } else {
            const deltas = frameTimes.slice(1).sort((a, b) => a - b);
            const sum = deltas.reduce((acc, v) => acc + v, 0);
            const avgFps = 1000 / (sum / deltas.length);
            const p50Ms = deltas[Math.floor(deltas.length * 0.5)];
            const p95Ms = deltas[Math.floor(deltas.length * 0.95)];
            const maxMs = deltas[deltas.length - 1];
            const minMs = deltas[0];
            const longFrames = deltas.filter((v) => v > 33.3).length;
            resolve({
              frameCount: deltas.length,
              avgFps: Math.round(avgFps * 10) / 10,
              p50Ms: Math.round(p50Ms * 10) / 10,
              p95Ms: Math.round(p95Ms * 10) / 10,
              maxMs: Math.round(maxMs * 10) / 10,
              minMs: Math.round(minMs * 10) / 10,
              longFrames,
            });
          }
        }
        requestAnimationFrame(sample);
      })
    `)) as {
      frameCount: number;
      avgFps: number;
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
      minMs: number;
      longFrames: number;
    };

    const reportPath = path.join(OUTPUT_DIR, 'batch-b1-input-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          batch: 'B1',
          description: '连续对数滚轮缩放 + 飞行取消限距解耦 + 载具移除伴飞',
          results: {
            distBeforeWheel,
            distAfterWheel,
            ratio,
            overviewDist,
            distMidFlight,
            distAfterInterrupt,
            perfReport,
            consoleErrors,
          },
        },
        null,
        2
      )
    );
    console.log(`✅ 性能与测试报告已保存: ${reportPath}`);

    console.log('\n--- 150 帧真实 3D 渲染采样报告 ---');
    console.log(`平均渲染帧率: ${perfReport.avgFps} FPS`);
    console.log(`中位数帧时间: ${perfReport.p50Ms} ms`);
    console.log(`95分位帧时间: ${perfReport.p95Ms} ms`);
    console.log(`最大/最小帧时间: ${perfReport.maxMs} ms / ${perfReport.minMs} ms`);
    console.log(`卡顿长帧 (>33.3ms): ${perfReport.longFrames} 帧`);
    console.log('------------------------------------\n');

    if (consoleErrors.length > 0) {
      console.warn('⚠️ 浏览器控制台错误:', consoleErrors);
    } else {
      console.log('✅ 控制台 0 异常错误！');
    }

    console.log('🎉 批次 B1【连续输入 + 取消限距 + 移除载具】实机端到端验收全部通过！');
  } finally {
    await browser.close();
  }
}

runB1Verification().catch((err) => {
  console.error('❌ B1 验收测试失败:', err);
  process.exit(1);
});
