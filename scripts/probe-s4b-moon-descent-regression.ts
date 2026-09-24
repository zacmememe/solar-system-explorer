/**
 * S4b 回归探针：月面完整下降流（本轮改动共享路径：initiateFlight spherical 同步、
 * 碎石 metricScale、ensureLandingLighting 泛化签名）。走真实入口：
 * flyTo moon → startLunarLanding → SURFACE_LOOK → returnToLunarOrbit → ORBIT。
 */
import puppeteer from 'puppeteer-core';

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
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getLunarValleyMesh?.()?.visible, { timeout: 60000 });

  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 0.8 });
  });
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });

  // S5-3：月面双站后按相机半球解析——本探针回归 taurus，先飞至其站顶再判定
  await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const pose = e.getBodyWorldPose('moon');
    const dir = new THREE.Vector3(
      Math.cos(20.2108 * Math.PI / 180) * Math.cos(30.7997 * Math.PI / 180),
      Math.sin(20.2108 * Math.PI / 180),
      -Math.cos(20.2108 * Math.PI / 180) * Math.sin(30.7997 * Math.PI / 180)
    ).applyQuaternion(pose.quaternion).normalize();
    const target = pose.pos.clone().addScaledVector(dir, pose.surfaceRadius * 2.9);
    e.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.4, targetPos: [target.x, target.y, target.z], exact: true });
  })()`);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site';
  }, { timeout: 30000, polling: 300 });
  const siteCheck = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability().siteId);
  if (siteCheck !== 'taurus-littrow') throw new Error(`站点解析非 taurus: ${siteCheck}`);

  // 落区若在背面先前往
  const pre = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  if (pre.action === 'travel-to-site') {
    console.log('[flow] far side → travel to site');
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4000));
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
      timeout: 30000, polling: 300,
    });
  }
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  console.log('[flow] startLunarLanding ->', started);

  const states = new Set<string>();
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry().state);
    states.add(st);
    if (st === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 240000) throw new Error(`descent timeout, last=${st}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('[flow] states passed:', [...states].join(' -> '));
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/s4b-moon-descent-touchdown.png` });
  console.log('[shot] touchdown');

  const tele = await page.evaluate(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return { state: t.state, site: t.site.id, agl: t.altitudeAGLM, lat: t.currentLat, lon: t.currentLon, terrain: t.terrain?.fidelity, sourceId: t.terrain?.sourceId };
  });
  console.log('[telemetry]', JSON.stringify(tele));

  // 返轨（ASCENDING → ORBIT + flyTo 退出 SURFACE_LOOK——本轮 spherical 同步改动点）
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 3500));
  const snap = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const moon = e.getBodyWorldPose('moon');
    return {
      camMode: e.cameraController ? undefined : undefined,
      distToMoon: Math.sqrt(
        (e.camera.position.x - moon.pos.x) ** 2 + (e.camera.position.y - moon.pos.y) ** 2 + (e.camera.position.z - moon.pos.z) ** 2
      ),
      moonRadius: moon.surfaceRadius,
      availability: e.getLandingAvailability().action,
    };
  });
  console.log('[orbit]', JSON.stringify(snap));
  await page.screenshot({ path: `${OUT}/s4b-moon-descent-return.png` });
  console.log('[shot] return');
  await browser.close();
  console.log('DESCENT REGRESSION DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
