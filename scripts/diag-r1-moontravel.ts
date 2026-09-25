// R1 诊断 v2：完全复刻 R1 流程（登舰 ISS→伴飞→月球），逐步打印快照与控制台
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url().slice(0, 120)); });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  console.log('[boot] ready');

  await page.waitForSelector('[data-testid="toolbar-hangar-btn"]', { timeout: 15000 });
  await page.click('[data-testid="toolbar-hangar-btn"]');
  await page.waitForSelector('[data-testid="hangar-board-btn"]', { timeout: 15000 });
  await page.click('[data-testid="hangar-board-btn"]');
  await page.waitForFunction(() => !!(window as any).__solarEngine.getCurrentVehicle(), { timeout: 60000, polling: 500 });
  console.log('[board] iss boarded');
  const closeBtn = await page.$('[data-testid="hangar-close-btn"]');
  if (closeBtn) { await closeBtn.click(); console.log('[board] hangar closed'); }
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
    if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const root = document.querySelector('#hud-observe-panel');
    const btn = root ? Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes('伴飞')) as HTMLButtonElement : undefined;
    if (btn) btn.click(); else console.log('[mode] 伴飞按钮未找到');
  });
  await new Promise((r) => setTimeout(r, 600));
  const modeNow = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    return { mode: e.getViewCameraMode ? e.getViewCameraMode() : e.viewCameraMode, vg: e.vehicleGroup.visible, pass: e.lastFrameRenderInfo.vehicleDisplayPass };
  })()`);
  console.log('[mode]', JSON.stringify(modeNow));

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.waitForSelector('[data-testid="moon-btn-moon"]', { timeout: 10000 });
  const hit = await page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="moon-btn-moon"]');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, topElement: top ? (top.tagName + '|' + (top.textContent || '').slice(0, 20) + '|' + getComputedStyle(top).pointerEvents) : 'none' };
  })()`);
  console.log('[hit-test]', hit);
  await page.click('[data-testid="moon-btn-moon"]');
  console.log('[click] moon clicked');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s: any = await page.evaluate(`(() => {
      const snap = window.__solarEngine.getCameraSnapshot();
      return { t: snap.targetBodyId, trans: snap.isTransitioning, mode: snap.mode };
    })()`);
    console.log(`[t=${(i + 1) * 2}s]`, JSON.stringify(s));
    if (!s.trans && s.t === 'moon') { console.log('[done] arrived'); break; }
  }
  await browser.close();
}
main().catch((e) => { console.error('DIAG FAILED:', e); process.exit(1); });
