// R3（260925 基础体验恢复·第三批）：太阳可见性 + 相机构图半径回归探针。
// 断言：
//  1) 物理观察残留（月面下降→返轨）后 flyTo sun——太阳可见且成为物理参考
//     （改前 star 无参考分支，太阳在物理模式恒隐藏 = "太阳消失"根因）
//  2) 物理模式（非太阳参考）下太阳按真实角尺寸渲染（scale×navRadius ≈
//     dist×tan(0.267°)，改前直接隐藏）
//  3) overview 从物理残留恢复 NAV（太阳回 NAV 形态）
//  4) flyTo 构图用实际 pose 半径（月面物理尺寸下 2.9R 取景；火卫小天体特写）
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleErrs: string[] = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${String(e).slice(0, 160)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  const flyTo = (b: string) =>
    page.evaluate((body: string) => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: body, durationSec: 1.0 });
    }, b);
  const settle = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return !s.isTransitioning;
    }, { timeout: 45000, polling: 300 });

  // ---- 1) 物理残留 → 前往太阳（核心修复链） ----
  await flyTo('moon');
  await settle();
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997, eyeHeightM: 1.7,
    });
  });
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  // 进入物理观察（下降流同款策略；书签恢复也用此公开入口）——太阳应从
  // NAV 放大形态切为真实角尺寸（0.267°），而非隐藏（改前行为）
  await page.evaluate(() => {
    (window as any).__solarEngine.setPresentationPolicy('PHYSICAL_OBSERVATION', 0.4);
  });
  await new Promise((r) => setTimeout(r, 2000));
  const td = await page.evaluate(() => {
    const p = (window as any).__solarEngine.bodyPoseProvider;
    return { target: p.targetPolicy, cur: p.currentPolicy, prog: p.getTransitionProgress() };
  });
  console.log('[1d] transition diag =', JSON.stringify(td));
  interface SurfState { policy: string; sunVisible: boolean; sunScale: number; camDist: number; expectedAngularScale: number }
  const surfaceState = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    return {
      policy: e.bodyPoseProvider ? e.bodyPoseProvider.getPolicy() : 'n/a',
      sunVisible: !!e.bodyNodes.get('sun').systemGroup.visible,
      sunScale: +e.bodyNodes.get('sun').systemGroup.scale.x.toFixed(6),
      camDist: +e.camera.position.length().toFixed(2),
      expectedAngularScale: +(e.camera.position.length() * Math.tan(Math.atan(696000 / 149597870)) / e.bodyNodes.get('sun').displayRadius).toFixed(6),
    };
  })()`)) as unknown as SurfState;
  console.log('[1] moon surface (physical) =', JSON.stringify(surfaceState));
  if (surfaceState.policy !== 'PHYSICAL_OBSERVATION') throw new Error(`策略未切换: ${surfaceState.policy}`);
  if (!surfaceState.sunVisible) throw new Error('物理模式（月面）太阳不可见——应按真实角尺寸渲染');
  // 角尺寸闭合（相对误差 15% 内）
  const ratio = surfaceState.sunScale / surfaceState.expectedAngularScale;
  if (ratio < 0.85 || ratio > 1.15) throw new Error(`太阳角尺寸不闭合: scale=${surfaceState.sunScale} expect=${surfaceState.expectedAngularScale}`);

  // 返轨 → 物理残留态 → 前往太阳
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 1500));
  await flyTo('sun');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  interface SunState { sunVisible: boolean; reference: string; maxLum: number; brightCells: number }
  const sunState = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    e.renderFrame();
    const r = e.renderer, gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let maxLum = 0, bright = 0;
    for (let ix = 0; ix < 24; ix++) for (let iy = 0; iy < 14; iy++) {
      const x = Math.floor((ix + 0.5) * W / 24), y = Math.floor((iy + 0.5) * H / 14);
      const i = (y * W + x) * 4;
      const l = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      if (l > maxLum) maxLum = l;
      if (l > 100) bright++;
    }
    return {
      sunVisible: !!e.bodyNodes.get('sun').systemGroup.visible,
      reference: e.bodyPoseProvider.getPhysicalReferenceBody(),
      maxLum: +maxLum.toFixed(1), brightCells: bright,
    };
  })()`)) as unknown as SunState;
  console.log('[2] physical→flyTo sun =', JSON.stringify(sunState));
  if (!sunState.sunVisible) throw new Error('物理残留后前往太阳仍不可见（star 参考分支失效）');
  if (sunState.reference !== 'sun') throw new Error(`物理参考未切太阳: ${sunState.reference}`);
  if (sunState.maxLum < 100 || sunState.brightCells < 1) throw new Error(`太阳画面缺失: maxLum=${sunState.maxLum}`);

  // ---- 2) overview 恢复 NAV ----
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'overview', durationSec: 1.0 });
  });
  await settle();
  await new Promise((r) => setTimeout(r, 600));
  interface OvState { policy: string; sunVisible: boolean }
  const ov = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    return { policy: e.bodyPoseProvider.getPolicy(), sunVisible: !!e.bodyNodes.get('sun').systemGroup.visible };
  })()`)) as unknown as OvState;
  console.log('[3] overview =', JSON.stringify(ov));
  if (ov.policy !== 'NAV_SCHEMATIC') throw new Error(`overview 未恢复 NAV: ${ov.policy}`);
  if (!ov.sunVisible) throw new Error('overview 后太阳不可见');

  // ---- 3) 相机构图半径（实际 pose）：月面物理尺寸下的取景 + 火卫特写 ----
  await flyTo('moon');
  await settle();
  interface FrameState { distOverR: number; policy?: string }
  const moonFrame = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const pose = e.getBodyWorldPose('moon');
    const cam = e.camera.position;
    return {
      distOverR: +(cam.distanceTo(pose.pos) / pose.surfaceRadius).toFixed(2),
      policy: e.bodyPoseProvider.getPolicy(),
    };
  })()`)) as unknown as FrameState;
  console.log('[4] moon frame =', JSON.stringify(moonFrame));
  if (moonFrame.distOverR < 1.5 || moonFrame.distOverR > 6) throw new Error(`月面取景距离失真: ${moonFrame.distOverR}R`);

  await flyTo('phobos');
  await settle();
  await new Promise((r) => setTimeout(r, 600));
  const phobos = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const pose = e.getBodyWorldPose('phobos');
    const cam = e.camera.position;
    const px = e.renderer.getContext();
    return { distOverR: +(cam.distanceTo(pose.pos) / pose.surfaceRadius).toFixed(2) };
  })()`)) as unknown as FrameState;
  console.log('[5] phobos frame =', JSON.stringify(phobos));
  if (phobos.distOverR < 1.5 || phobos.distOverR > 6) throw new Error(`火卫特写距离失真: ${phobos.distOverR}R`);

  console.log('[errors]', consoleErrs.length ? consoleErrs.slice(0, 8).join(' | ') : '(none)');
  await browser.close();
  console.log('R3 PROBE DONE');
}

main().catch((e) => { console.error('R3 PROBE FAILED:', e); process.exit(1); });
