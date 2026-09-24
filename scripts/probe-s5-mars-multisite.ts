// S5-6 探针：火星多站（Victoria/Gale）下降流 + 遥测溯源断言 + GL 直读截图。
// 用法: npx tsx scripts/probe-s5-mars-multisite.ts vic|gale
// 前提: vite dev server 在 5199 端口
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const SITES: Record<string, { id: string; lat: number; lon: number; sourceId: string }> = {
  vic: { id: 'victoria-duck-bay', lat: -2.061687, lon: 354.5, sourceId: 'victoria-hirise-v1' },
  gale: { id: 'gale-murray-buttes', lat: -4.944939, lon: 137.388307, sourceId: 'gale-hirise-v1' },
};
const site = SITES[process.argv[2] ?? ''];
if (!site) throw new Error('usage: npx tsx scripts/probe-s5-mars-multisite.ts vic|gale');

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
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${String(e).slice(0, 200)}`));
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // 1) jezero 默认栈就绪
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible, { timeout: 60000 });
  console.log('[1] jezero default stack visible');

  // 2) 相机移至目标站天顶：select 不移动相机——先普通 flyTo mars 建立火星锚点
  //（exact targetPos 的偏移按当前锚点解释），再精确飞站顶
  await page.evaluate(`(() => {
    const e = window.__solarEngine;
    e.executeCameraCommand({ type: 'select', bodyId: 'mars' });
    e.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 1.2 });
  })()`);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(`((lat, lon) => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const pose = e.getBodyWorldPose('mars');
    const dir = new THREE.Vector3(
      Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180),
      Math.sin(lat * Math.PI / 180),
      -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)
    ).applyQuaternion(pose.quaternion).normalize();
    const dist = pose.surfaceRadius * 2.9;
    const target = pose.pos.clone().addScaledVector(dir, dist);
    e.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 1.4, targetPos: [target.x, target.y, target.z], exact: true });
  })(${site.lat}, ${site.lon})`);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 45000, polling: 300 });
  await new Promise((r) => setTimeout(r, 800));

  // 3) 可用性解析：多站点按星下点最近取站
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site' || a.action === 'wait';
  }, { timeout: 60000, polling: 400 });
  let avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[2] at mars (site zenith), availability =', JSON.stringify(avail));
  if (avail.siteId !== site.id) throw new Error(`站点解析错误: ${avail.siteId} ≠ ${site.id}`);
  if (avail.action === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4200));
  }
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 60000, polling: 400,
  });
  // 懒装载由可用性解析触发——等本站栈构建完成
  await page.waitForFunction((sid: string) => {
    const e = (window as any).__solarEngine;
    const marsMesh = e.getMarsTerrainMesh?.()?.parent?.parent;
    return !!marsMesh?.getObjectByName?.(sid + '-terrain')?.visible;
  }, { timeout: 120000, polling: 500 }, site.id);
  console.log('[3] site stack built & visible');

  // 4) 三级栈断言（本站 group 内）
  const stack = await page.evaluate((sid: string) => {
    const e = (window as any).__solarEngine;
    const group = e.getMarsTerrainMesh().parent.parent.getObjectByName(`mars-site-${sid}`);
    const names = group.children.map((c: any) => c.name);
    return {
      visible: group.visible,
      terrain: !!names.includes(`${sid}-terrain`),
      l1: !!names.includes('mola-l1-regional-terrain'),
      rim: !!names.includes('mola-l1-window-rim'),
      boundary: !!names.includes('mola-l1-boundary-skirt'),
      cap: !!names.includes('mars-hole-cap'),
      rockfield: group.children.some((c: any) => c.name === 'procedural-rockfield-mars'),
      collarRetired: !names.includes(`${sid}-collar`),
    };
  }, site.id);
  console.log('[4] stack =', JSON.stringify(stack));

  // 5) 标准下降流
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  if (!started) throw new Error('startLunarLanding rejected');
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry().state);
    if (st === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 300000) throw new Error(`descent timeout at ${st}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2500));

  // 6) 遥测溯源断言（siteId/sourceId/实测保真/如实的准入态）
  const tele = await page.evaluate(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return {
      state: t.state, siteId: t.site.id, agl: t.altitudeAGLM, lat: t.currentLat, lon: t.currentLon,
      fidelity: t.terrain.fidelity, sourceId: t.terrain.sourceId, admission: t.terrain.admissionState,
    };
  });
  console.log('[5] touchdown telemetry =', JSON.stringify(tele));
  if (tele.siteId !== site.id) throw new Error(`遥测站点错误: ${tele.siteId}`);
  if (tele.sourceId !== site.sourceId) throw new Error(`遥测溯源错误: ${tele.sourceId} ≠ ${site.sourceId}`);
  if (tele.fidelity !== 'measured-dem') throw new Error(`保真度错误: ${tele.fidelity}`);

  // 7) GL 直读截图 + 像素诊断
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
      fs.writeFileSync(`${OUT}/s5-mars-${process.argv[2]}-${name}.png`, Buffer.from(r.b64.split(',')[1], 'base64'));
      console.log(`[gl-shot] ${name}`, JSON.stringify(r.diag));
    });
  await glShot('touchdown');

  // 低空视角（正射纹理细节）
  await page.evaluate((la: number, lo: number) => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'mars', lat: la, lon: lo, eyeHeightM: 60,
    });
    e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 25, pitchDeg: -18 });
  }, site.lat, site.lon);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
  }, { timeout: 30000, polling: 200 });
  await new Promise((r) => setTimeout(r, 600));
  await glShot('alt60m-oblique');

  // 中空俯瞰（三级栈 LOD 接缝：DTM 窗 + 饱和度裙圈 + L1）
  await page.evaluate((la: number, lo: number) => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'mars', lat: la, lon: lo, eyeHeightM: 6000,
    });
    e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -55 });
  }, site.lat, site.lon);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
  }, { timeout: 30000, polling: 200 });
  await new Promise((r) => setTimeout(r, 800));
  await glShot('alt6km-down');

  // 8) 返轨（状态机回 ORBIT，尘雾清除）
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 3500));
  const after = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return { availability: e.getLandingAvailability().action, fogCleared: !e.scene.fog };
  });
  console.log('[6] orbit-return =', JSON.stringify(after));

  const errs = consoleLines.filter((l) => /^\[(error|pageerror)\]/i.test(l));
  console.log('[7] console errors:', errs.length ? errs.slice(0, 10).join(' | ') : '(none)');
  await browser.close();
  console.log('PROBE DONE');
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
