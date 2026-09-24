/**
 * S5-1 探针：MOLA L1 中间层接入火星（耶泽罗）
 * 1) 断言 L1 网格族挂载（regional/boundary-skirt/window-rim/cap）且 collar 退役；
 * 2) 走 S4c 标准下降流到触地（新 L1 栈下下降流回归：PREPARING→DESCENDING→
 *    SURFACE_LOOK、AGL≈1.7m、measured-dem、尘色雾激活）；
 * 3) 触地后自定义取景：中空 4km 俯视/斜视 + 300m 俯视（DTM→L1 LOD 接缝与
 *    灰→彩饱和度渐变）+ L1 区眼高平视（DTM 窗外 2km 的 MOLA 地平圈）；
 * 4) 返轨（ORBIT、雾清除、availability 回 land/travel-to-site）。
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
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${String(e).slice(0, 250)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // DTM + L1 就绪
  await page.waitForFunction(
    () => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible,
    { timeout: 60000 }
  );
  const stack = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const marsMesh = e.getMarsTerrainMesh().parent; // 行星网格
    const names = marsMesh.children.map((c: any) => c.name);
    return {
      names,
      l1: !!names.includes('mola-l1-regional-terrain'),
      boundarySkirt: !!names.includes('mola-l1-boundary-skirt'),
      windowRim: !!names.includes('mola-l1-window-rim'),
      cap: !!names.includes('mars-hole-cap'),
      collarRetired: !names.includes('jezero-collar'),
    };
  });
  console.log('[1] mars surface stack =', JSON.stringify(stack));
  if (!(stack.l1 && stack.boundarySkirt && stack.windowRim && stack.cap && stack.collarRetired)) {
    throw new Error(`L1 栈不完整: ${JSON.stringify(stack)}`);
  }

  // 2) S4c 标准下降流（在新 L1 栈下回归）
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 0.8 });
  });
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site' || a.action === 'wait';
  }, { timeout: 30000, polling: 300 });
  const pre = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[2] at mars, availability =', JSON.stringify(pre));
  if (pre.action === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4000));
  }
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 30000, polling: 300,
  });
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  if (!started) throw new Error('mars descent entry rejected');
  const states = new Set<string>();
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());
    states.add(st.state);
    if (st.state === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 300000) throw new Error(`descent timeout, last=${st.state}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('[3] descent states:', [...states].join(' -> '));
  await new Promise((r) => setTimeout(r, 3000));
  const tele = await page.evaluate(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return {
      state: t.state, agl: t.altitudeAGLM, terrain: t.terrain, site: t.site.id,
      fog: (window as any).__solarEngine.scene.fog?.color?.getHexString() ?? null,
    };
  });
  console.log('[4] touchdown telemetry =', JSON.stringify(tele));

  const shot = async (name: string) => {
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${OUT}/s5-l1-${name}.png` });
    console.log(`[shot] ${name}`);
  };
  await shot('touchdown');

  // 3) 自定义取景（框架/光照已由下降流就位）
  const waitSurfaceSettled = () =>
    page.waitForFunction(() => {
      const e = (window as any).__solarEngine;
      const s = e.cameraController.getSnapshot();
      return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
    }, { timeout: 30000, polling: 200 });
  const enterLook = (lat: number, lon: number, eyeM: number, yaw: number, pitch: number) =>
    page.evaluate((la, lo, h, y, p) => {
      const e = (window as any).__solarEngine;
      e.cameraController.executeCommand({
        type: 'enterSurfaceLook', bodyId: 'mars', lat: la, lon: lo, eyeHeightM: h,
      });
      e.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: y, pitchDeg: p });
    }, lat, lon, eyeM, yaw, pitch);

  // 中空 4km：DTM 窗（灰）→ 裙圈渐变 → L1（彩色 2K 披 MOLA 地形）
  await enterLook(18.45145, 77.43657, 4000, 0, -55);
  await waitSurfaceSettled();
  await shot('alt4km-down');
  await page.evaluate(() => {
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -12 });
  });
  await shot('alt4km-oblique');

  // 近中空 300m：接缝近景（裙圈内缘灰→外缘彩）
  await enterLook(18.45145, 77.43657, 300, 0, -50);
  await waitSurfaceSettled();
  await shot('alt300m-down');

  // L1 区眼高（站点东 ~2.2km——DTM 窗外、L1 网格上）：平视 MOLA 地平圈
  await enterLook(18.45145, 77.46, 30, 0, 0);
  await waitSurfaceSettled();
  await shot('l1-east-2km-horizon');

  // 4) 返轨（canonical）
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 4000));
  const after = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return {
      availability: e.getLandingAvailability().action,
      fogCleared: !e.scene.fog,
    };
  });
  console.log('[5] return to orbit =', JSON.stringify(after));

  const warns = consoleLines.filter((l) => /MOLA|L1|megdr|mola/i.test(l) && /warn|error/i.test(l));
  console.log('[6] MOLA 相关告警:', warns.length ? warns.join(' | ') : '(none)');
  const errs = consoleLines.filter((l) => /^\[(error|pageerror)\]/i.test(l));
  console.log('[7] 全部错误（未过滤）:', errs.length ? '\n' + errs.slice(0, 40).join('\n') : '(none)');

  await browser.close();
  console.log('PROBE DONE');
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
