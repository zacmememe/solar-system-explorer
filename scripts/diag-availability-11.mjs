// 诊断：切月→选静海→availability 变化序列（每 500ms 采样记录 action/reason）
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/diag-availability';
await fs.mkdir(OUT, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160)); });
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__solarEngine?.moonSiteStacks?.get('taurus-littrow')?.built, { timeout: 120000 });
await page.click('[data-testid="moon-btn-moon"]');
await page.waitForFunction(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'moon' && !c.isTransitioning; }, { timeout: 90000 });
await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
console.log('on moon, selecting tranquility-base...');
await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 150000) {
  const s = await page.evaluate(() => {
    const e = window.__solarEngine;
    const a = e.getLandingAvailability();
    const st = e.moonSiteStacks.get('tranquility-base');
    const r = st?.raster;
    return {
      action: a.action, reason: a.reason, detail: a.detail?.slice(0, 60),
      built: !!st?.built, loadStarted: !!st?.loadStarted,
      rasterState: r?.state, rasterError: r?.error?.slice(0, 80),
      activeSite: e.activeMoonSiteId,
      state: e.getLandingTelemetry().state,
    };
  });
  const line = JSON.stringify(s);
  if (line !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, line); last = line; }
  if (s.action === 'land' || s.action === 'exit-observe') break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.screenshot({ path: `${OUT}/final.png` });
await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log('DIAG DONE');
