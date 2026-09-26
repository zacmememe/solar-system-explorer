import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/iss-solar-07/game';
await fs.mkdir(out, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const index = await fs.readFile('dist/index.html');
const report = { base: 'cdccb6d36f31bf6fa29295f85d81338f6e4ac7d4', sourceSha256: sha(await fs.readFile('src/vehicles/VehicleMeshBuilder.ts')), indexSha256: sha(index), cases: [], errors: [], checks: [] };
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser, page;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'profile'), args: ['--no-first-run', '--disable-background-networking'], protocolTimeout: 120000 });
  page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  const click = id => page.click(`[data-testid="${id}"]`);
  const shot = async name => {
    const state = await page.evaluate(() => {
      const e = window.__solarEngine, materials = [], panels = [];
      e.vehicleGroup.traverse(o => { if (o.isMesh) { const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) { if (m.name === 'iss-solar-cells') panels.push(o.id); if (!materials.some(x => x.uuid === m.uuid)) materials.push({ uuid: m.uuid, name: m.name, metalness: m.metalness, roughness: m.roughness, emissive: m.emissive?.toArray(), map: m.map?.uuid }); } } });
      return { camera: e.getCameraSnapshot(), simTime: e.simTimeHours, view: e.getViewCameraMode(), selected: e.getCurrentVehicle(), visible: e.vehicleGroup.visible, headlight: e.cameraHeadlight.intensity, panels: panels.length, materials };
    });
    await page.screenshot({ path: path.join(out, name + '.png') }); report.cases.push({ name, ...state }); return state;
  };
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__solarEngine?.getBodyNode('earth'));
  report.bundles = await page.$$eval('script[src]', els => els.map(e => new URL(e.src).pathname));
  report.bundleSha256 = Object.fromEntries(await Promise.all(report.bundles.map(async url => [url, sha(await fs.readFile('dist' + url))])));
  await click('planet-btn-earth');
  await page.waitForFunction(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'earth' && !c.isTransitioning; }, { timeout: 45000 });
  await page.click('[aria-controls="hud-observe-panel"]');
  if (await page.$('[aria-label="暂停天体时间"]')) await page.click('[aria-label="暂停天体时间"]');
  await page.keyboard.press('Escape');
  await click('toolbar-hangar-btn'); await click('hangar-vehicle-item-iss');
  await page.waitForSelector('[data-testid="hangar-3d-viewport"] canvas'); await delay(1800);
  await shot('01-hangar-studio'); await click('hangar-light-toggle-btn'); await delay(350); await shot('02-hangar-orbit');
  await click('hangar-board-btn');
  await page.waitForFunction(() => window.__solarEngine.getCurrentVehicle() === 'iss' && window.__solarEngine.vehicleGroup.visible);
  if (await page.$('[data-testid="hangar-close-btn"]')) await click('hangar-close-btn');
  await page.click('[aria-controls="hud-observe-panel"]');
  const formation = await page.$$('.hud-view-modes button'); await formation[1].click(); await page.keyboard.press('Escape'); await delay(450);
  const current = await shot('03-formation-current');
  assert.equal(current.panels, 8); assert(current.materials.find(m => m.name === 'iss-solar-cells').metalness === 0);
  // Historical parameter injection AFTER normal UI arrival; restore immediately.
  await page.evaluate(() => { window.__solarEngine.vehicleGroup.traverse(o => { if (o.isMesh && o.material.name === 'iss-solar-cells') o.material.metalness = .92; }); });
  await delay(120); const old = await shot('04-formation-legacy-diagnostic');
  assert.deepEqual(old.camera, current.camera); assert.equal(old.simTime, current.simTime); assert.equal(old.headlight, current.headlight);
  assert.deepEqual(old.materials.map(m => ({ ...m, metalness: m.name === 'iss-solar-cells' ? 0 : m.metalness })), current.materials);
  await page.evaluate(() => { window.__solarEngine.vehicleGroup.traverse(o => { if (o.isMesh && o.material.name === 'iss-solar-cells') o.material.metalness = 0; }); });
  report.checks.push('eight panels; fixed game camera/time/light; only cell metalness changed; restored');
  await page.click('[aria-controls="hud-observe-panel"]');
  const onboard = await page.$$('.hud-view-modes button'); await onboard[2].click(); await page.keyboard.press('Escape'); await delay(350); await shot('05-onboard');
  const canvas = await page.$('.canvas-container canvas') || await page.$('canvas');
  const box = await canvas.boundingBox(); await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .6, { steps: 12 }); await page.mouse.up(); await delay(200); await shot('06-onboard-drag');
  await click('toolbar-hangar-btn'); await click('hangar-clear-vehicle-btn');
  if (await page.$('[data-testid="hangar-close-btn"]')) await click('hangar-close-btn');
  await page.waitForFunction(() => window.__solarEngine.getCurrentVehicle() === null);
  assert.equal((await shot('07-clear')).visible, false);
  report.checks.push('normal UI hangar studio/orbit, formation/onboard/drag, clear');
  assert.deepEqual(report.errors, []); assert.equal(sha(await fs.readFile('dist/index.html')), report.indexSha256);
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await browser?.close(); await new Promise(r => server.httpServer.close(r)); }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, failure: report.failure }));
