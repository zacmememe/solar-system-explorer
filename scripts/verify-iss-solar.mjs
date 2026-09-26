import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { startVehicleLab } from './vehicle-lab.mjs';

const baseline = process.env.BASELINE === '1';
const root = process.env.EVIDENCE_DIR || 'D:/solar-evidence/iss-solar-07';
const out = path.join(root, baseline ? 'baseline' : 'final');
await fs.mkdir(path.join(out, 'models'), { recursive: true });
const inputs = ['src/vehicles/VehicleMeshBuilder.ts', 'src/vehicles/VehicleTextures.ts', 'tools/vehicle-lab/lab.mjs', 'scripts/verify-iss-solar.mjs'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const fingerprints = async () => Object.fromEntries(await Promise.all(inputs.map(async f => [f, hash(await fs.readFile(new URL('../' + f, import.meta.url)))])));
const report = { base: 'cdccb6d36f31bf6fa29295f85d81338f6e4ac7d4', baseline, sourceSha256: await fingerprints(), cases: [], errors: [], scope: 'ISS material only; controlled lab A/B, not game acceptance' };
const lab = await startVehicleLab({ port: 0, derivedDir: path.join(out, 'models') });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'profile'), args: ['--no-first-run', '--disable-background-networking'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(lab.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.vehicleLab?.ready());
  await page.select('#vehicle', 'iss'); await page.waitForFunction(() => window.vehicleLab.snapshot().id === 'iss' && window.vehicleLab.ready());
  // Normal UI arrives at the model. The explicitly labelled diagnostic below
  // varies ONLY its solar-cell metalness, never the pose or illumination.
  const initial = await page.evaluate(() => {
    const panels = []; window.vehicleLab.raw().traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width === 1.05) panels.push(o); });
    return { count: panels.length, metalness: panels.map(o => o.material.metalness) };
  });
  assert.equal(initial.count, 8); assert(initial.metalness.every(m => m === (baseline ? .92 : 0)));
  for (const [view, light, sun, angle] of [['inspect','space','front','front'], ['inspect','space','back','front'], ['inspect','space','back','rear'], ['formation','assisted','front','front'], ['detail','studio','front','front']]) {
    await page.select('#view', view); await page.select('#lighting', light); await page.select('#sun', sun); await page.click(`[data-angle="${angle}"]`);
    let previous;
    for (const [variant, metalness] of [['before', .92], ['after', 0]]) {
      const snapshot = await page.evaluate(metalness => {
        const panels = [], materials = new Set();
        window.vehicleLab.raw().traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width === 1.05) { panels.push(o); materials.add(o.material); } });
        for (const m of materials) m.metalness = metalness;
        document.querySelector('#status').textContent = `受控对照：仅 ISS 电池片金属度 = ${metalness}；相机/灯光/纹理固定`;
        // Request a regular render through the existing lighting UI.
        document.querySelector('#sun').dispatchEvent(new Event('change'));
        const m = panels[0].material;
        return { ...window.vehicleLab.snapshot(), panelCount: panels.length, panel: { metalness: m.metalness, roughness: m.roughness, color: m.color.toArray(), emissive: m.emissive.toArray(), side: m.side, texture: m.map.image.toDataURL() } };
      }, metalness);
      snapshot.panel.textureSha256 = hash(snapshot.panel.texture); delete snapshot.panel.texture;
      assert.equal(snapshot.panelCount, 8); assert.deepEqual(snapshot.panel.emissive, [0, 0, 0]);
      if (previous) {
        for (const key of ['camera', 'lights', 'projected', 'triangles']) assert.deepEqual(snapshot[key], previous[key]);
        assert.deepEqual({ ...snapshot.panel, metalness: 0 }, { ...previous.panel, metalness: 0 });
        assert.deepEqual(snapshot.materials.map(m => ({ ...m, metalness: 0 })), previous.materials.map(m => ({ ...m, metalness: 0 })));
        assert.equal(snapshot.materials.filter((m, i) => m.metalness !== previous.materials[i].metalness).length, 1);
      }
      const file = `${view}-${light}-${sun}-${angle}-${variant}.png`;
      await page.screenshot({ path: path.join(out, file) }); report.cases.push({ file, variant, ...snapshot }); previous = snapshot;
    }
  }
  if (!baseline) {
    await page.evaluate(() => window.vehicleLab.select({ vehicle: 'iss', view: 'inspect', variant: 'refined', lighting: 'studio', sun: 'front' }));
    await page.evaluate(() => window.vehicleLab.recordAppearance());
    const exported = await page.evaluate(() => window.vehicleLab.exportModel());
    const bytes = Buffer.from(exported.base64, 'base64');
    await fs.writeFile(path.join(out, 'models/iss.glb'), bytes);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
    assert((json.images || []).every(i => i.bufferView !== undefined && !i.uri));
    assert((json.buffers || []).every(b => !b.uri));
    const loaded = await page.evaluate(() => window.vehicleLab.select({ vehicle: 'iss', view: 'inspect', variant: 'refined', lighting: 'studio', sun: 'front', packedPath: '/derived/iss.glb' }));
    assert.equal(loaded.state, 'ready'); assert.equal(loaded.triangles, exported.snapshot.triangles);
    const appearance = await page.evaluate(() => window.vehicleLab.compareAppearance()); assert(appearance.meanAbsoluteError < 2);
    report.package = { file: 'models/iss.glb', bytes: bytes.length, sha256: hash(bytes), appearance, calibratedMetres: false, sourceTransformBaked: true };
    await page.screenshot({ path: path.join(out, 'iss-reimport.png') });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(await fingerprints(), report.sourceSha256);
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await browser?.close(); await lab.close(); }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, failure: report.failure }));
