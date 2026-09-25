// F-SURFACE-CLARITY-01 诊断探针（只读）：Taurus 站清晰度与 LOD 接缝取证。
// 全部通过正常 UI 入口（站点下拉/着陆按钮）进入；引擎访问仅读取诊断与
// setSurfaceLook 环顾（runner 同款）。输出：
//  1) 活动网格/纹理实测参数（顶点数、段数、纹理尺寸、过滤、GSD）
//  2) 多眼高纹素屏幕占比（物理上限论证）
//  3) DTM 窗缘接缝机位截图（NAC 正射→rim 裙圈→LOLA L1 三带同框）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/F-SURFACE-CLARITY-01/diag';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  // ---- 正常 UI：天体按钮 → 站点下拉选择 taurus → 前往 → 着陆（runner 同款）----
  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  await clickId('planet-btn-earth'); // 先回地球侧让月球按钮可达（runner 同序）
  await new Promise((r) => setTimeout(r, 600));
  await clickId('moon-btn-moon');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 400));
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'taurus-littrow');
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.siteId === 'taurus-littrow' && ['land', 'travel-to-site'].includes(a.action);
  }, { timeout: 60000, polling: 400 });
  await new Promise((r) => setTimeout(r, 400));
  if (await page.$('[data-testid="lunar-landing-travel-site-btn"]')) {
    await clickId('lunar-landing-travel-site-btn');
  }
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });
  await clickId('lunar-landing-start-btn');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
    timeout: 300000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 2500));

  // ---- 1) 活动网格/纹理实测 ----
  const active = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const stack = e.moonSiteStacks.get('taurus-littrow');
    const vm = stack.valleyMesh;
    const geo = vm.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const mat = vm.material;
    const map = mat.map;
    const l1 = e.getMoonMesh().getObjectByName('lola-l1-regional-terrain');
    const rim = e.getMoonMesh().getObjectByName('lola-l1-window-rim');
    const meta = stack.raster.metaReady;
    const site = { lat: 20.2108, lon: 30.7997 };
    return {
      dtmVertices: pos.count,
      dtmTriangles: geo.getIndex() ? geo.getIndex().count / 3 : null,
      uvRange: [uv.minX !== undefined ? uv.minX : null],
      orthoTexSize: map ? map.image.width + 'x' + map.image.height : null,
      minFilter: map ? map.minFilter : null,
      magFilter: map ? map.magFilter : null,
      anisotropy: map ? map.anisotropy : null,
      generateMipmaps: map ? map.generateMipmaps : null,
      matTransparent: mat.transparent,
      matOpacity: mat.opacity,
      demGrid: meta ? meta.width + 'x' + meta.height : null,
      demStepM: meta ? meta.stepMeters ?? meta.nativeSpacingMeters : null,
      l1Vertices: l1 ? l1.geometry.getAttribute('position').count : null,
      rimVertices: rim ? rim.geometry.getAttribute('position').count : null,
      rockCount: (stack.group.children.find(c => c.name === 'procedural-rockfield') || {count:0}).count ?? null,
    };
  })()`);
  console.log('[1] active stack =', JSON.stringify(active));

  // ---- 2) 多眼高：纹素屏幕占比（实测：3m 前方地面两点屏幕距离）----
  const heights = [1.7, 5, 20, 100, 500, 3000];
  const gsd = await page.evaluate(`(async (hs) => {
    const e = window.__solarEngine;
    const out = [];
    for (const eyeM of hs) {
      e.cameraController.executeCommand({ type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997, eyeHeightM: eyeM });
      e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -30 });
      await new Promise((r) => setTimeout(r, 900));
      const THREE = window.THREE;
      const cam = e.camera;
      // 地面点：沿视线前方落点与右移 5m 的点，投影到屏幕求像素间距
      const pose = e.getBodyWorldPose('moon');
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const camPos = cam.position.clone();
      // 站点世界位置与半径
      const siteDirW = new THREE.Vector3(
        Math.cos(20.2108 * Math.PI / 180) * Math.cos(30.7997 * Math.PI / 180),
        Math.sin(20.2108 * Math.PI / 180),
        -Math.cos(20.2108 * Math.PI / 180) * Math.sin(30.7997 * Math.PI / 180)
      ).applyQuaternion(pose.quaternion);
      const R = pose.surfaceRadius;
      const surfacePoint = pose.pos.clone().addScaledVector(siteDirW, R);
      // 相机到落点距离的眼高近似：直接用地面点对（表面切平面内）
      const eastW = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), siteDirW).normalize();
      const p1 = surfacePoint.clone();
      const p2 = surfacePoint.clone().addScaledVector(eastW, 5); // 5m 地面间隔
      const pr1 = p1.clone().project(cam);
      const pr2 = p2.clone().project(cam);
      const dxPx = (pr2.x - pr1.x) * window.innerWidth / 2;
      const dyPx = (pr2.y - pr1.y) * window.innerHeight / 2;
      const pxPer5m = Math.hypot(dxPx, dyPx);
      out.push({ eyeM, pxPer5m: +pxPer5m.toFixed(1), pxPerMeter: +(pxPer5m / 5).toFixed(1),
                 screenPxPerTexel5m: +(pxPer5m / 1).toFixed(1) /* 5m 纹素=1 纹素 */ });
    }
    return out;
  })(${JSON.stringify(heights)})`);
  console.log('[2] texel screen coverage =', JSON.stringify(gsd));

  // ---- 3) 接缝机位：DTM 窗缘（站北 6km）上空看三带 ----
  // 窗缘纬度：+6km / 30341m每度 ≈ +0.198°
  const seamLat = 20.2108 + 6000 / (1737400 * Math.PI / 180);
  await page.evaluate((la: number) => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: la, lon: 30.7997, eyeHeightM: 400,
    });
    e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 180, pitchDeg: -18 });
  }, seamLat);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT, 'seam-north-edge-from-inside.png') });
  // 窗外视角（缝北侧上空朝南看：L1→rim→NAC）
  await page.evaluate((la: number) => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: la + 6000 / (1737400 * Math.PI / 180) / 2, lon: 30.7997, eyeHeightM: 900,
    });
    e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -25 });
  }, seamLat);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'seam-north-edge-from-outside.png') });

  // 回站心触地 + 环顾两向（清晰度取证：正射细节）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997, eyeHeightM: 1.7,
    });
    e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -12 });
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, 'ground-1m7-lookdown.png') });
  await page.evaluate(() => {
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 90, pitchDeg: -4 });
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(OUT, 'ground-1m7-horizon.png') });
  // 渐显门控与材质最终态
  const final = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const stack = e.moonSiteStacks.get('taurus-littrow');
    const vm = stack.valleyMesh;
    return { matOpacity: vm.material.opacity, transparent: vm.material.transparent,
             texelPxGate: e.regionalAlbedo ? e.regionalAlbedo.lastGateDiagnostics : null,
             renderInfo: e.lastFrameRenderInfo };
  })()`);
  console.log('[3] final material =', JSON.stringify(final));
  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log('FSC01 DIAG DONE');
}

main().catch((e) => { console.error('FSC01 DIAG FAILED:', e); process.exit(1); });
