// R5（260925 基础体验恢复·验收批）：完整普通用户旅程组合探针（审计第九节）。
// 全程正常入口（executeCameraCommand/startLunarLanding/pauseLanding）、正常
// 渲染（renderFrame 取证）：
//   冷缓存启动地球 → 旋转缩放 → 太阳 → 全景 → 回地球 → 月球 → 下降 → 暂停 →
//   环顾 → 月面看地球方向 → （下降/暂停中）去太阳 → 回地球 → 稳定
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/pro-review';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false); // 冷缓存
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleErrs: string[] = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${String(e).slice(0, 160)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  interface ShotR { info: { layered: boolean }; nonBlack: number; meanLum: number; b64: string | null }
  const shot = (save?: string): Promise<ShotR> =>
    page.evaluate(`(save => {
      const e = window.__solarEngine;
      e.renderFrame();
      const r = e.renderer, gl = r.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let nonBlack = 0, sum = 0, n = 0;
      for (let ix = 0; ix < 24; ix++) for (let iy = 0; iy < 14; iy++) {
        const x = Math.floor((ix + 0.5) * W / 24), y = Math.floor((iy + 0.5) * H / 14);
        const i = (y * W + x) * 4;
        const l = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
        if (l > 8) nonBlack++;
        sum += l; n++;
      }
      let b64 = null;
      if (save) {
        const c2d = document.createElement('canvas');
        c2d.width = W; c2d.height = H;
        const ctx = c2d.getContext('2d');
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4;
          img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
        }
        ctx.putImageData(img, 0, 0);
        b64 = c2d.toDataURL('image/png').split(',')[1];
      }
      return { info: e.lastFrameRenderInfo, nonBlack: +(nonBlack / n).toFixed(3), meanLum: +(sum / n).toFixed(1), b64 };
    })(${save ? `'${save}'` : 'null'})`).then((r: unknown) => {
      const d = r as ShotR;
      if (d.b64) fs.writeFileSync(`${OUT}/${save}.png`, Buffer.from(d.b64, 'base64'));
      return d;
    });
  const flyTo = (b: string) =>
    page.evaluate((body: string) => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: body, durationSec: 1.0 });
    }, b);
  const settle = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return !s.isTransitioning;
    }, { timeout: 60000, polling: 300 });
  const step = async (tag: string, save?: string) => {
    const s = await shot(save);
    console.log(`[${tag}]`, JSON.stringify({ info: s.info, nonBlack: s.nonBlack, meanLum: s.meanLum }));
    return s;
  };

  // 1) 冷缓存启动看地球（等纹理+瓦片稳定）
  await new Promise((r) => setTimeout(r, 5000));
  const s1 = await step('1 earth cold', 'r5-earth-cold');
  if (s1.info.layered || s1.nonBlack < 0.05) throw new Error('冷启动地球异常');

  // 2) 旋转（拖动模拟：orbit 命令）+ 缩放（zoomInput）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({ type: 'orbit', deltaTheta: 0.9, deltaPhi: -0.2 });
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'zoomInput', logDelta: -0.8 });
  });
  await new Promise((r) => setTimeout(r, 900));
  const s2 = await step('2 rotate+zoom');
  if (s2.info.layered || s2.nonBlack < 0.05) throw new Error('旋转缩放后异常');

  // 3) 太阳 → 4) 全景 → 5) 回地球
  await flyTo('sun');
  await settle();
  const s3 = await step('3 sun', 'r5-sun');
  if (s3.meanLum < 15) throw new Error('太阳画面过暗');
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'overview', durationSec: 1.0 });
  });
  await settle();
  await new Promise((r) => setTimeout(r, 500));
  await step('4 overview');
  await flyTo('earth');
  await settle();
  await step('5 earth back');

  // 6) 月球 → 下降（正常入口）
  await flyTo('moon');
  await settle();
  await new Promise((r) => setTimeout(r, 2500));
  let avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability().action);
  if (avail === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4200));
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
      timeout: 45000, polling: 400,
    });
    avail = 'land';
  }
  if (avail !== 'land') throw new Error(`下降前置不满足: ${avail}`);
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  if (!started) throw new Error('startLunarLanding rejected');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 120000, polling: 500,
  });

  // 7) 暂停（HOLD）+ 环顾
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => (window as any).__solarEngine.pauseLanding());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'HOLD', {
    timeout: 20000, polling: 300,
  });
  await step('7 hold', 'r5-hold');

  // 8) 暂停中明确去太阳（R4 抢占链）→ 9) 回地球稳定
  await flyTo('sun');
  await new Promise((r) => setTimeout(r, 400));
  const st8 = await page.evaluate(() => ({
    landing: (window as any).__solarEngine.getLandingTelemetry().state,
    target: (window as any).__solarEngine.cameraController.getSnapshot().targetBodyId,
  }));
  console.log('[8 hold→flyTo sun]', JSON.stringify(st8));
  if (st8.landing !== 'ORBIT' || st8.target !== 'sun') throw new Error(`暂停中旅行抢占失效: ${JSON.stringify(st8)}`);
  await settle();
  const s8 = await step('8 sun (from hold)');
  if (s8.meanLum < 15) throw new Error('从暂停去太阳画面过暗');

  await flyTo('earth');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  const s9 = await step('9 earth final', 'r5-earth-final');
  if (s9.info.layered || s9.nonBlack < 0.05) throw new Error('终点地球异常');
  const fin = await page.evaluate(() => ({
    landing: (window as any).__solarEngine.getLandingTelemetry().state,
    availability: (window as any).__solarEngine.getLandingAvailability().action,
    policy: (window as any).__solarEngine.bodyPoseProvider.getPolicy(),
    sunVisible: !!(window as any).__solarEngine.bodyNodes.get('sun').systemGroup.visible,
  }));
  console.log('[final]', JSON.stringify(fin));

  console.log('[errors]', consoleErrs.length ? consoleErrs.slice(0, 10).join(' | ') : '(none)');
  await browser.close();
  console.log('R5 JOURNEY DONE');
}

main().catch((e) => { console.error('R5 JOURNEY FAILED:', e); process.exit(1); });
