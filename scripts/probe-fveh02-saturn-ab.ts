// F-VEHICLE-FOREGROUND-01 A/B 单场景：土星+ISS 伴飞截图（用于判定载具暗剪影是否为本改动引入）
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.env.OUT_DIR || 'D:/solar-evidence/F-VEHICLE-FOREGROUND-01';
const NAME = process.env.SHOT_NAME || 'ab-saturn';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  await clickId('planet-btn-saturn');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'saturn' && !s.isTransitioning;
  }, { timeout: 60000, polling: 300 });
  await new Promise((r) => setTimeout(r, 600));
  await clickId('toolbar-hangar-btn');
  await page.waitForSelector('[data-testid="hangar-board-btn"]', { timeout: 30000 });
  await page.click('[data-testid="hangar-board-btn"]');
  await page.waitForFunction(() => !!(window as any).__solarEngine.getCurrentVehicle(), { timeout: 60000, polling: 500 });
  if (await page.$('[data-testid="hangar-close-btn"]')) await clickId('hangar-close-btn');
  await page.waitForFunction((t: string) => {
    const root = document.querySelector('#hud-observe-panel');
    if (!root) {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
      return false;
    }
    const target = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t));
    if (target && target.getAttribute('aria-pressed') !== 'true') (target as HTMLButtonElement).click();
    return target?.getAttribute('aria-pressed') === 'true';
  }, { timeout: 20000, polling: 300 }, '伴飞');
  await new Promise((r) => setTimeout(r, 1500));
  const diag = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const lights = [];
    e.scene.traverse((o) => { if (o.isLight) lights.push(o.type + ':' + (o.name || 'unnamed')); });
    return { mode: e.getViewCameraMode(), vehicle: e.getCurrentVehicle(), pass: e.lastFrameRenderInfo.vehicleDisplayPass, lights };
  })()`);
  console.log(`[${NAME}]`, JSON.stringify(diag));
  await page.screenshot({ path: path.join(OUT, `${NAME}.png`) });
  await browser.close();
  console.log('AB DONE');
}

main().catch((e) => { console.error('AB FAILED:', e); process.exit(1); });
