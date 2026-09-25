// 判别实验：触地→SURFACE_LOOK 切换是否长期卡死页面主线程。
// 期间定期截图（走合成器，不依赖页面 JS），达成后测试 evaluate 响应。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/fsurface-blend/touch-probe';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    protocolTimeout: 600000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (/error|fail|lost/i.test(t)) console.log('[console]', t.slice(0, 200)); });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 120000, polling: 400 });
  await new Promise((r) => setTimeout(r, 800));
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await page.waitForFunction(() => {
    const st = (window as any).__solarEngine.moonSiteStacks.get('tranquility-base');
    return !!(st && st.built);
  }, { timeout: 60000, polling: 500 });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 60000, polling: 500,
  });
  await page.click('[data-testid="lunar-landing-start-btn"]');
  console.log('descent started, waiting SURFACE_LOOK...');

  const t0 = Date.now();
  let shotN = 0;
  // 期间每 45s 截一张
  const shotTimer = setInterval(() => {
    shotN += 1;
    const el = Math.round((Date.now() - t0) / 1000);
    page.screenshot({ path: `${OUT}/touch-${String(shotN).padStart(2, '0')}-${el}s.png` }).catch(() => {});
    console.log(`[shot] ${shotN} at ${el}s`);
  }, 45000);

  try {
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
      timeout: 11 * 60 * 1000, polling: 2000,
    });
    console.log(`SURFACE_LOOK reached at ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    console.log('SURFACE_LOOK wait failed:', String(e).slice(0, 120));
  }
  clearInterval(shotTimer);
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/surface-look-final.png` });
  const evT0 = Date.now();
  try {
    const s = await page.evaluate(`(() => {
      const e = window.__solarEngine;
      const tel = e.getLandingTelemetry();
      const st = e.moonSiteStacks.get('tranquility-base');
      return { state: tel.state, aglM: Math.round(tel.altitudeAGLM),
        valleyMatType: st.valleyMaterial ? st.valleyMaterial.type : null,
        l1MatType: st.lolaMaterials[0] ? st.lolaMaterials[0].type : null };
    })()`);
    console.log('evaluate ok in', Date.now() - evT0, 'ms:', JSON.stringify(s));
  } catch (e) {
    console.log('evaluate FAILED after', Date.now() - evT0, 'ms:', String(e).slice(0, 120));
  }
  await browser.close();
  console.log('TOUCH PROBE DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
