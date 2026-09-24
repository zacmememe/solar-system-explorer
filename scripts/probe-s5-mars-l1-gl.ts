// S5-1 探针 v2：绕过合成器直接读 GL 帧缓冲截图（headless d3d11 合成通道在
// L1 重几何下损坏——readPixels 路径给出真实渲染内容）
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
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible, { timeout: 60000 });

  const glShot = (name: string) =>
    page.evaluate(`(() => {
      const e = window.__solarEngine;
      const renderer = e.renderer;
      renderer.render(e.scene, e.camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const px = (x, y) => { const i = ((H - 1 - y) * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
      const diag = {
        exposure: +renderer.toneMappingExposure.toFixed(3),
        haloVisible: e.marsHaloMesh ? e.marsHaloMesh.visible : 'n/a',
        fog: e.scene.fog ? e.scene.fog.color.getHexString() : null,
        pxGround: px(Math.floor(W / 2), Math.floor(H * 0.3)),
        pxSky: px(Math.floor(W / 2), Math.floor(H * 0.85)),
        pxUpperLeft: px(Math.floor(W * 0.15), Math.floor(H * 0.12)),
        pxUpperRight: px(Math.floor(W * 0.85), Math.floor(H * 0.12)),
      };
      const c2d = document.createElement('canvas');
      c2d.width = W; c2d.height = H;
      const ctx = c2d.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4;
        img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
      }
      ctx.putImageData(img, 0, 0);
      return { b64: c2d.toDataURL('image/png'), diag };
    })()`).then((res: unknown) => {
      const r = res as { b64: string; diag: unknown };
      fs.writeFileSync(`${OUT}/s5-gl-${name}.png`, Buffer.from(r.b64.split(',')[1], 'base64'));
      console.log(`[gl-shot] ${name}`, JSON.stringify(r.diag));
    });

  // L1 栈断言
  const stack = await page.evaluate(() => {
    const names = (window as any).__solarEngine.getMarsTerrainMesh().parent.children.map((c: any) => c.name);
    return {
      l1: !!names.includes('mola-l1-regional-terrain'),
      rim: !!names.includes('mola-l1-window-rim'),
      boundary: !!names.includes('mola-l1-boundary-skirt'),
      cap: !!names.includes('mars-hole-cap'),
      collarRetired: !names.includes('jezero-collar'),
    };
  });
  console.log('[1] stack =', JSON.stringify(stack));

  // 标准下降流
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 0.8 });
  });
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site' || a.action === 'wait';
  }, { timeout: 30000, polling: 300 });
  const pre = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  if (pre.action === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4000));
  }
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', { timeout: 30000, polling: 300 });
  await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry().state);
    if (st === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 300000) throw new Error(`timeout at ${st}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2500));
  console.log('[2] touchdown');
  await glShot('touchdown');

  const enterLook = (lat: number, lon: number, eyeM: number, yaw: number, pitch: number) =>
    page.evaluate((la, lo, h, y, p) => {
      const e = (window as any).__solarEngine;
      e.cameraController.executeCommand({
        type: 'enterSurfaceLook', bodyId: 'mars', lat: la, lon: lo, eyeHeightM: h,
      });
      e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: y, pitchDeg: p });
    }, lat, lon, eyeM, yaw, pitch);
  const settled = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
    }, { timeout: 30000, polling: 200 });

  await enterLook(18.45145, 77.43657, 4000, 0, -55);
  await settled();
  await new Promise((r) => setTimeout(r, 500));
  await glShot('alt4km-down');

  await page.evaluate(() => {
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -12 });
  });
  await new Promise((r) => setTimeout(r, 600));
  await glShot('alt4km-oblique');

  await enterLook(18.45145, 77.43657, 300, 0, -50);
  await settled();
  await new Promise((r) => setTimeout(r, 500));
  await glShot('alt300m-down');

  await enterLook(18.45145, 77.46, 30, 0, 0);
  await settled();
  await new Promise((r) => setTimeout(r, 500));
  await glShot('l1-east-horizon');

  // 返轨
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 3500));
  const after = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return { availability: e.getLandingAvailability().action, fogCleared: !e.scene.fog };
  });
  console.log('[3] orbit =', JSON.stringify(after));
  await glShot('orbit-return');

  const errs = consoleLines.filter((l) => /^\[(error|warn)\]/i.test(l));
  console.log('[4] console err/warn:', errs.length ? errs.slice(0, 20).join(' | ') : '(none)');
  await browser.close();
  console.log('PROBE DONE');
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
