import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startVehicleLab } from './vehicle-lab.mjs';

const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/vehicle-prototypes-05';
const sourcePaths = ['tools/vehicle-lab/model.mjs', 'tools/vehicle-lab/lab.mjs', 'tools/vehicle-lab/index.html', 'tools/vehicle-lab/lab.css', 'tools/vehicle-lab/assets.json', 'scripts/vehicle-lab.mjs', 'scripts/verify-vehicle-lab.mjs', 'src/vehicles/VehicleMeshBuilder.ts'];
const repo = fileURLToPath(new URL('../', import.meta.url));
async function fingerprint() { return Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, crypto.createHash('sha256').update(await fs.readFile(path.join(repo, file))).digest('hex')]))); }
const sourceSha256 = await fingerprint();
await fs.mkdir(out, { recursive: true });
const lab = await startVehicleLab({ port: 0 });
let browser;
const report = { base: lab.manifest.base, sourceSha256, assets: lab.manifest.assets, cases: [], errors: [], checks: {}, scope: 'isolated prototype, not game acceptance' };
try {
  browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'edge-profile'), args: ['--no-first-run', '--disable-background-networking', '--disable-component-update'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  let expectFailure = false;
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error' && !expectFailure) report.errors.push(e.text()); });
  await page.goto(lab.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.vehicleLab?.ready());
  const shots = [];
  for (const vehicle of ['cassini', 'shuttle-d']) {
    for (const angle of ['front', 'rear', 'belly']) for (const variant of ['assembled', 'refined']) shots.push({ vehicle, angle, variant, view: 'inspect', lighting: 'studio', sun: 'front' });
    for (const lighting of ['space', 'assisted']) for (const sun of ['front', 'back']) shots.push({ vehicle, variant: 'refined', view: 'inspect', angle: 'front', lighting, sun });
  }
  for (const vehicle of ['iss', 'cassini', 'shuttle-d', 'voyager', 'juno']) shots.push({ vehicle, variant: 'refined', view: 'formation', angle: 'front', lighting: 'assisted', sun: 'front' });
  for (const variant of ['original', 'materials-only']) shots.push({ vehicle: 'shuttle-d', variant, view: 'inspect', angle: 'front', lighting: 'studio', sun: 'front' });
  for (const angle of ['front', 'rear', 'belly']) for (const variant of ['assembled', 'refined']) shots.push({ vehicle: 'cassini', variant, view: 'detail', angle, lighting: 'studio', sun: 'front' });
  for (const sun of ['front', 'back']) shots.push({ vehicle: 'cassini', variant: 'refined', view: 'detail', angle: 'front', lighting: 'space', sun });
  for (const options of shots) {
    const snapshot = await page.evaluate(options => window.vehicleLab.select(options), options);
    assert.equal(snapshot.state, 'ready');
    assert(snapshot.projected.every(v => v.every(Number.isFinite) && Math.abs(v[2]) < 1));
    if (options.view === 'formation') assert(snapshot.projected.every(v => Math.abs(v[0]) < 1 && Math.abs(v[1]) < 1));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = Object.values(options).join('-') + '.png';
    await page.screenshot({ path: path.join(out, file) });
    report.cases.push({ file, ...snapshot }); console.log(file, snapshot.calls, snapshot.triangles);
  }
  // Real UI selection, pointer orbit, zoom, and reset; no production controller writes.
  await page.select('#view', 'inspect'); await page.select('#variant', 'refined'); await page.select('#vehicle', 'shuttle-d');
  await page.waitForFunction(() => window.vehicleLab.ready());
  const before = await page.evaluate(() => window.vehicleLab.snapshot());
  await page.mouse.move(1050, 490); await page.mouse.down(); await page.mouse.move(1270, 570, { steps: 16 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -240 });
  const after = await page.evaluate(() => window.vehicleLab.snapshot());
  assert.notDeepEqual(after.projected, before.projected);
  await page.click('#reset');
  report.checks.pointerOrbitAndZoom = 'PASS';
  // A late load must never replace the newest UI choice.
  await page.evaluate(async () => { await Promise.all(['voyager', 'shuttle-d', 'cassini'].map(vehicle => window.vehicleLab.select({ vehicle }))); });
  const final = await page.evaluate(() => window.vehicleLab.snapshot());
  assert.equal(final.id, 'cassini'); assert.equal(final.state, 'ready'); assert(final.changes.some(x => x.includes('foil_gold')));
  report.checks.latestSelectionWins = 'PASS';
  // Repeated switch cycle must release old GPU resources, including removed normal maps.
  const memory = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.vehicleLab.select({ vehicle: 'shuttle-d' }));
    memory.push((await page.evaluate(() => window.vehicleLab.select({ vehicle: 'cassini' }))).memory);
  }
  assert.deepEqual(memory[2], memory[1]); report.checks.resourceCycles = memory;
  expectFailure = true;
  await page.setRequestInterception(true);
  const intercept = r => r.url().endsWith('/SHUT-DOO.JPG') ? r.abort('failed') : r.continue();
  page.on('request', intercept);
  const failed = await page.evaluate(() => window.vehicleLab.select({ vehicle: 'shuttle-d' }));
  assert.equal(failed.state, 'error'); assert.equal(failed.projected.length, 0);
  assert.match(await page.$eval('#status', e => e.textContent), /加载失败/);
  report.checks.missingTextureFailsClosed = 'PASS';
  page.off('request', intercept); await page.setRequestInterception(false); expectFailure = false;
  assert.equal((await page.evaluate(() => window.vehicleLab.select({ vehicle: 'shuttle-d' }))).state, 'ready');
  report.checks.failureRecovery = 'PASS';
  await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => window.vehicleLab.select({ vehicle: 'cassini', view: 'inspect' }));
  const narrow = await page.evaluate(() => window.vehicleLab.snapshot());
  assert(narrow.projected.every(v => Math.abs(v[0]) < 1 && Math.abs(v[1]) < 1));
  report.checks.narrowInspectFraming = 'PASS';
  assert.deepEqual(await fingerprint(), sourceSha256);
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; }
finally {
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await lab.close();
  console.log(report.result, report.failure || '', out);
}
