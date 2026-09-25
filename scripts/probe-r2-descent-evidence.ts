// R2 取证探针（生产构建）：正常 UI 连续下降，覆盖 DTM/L1 渐显 0→1 全区间与
// 挖孔补片交接，触地环顾、返轨。只读引擎状态取证（不改相机/控制器）。
// 阈值跨越时连拍前后帧；输出 JSONL 时间线 + 事件截图。
// SITE=taurus-littrow|tranquility-base|jezero  BODY=moon|mars
// 截图/时间线存 D:\solar-evidence\r1r2-bdac3bc\r2\<site>\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE = process.env.SITE || 'taurus-littrow';
const BODY = process.env.BODY || 'moon';
const OUT = `D:/solar-evidence/r1r2-bdac3bc/r2/${SITE}`;

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
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  const readStack = (): Promise<any> => page.evaluate(`(() => {
    const e = window.__solarEngine;
    const stack = ${BODY === 'moon' ? `e.moonSiteStacks.get('${SITE}')` : `e.marsSiteStacks.get('${SITE}')`};
    if (!stack) return null;
    const dtmMat = stack.valleyMaterial || stack.terrainMaterial;
    const l1Mat = (${BODY === 'moon' ? 'stack.lolaMaterials' : 'stack.l1Materials'}) || [];
    return {
      state: e.getLandingTelemetry().state,
      aglM: Math.round(e.getLandingTelemetry().altitudeAGLM),
      dtmOpacity: dtmMat ? +dtmMat.opacity.toFixed(4) : null,
      l1Opacity: l1Mat.length ? +l1Mat[0].opacity.toFixed(4) : null,
      patchVisible: !!(stack.patchMesh && stack.patchMesh.visible),
      built: !!stack.built,
    };
  })()`);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  // 目标天体
  await clickId(BODY === 'moon' ? 'moon-btn-moon' : 'planet-btn-mars');
  await page.waitForFunction((bid: string) => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === bid && !s.isTransitioning;
  }, { timeout: 90000, polling: 300 }, BODY);
  await new Promise((r) => setTimeout(r, 800));

  // 选站（底部 HUD 行内原生 select）
  await page.waitForFunction((site: string) => {
    const sel = document.querySelector('[data-testid="hud-landing-row"] select');
    return !!sel && Array.from((sel as HTMLSelectElement).options).some((o) => o.value === site);
  }, { timeout: 30000, polling: 300 }, SITE);
  await page.select('[data-testid="landing-site-select"]', SITE);
  await new Promise((r) => setTimeout(r, 1000));
  const avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log(`[${SITE}] availability=`, JSON.stringify(avail));
  if (avail.action === 'travel-to-site') await clickId('lunar-landing-travel-site-btn');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 180000, polling: 800,
  });
  await new Promise((r) => setTimeout(r, 800));

  // 启动降落（行内按钮），进入连续下降
  await clickId('lunar-landing-start-btn');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 180000, polling: 500,
  });
  console.log(`[${SITE}] descent started`);
  await shot('00-descent-start');

  // 连续采样：每 400ms；阈值/翻转事件触发前后帧截图
  const events = new Set<string>();
  const timeline: string[] = [];
  const t0 = Date.now();
  let prev: any = null;
  let shotIdx = 0;
  const grab = async (label: string) => {
    shotIdx += 1;
    await shot(`${String(shotIdx).padStart(2, '0')}-ev-${label}`);
  };
  while (Date.now() - t0 < 12 * 60 * 1000) {
    const s = await readStack();
    if (!s) break;
    const tMs = Date.now() - t0;
    timeline.push(JSON.stringify({ tMs, ...s }));
    const cross = (key: string, v: number | null, threshold: number, dir: 'up' | 'down') => {
      if (v == null || prev == null) return false;
      const a = prev[key] as number | null;
      if (a == null) return false;
      return dir === 'up' ? a < threshold && v >= threshold : a >= threshold && v < threshold;
    };
    if (!events.has('l1-up-05') && cross('l1Opacity', s.l1Opacity, 0.05, 'up')) { events.add('l1-up-05'); await grab('l1-005'); }
    if (!events.has('l1-up-095') && cross('l1Opacity', s.l1Opacity, 0.95, 'up')) { events.add('l1-up-095'); await grab('l1-095'); }
    if (!events.has('dtm-up-05') && cross('dtmOpacity', s.dtmOpacity, 0.05, 'up')) { events.add('dtm-up-05'); await grab('dtm-005'); }
    if (!events.has('dtm-up-095') && cross('dtmOpacity', s.dtmOpacity, 0.95, 'up')) { events.add('dtm-up-095'); await grab('dtm-095'); }
    if (!events.has('patch-off') && prev && prev.patchVisible && !s.patchVisible) { events.add('patch-off'); await grab('patch-off'); }
    if (!events.has('agl-200km') && prev && prev.aglM > 200000 && s.aglM <= 200000) { events.add('agl-200km'); await grab('agl-200km'); }
    if (!events.has('agl-50km') && prev && prev.aglM > 50000 && s.aglM <= 50000) { events.add('agl-50km'); await grab('agl-50km'); }
    prev = s;
    if (s.state === 'SURFACE_LOOK') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  fs.writeFileSync(path.join(OUT, 'timeline-descent.jsonl'), timeline.join('\n'));
  console.log(`[${SITE}] touchdown state=${prev?.state} events=${[...events].join(',')}`);

  // 触地环顾（SURFACE_LOOK 设计交互）+ 停驻态补片/材质状态
  await new Promise((r) => setTimeout(r, 1000));
  await shot('90-surface-look-start');
  await page.mouse.move(700, 430);
  await page.mouse.down();
  await page.mouse.move(520, 470, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
  await shot('91-surface-look-left');
  const surfaceState = await readStack();
  console.log(`[${SITE}] surface=`, JSON.stringify(surfaceState));

  // 返轨（HUD 按钮）
  await clickId('landing-btn-return-orbit');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.mode === 'ORBIT_TARGET' && !s.isTransitioning;
  }, { timeout: 240000, polling: 800 });
  await new Promise((r) => setTimeout(r, 800));
  await shot('92-return-orbit');
  const orbitState = await readStack();
  console.log(`[${SITE}] orbit=`, JSON.stringify(orbitState));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ site: SITE, body: BODY, surfaceState, orbitState, events: [...events] }, null, 2));

  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log(`R2 ${SITE} DONE`);
}

main().catch((e) => { console.error(`R2 ${SITE} FAILED:`, e); process.exit(1); });
