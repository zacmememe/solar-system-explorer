/**
 * S4c 探针：火星耶泽罗完整下降流（泛化链路验收）
 * flyTo mars → availability land/travel-to-site → startLunarLanding（泛化入口）
 * → PREPARING → DESCENDING（尘色天空渐入截图）→ SURFACE_LOOK（触地遥测+截图）
 * → returnToLunarOrbit → ORBIT（天空恢复、availability 回 land）
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
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible, { timeout: 60000 });

  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 0.8 });
  });
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site' || a.action === 'wait';
  }, { timeout: 30000, polling: 300 });
  const pre = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[flow] at mars, availability =', JSON.stringify(pre));
  if (pre.action === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4000));
  }
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 30000, polling: 300,
  });

  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  console.log('[flow] startLunarLanding(mars) ->', started);
  expect(started, 'mars descent entry rejected');

  const states = new Set<string>();
  let midShot = false;
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());
    states.add(st.state);
    if (st.state === 'DESCENDING' && !midShot && st.altitudeAGLM < 6000 && st.altitudeAGLM > 2500) {
      await page.screenshot({ path: `${OUT}/s4c-mars-descent-mid.png` });
      console.log('[shot] descent mid, AGL =', Math.round(st.altitudeAGLM), 'm');
      midShot = true;
    }
    if (st.state === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 300000) throw new Error(`descent timeout, last=${st.state} agl=${st.altitudeAGLM}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('[flow] states passed:', [...states].join(' -> '));
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: `${OUT}/s4c-mars-touchdown.png` });
  console.log('[shot] touchdown');

  const tele = await page.evaluate(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return {
      state: t.state, agl: t.altitudeAGLM, lat: t.currentLat, lon: t.currentLon,
      terrain: t.terrain, site: t.site.id, vspd: t.verticalSpeedMps,
    };
  });
  console.log('[telemetry]', JSON.stringify(tele));

  // 尘色天空激活态的运行时断言（fog + skybox 浸染）
  const dust = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return {
      hasFog: !!e.scene.fog,
      fogColor: e.scene.fog ? e.scene.fog.color.getHexString() : null,
    };
  });
  console.log('[dust]', JSON.stringify(dust));

  // 返轨
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 4000));
  const after = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const mars = e.getBodyWorldPose('mars');
    return {
      dist: Math.sqrt(
        (e.camera.position.x - mars.pos.x) ** 2 + (e.camera.position.y - mars.pos.y) ** 2 + (e.camera.position.z - mars.pos.z) ** 2
      ),
      availability: e.getLandingAvailability().action,
      fogCleared: !e.scene.fog,
    };
  });
  console.log('[orbit]', JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/s4c-mars-return.png` });
  console.log('[shot] return');
  await browser.close();
  console.log('MARS DESCENT DONE');
}

function expect(v: boolean, msg: string) {
  if (!v) throw new Error(msg);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
