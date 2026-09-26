// UI journey first; layer isolation is labelled diagnostic and preserves pose/time.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { timePanel, journeyAction } from './lib/hud-ui.mjs';
const site = process.env.SITE_ID || 'jezero';
const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/surface-detail-10/baseline';
await fs.mkdir(out, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const report = { site, images: [], errors: [], checks: [], indexSha256: sha(await fs.readFile('dist/index.html')) };
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser, page;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
 browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'profile'), defaultViewport: { width: 1920, height: 1080 }, args: ['--use-gl=angle', '--use-angle=d3d11'], protocolTimeout: 180000 });
 page = await browser.newPage();
 page.on('pageerror', e => report.errors.push(String(e)));
 page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
 page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
 const click = id => page.click(`[data-testid="${id}"]`);
 const snapshot = () => page.evaluate(() => { const e = window.__solarEngine; return { position: e.camera.position.toArray(), quaternion: e.camera.quaternion.toArray(), time: e.getSimTimeHours(), camera: e.getCameraSnapshot(), landing: e.getLandingTelemetry(), atmosphere: e.getMarsAtmosphereDiagnostics(), slices: e.lastFrameRenderInfo }; });
 const shot = async name => { const state = await snapshot(); await page.screenshot({ path: path.join(out, name + '.png') }); report.images.push({ name, ...state }); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('captured', name); return state; };
 const drag = async (dx, dy = 0) => { await page.mouse.move(850, 450); await page.mouse.down(); await page.mouse.move(850 + dx, 450 + dy, { steps: 25 }); await page.mouse.up(); await delay(800); };
 await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(() => window.__solarEngine?.getBodyNode('mars'));
 report.bundles = await page.$$eval('script[src]', els => els.map(e => new URL(e.src).pathname));
 await click('planet-btn-mars');
 await page.waitForFunction(() => { const s = window.__solarEngine.getCameraSnapshot(); return s.targetBodyId === 'mars' && !s.isTransitioning; }, { timeout: 60000 });
 await page.select('[data-testid="landing-site-select"]', site);
 await timePanel(page); await click('landing-daylight'); await page.keyboard.press('Escape');
 await page.click('[aria-controls="hud-observe-panel"]');
 if (await page.$('[aria-label="暂停天体时间"]')) await page.click('[aria-label="暂停天体时间"]');
 await page.keyboard.press('Escape');
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]', { timeout: 90000 });
 if (await page.$('[data-testid="lunar-landing-travel-site-btn"]')) await click('lunar-landing-travel-site-btn');
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 60000 }); await click('lunar-landing-start-btn');
 await page.waitForFunction(() => { const t = window.__solarEngine.getLandingTelemetry(); return t.state === 'DESCENDING' && t.altitudeAGLM < 900; }, { timeout: 180000, polling: 100 });
 await click('landing-btn-hold'); await delay(800); await shot('01-low-hold'); await click('landing-btn-resume');
 await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', { timeout: 120000 });
 await journeyAction(page, 'landing-btn-reset-look'); await delay(1600);
 const base = await shot('02-ground');
 if (process.env.ISOLATE !== '0') {
   const names = ['mola-l1-boundary-skirt', 'mola-l1-window-rim', 'mola-l1-regional-terrain', `${site}-terrain`, 'mars-hole-cap', 'procedural-rockfield-mars'];
   for (const name of names) {
     const found = await page.evaluate(({ site, name }) => {
       const e = window.__solarEngine, stack = e.marsSiteStacks.get(site); window.__isolated10 = [];
       // onBeforeRender hides by layer rather than visible flags that animation may rewrite.
       stack.group.traverse(m => { if (m.name === name) { window.__isolated10.push([m, m.layers.mask]); m.layers.mask = 0; } });
       return window.__isolated10.length;
     }, { site, name });
     if (!found) { report.checks.push({ name, found }); continue; }
     try { await delay(180); const s = await shot('diag-hide-' + name); assert.deepEqual(s.position, base.position); assert.deepEqual(s.quaternion, base.quaternion); assert.equal(s.time, base.time); }
     finally { await page.evaluate(() => { for (const [m, mask] of window.__isolated10) m.layers.mask = mask; delete window.__isolated10; }); }
   }
 }
 await drag(-420); await shot('03-right'); await drag(840); await shot('04-left'); await drag(0, -220); await shot('05-sky');
 await click('landing-btn-return-orbit');
 await page.waitForFunction(() => { const e = window.__solarEngine, c = e.getCameraSnapshot(); return e.getLandingTelemetry().state === 'ORBIT' && c.mode === 'ORBIT_TARGET' && !c.isTransitioning; }, { timeout: 60000 });
 await delay(1200); await shot('06-returned');
 assert.deepEqual(report.errors, []); assert.equal(sha(await fs.readFile('dist/index.html')), report.indexSha256); report.result = 'PASS';
} catch (e) { report.failure = String(e.stack || e); report.result = 'FAIL'; process.exitCode = 1; await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await new Promise(r => server.httpServer.close(r)); }
console.log(JSON.stringify({ result: report.result, images: report.images.length, failure: report.failure, errors: report.errors }));
