import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { startVehicleLab } from './vehicle-lab.mjs';

const baseline = process.env.BASELINE === '1', root = 'D:/solar-evidence/vehicle-detail-08';
const out = path.join(root, baseline ? 'baseline' : 'final');
await fs.mkdir(path.join(out, 'models'), { recursive: true });
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const files = ['src/vehicles/VehicleMeshBuilder.ts', 'src/vehicles/VehicleTextures.ts', 'tools/vehicle-lab/model.mjs', 'tools/vehicle-lab/lab.mjs', 'scripts/verify-vehicle-detail.mjs'];
if (!baseline) files.push('src/vehicles/ISSModules.ts');
const fingerprint = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, hash(await fs.readFile(new URL('../' + f, import.meta.url)))])));
const report = { base: '8a8b5d0bba630b990d96a7a16de25b5293064106', baseline, sourceSha256: await fingerprint(), cases: [], errors: [] };
const lab = await startVehicleLab({ port: 0, derivedDir: path.join(out, 'models') }); let browser;
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'profile'), args: ['--no-first-run', '--disable-background-networking'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(lab.url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.vehicleLab?.ready());
  const old = baseline ? null : JSON.parse(await fs.readFile(path.join(root, 'baseline/verification.json'), 'utf8'));
  for (const vehicle of ['iss', 'shuttle-d']) {
    await page.select('#vehicle', vehicle); await page.waitForFunction(id => window.vehicleLab.ready() && window.vehicleLab.snapshot().id === id, {}, vehicle);
    const settings = vehicle === 'iss' ? [['detail','front','studio'],['detail','rear','studio'],['inspect','belly','studio'],['inspect','front','space'],['formation','front','assisted']] : [['formation','front','assisted'],['inspect','rear','studio']];
    for (const [view, angle, lighting] of settings) {
      await page.select('#view', view); await page.select('#lighting', lighting); await page.select('#sun', 'front'); await page.click(`[data-angle="${angle}"]`);
      const file = `${vehicle}-${view}-${angle}-${lighting}.png`;
      if (old) await page.evaluate(camera => window.vehicleLab.matchDiagnosticCamera(camera), old.cases.find(x => x.file === file).camera);
      const state = await page.evaluate(() => window.vehicleLab.snapshot());
      assert.equal(state.state, 'ready');
      if (view === 'formation') assert(state.projected.every(v => v.every(x => Number.isFinite(x) && Math.abs(x) < 1)));
      await page.screenshot({ path: path.join(out, file) });
      report.cases.push({ file, ...state });
    }
  }
  if (!baseline) {
    for (const c of report.cases) {
      const b = old.cases.find(x => x.file === c.file); assert.deepEqual(c.camera, b.camera); assert.deepEqual(c.lights, b.lights);
      if (c.id === 'shuttle-d') { assert.equal(c.triangles, b.triangles); assert.deepEqual(c.materials, b.materials); }
    }
    await page.select('#vehicle', 'iss'); await page.waitForFunction(() => window.vehicleLab.ready() && window.vehicleLab.snapshot().id === 'iss');
    await page.select('#view', 'inspect'); await page.select('#lighting', 'studio'); await page.click('[data-angle="front"]');
    await page.evaluate(() => window.vehicleLab.recordAppearance()); const source = await page.evaluate(() => window.vehicleLab.exportModel());
    const bytes = Buffer.from(source.base64, 'base64'); await fs.writeFile(path.join(out, 'models/iss.glb'), bytes);
    const loaded = await page.evaluate(() => window.vehicleLab.select({ vehicle: 'iss', view: 'inspect', lighting: 'studio', sun: 'front', angle: 'front', packedPath: '/derived/iss.glb' }));
    assert.equal(loaded.state, 'ready'); assert.equal(loaded.triangles, source.snapshot.triangles);
    const appearance = await page.evaluate(() => window.vehicleLab.compareAppearance()); assert(appearance.meanAbsoluteError < 2);
    report.package = { filename: 'models/iss.glb', bytes: bytes.length, sha256: hash(bytes), appearance, calibratedMetres: false, sourceTransformBaked: true };
    await page.screenshot({ path: path.join(out, 'iss-reimport.png') });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(await fingerprint(), report.sourceSha256); report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await browser?.close(); await lab.close(); }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, failure: report.failure }));
