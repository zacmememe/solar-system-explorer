import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startVehicleLab } from './vehicle-lab.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/vehicle-preflight-06';
await fs.mkdir(path.join(out, 'models'), { recursive: true });
const inputs = ['tools/vehicle-lab/model.mjs', 'tools/vehicle-lab/lab.mjs', 'tools/vehicle-lab/assets.json', 'scripts/vehicle-lab.mjs', 'scripts/verify-vehicle-preflight.mjs'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprints = async () => Object.fromEntries(await Promise.all(inputs.map(async file => [file, hash(await fs.readFile(path.join(repo, file)))])));
const report = { base: 'ea4d25bc2d8d45d227d1e2497a84a550a7b8a38e', sourceSha256: await fingerprints(), cases: [], checks: {}, packages: [], errors: [], scope: 'isolated five-vehicle preparation, not game release' };
const lab = await startVehicleLab({ port: 0, derivedDir: path.join(out, 'models') }); let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'edge-profile'), args: ['--no-first-run', '--disable-background-networking'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') report.errors.push(e.text()); });
  await page.goto(lab.url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.vehicleLab?.ready());
  // Arrive using the same controls available to the user, before the controlled A/B.
  await page.select('#vehicle', 'juno'); await page.select('#view', 'formation'); await page.select('#lighting', 'assisted');
  await page.waitForFunction(() => window.vehicleLab.ready());
  const shots = [];
  for (const view of ['formation', 'inspect', 'detail']) for (const variant of ['original', 'refined']) shots.push({ vehicle: 'juno', view, variant, angle: 'front', lighting: 'assisted', sun: 'front' });
  for (const sun of ['front', 'side', 'back']) for (const variant of ['original', 'refined']) shots.push({ vehicle: 'juno', view: 'inspect', variant, angle: 'front', lighting: 'space', sun });
  for (const angle of ['rear', 'belly']) shots.push({ vehicle: 'juno', view: 'inspect', variant: 'refined', angle, lighting: 'studio', sun: 'front' });
  for (const vehicle of ['iss', 'cassini', 'shuttle-d', 'voyager', 'juno']) shots.push({ vehicle, view: 'formation', variant: 'refined', angle: 'front', lighting: 'assisted', sun: 'front' });
  for (const vehicle of ['voyager', 'shuttle-d']) for (const angle of ['front', 'rear', 'belly']) shots.push({ vehicle, view: 'inspect', variant: 'refined', angle, lighting: 'studio', sun: 'front' });
  const unique = Array.from(new Map(shots.map(x => [JSON.stringify(x), x])).values());
  for (const options of unique) {
    const snapshot = await page.evaluate(options => window.vehicleLab.select(options), options);
    assert.equal(snapshot.state, 'ready');
    if (options.view === 'formation') assert(snapshot.projected.every(v => v.every(Number.isFinite) && v.every(x => Math.abs(x) < 1)));
    const file = [options.vehicle, options.view, options.variant, options.angle, options.lighting, options.sun].join('-') + '.png';
    await page.screenshot({ path: path.join(out, file) }); report.cases.push({ file, ...snapshot });
    console.log(file);
  }
  for (const original of report.cases.filter(x => x.id === 'juno' && x.variant === 'original')) {
    const refined = report.cases.find(x => x.id === 'juno' && x.variant === 'refined' && x.view === original.view && x.angle === original.angle && x.lighting === original.lighting && x.sun === original.sun);
    assert.deepEqual(original.camera, refined.camera); assert.deepEqual(original.lights, refined.lights); assert.deepEqual(original.projected, refined.projected);
    assert.deepEqual(original.materials.map(m => ({ ...m, metalness: 0 })), refined.materials.map(m => ({ ...m, metalness: 0 })));
    for (const old of original.materials) {
      const changed = refined.materials.find(m => m.name === old.name);
      assert.equal(changed.metalness, ['shiny_panels', 'solar_panels'].includes(old.name) ? 0 : old.metalness);
    }
  }
  report.checks.samePoseSameLightOnlyPanelMetalness = 'PASS';
  // Export self-contained, fully assembled files for the next integration task.
  for (const [id, runtimeId] of [['iss','iss'], ['cassini','cassini'], ['voyager','voyager-1'], ['juno','juno'], ['shuttle-d','space-shuttle']]) {
    await page.evaluate(vehicle => window.vehicleLab.select({ vehicle, view: 'inspect', variant: 'refined', lighting: 'studio', sun: 'front' }), id);
    await page.evaluate(() => window.vehicleLab.recordAppearance());
    const exported = await page.evaluate(() => window.vehicleLab.exportModel());
    const bytes = Buffer.from(exported.base64, 'base64');
    const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert((json.buffers || []).every(b => !b.uri)); assert((json.images || []).every(i => !i.uri && i.bufferView !== undefined));
    const filename = runtimeId + '.glb'; await fs.writeFile(path.join(out, 'models', filename), bytes);
    const roundTrip = await page.evaluate(settings => window.vehicleLab.select(settings), { vehicle: id, view: 'inspect', variant: 'refined', angle: 'front', lighting: 'studio', sun: 'front', packedPath: '/derived/' + filename });
    assert.equal(roundTrip.state, 'ready'); assert.equal(roundTrip.triangles, exported.snapshot.triangles);
    // The original selection defaults to front above. Re-import must preserve
    // projection, including rotations, centred assembly and source transforms.
    assert.equal(roundTrip.projected.length, 8);
    for (let v = 0; v < 8; v++) for (let n = 0; n < 3; n++) assert(Math.abs(roundTrip.projected[v][n] - exported.snapshot.projected[v][n]) < 1e-5);
    const appearance = await page.evaluate(() => window.vehicleLab.compareAppearance());
    console.log('ROUND TRIP', runtimeId, appearance);
    assert(appearance.meanAbsoluteError < 2, 'Export changed model appearance: ' + runtimeId);
    const importedFile = runtimeId + '-reimport.png'; await page.screenshot({ path: path.join(out, importedFile) });
    report.packages.push({ id: runtimeId, labId: id, filename, bytes: bytes.length, sha256: hash(bytes), selfContained: true, sourceUnitSize: exported.sourceUnitSize, calibratedMetres: false, sourceTransformBaked: true, sourceDisplaySpan: exported.profile.span, triangles: exported.snapshot.triangles, roundTrip: 'PASS', roundTripAppearance: appearance, roundTripScreenshot: importedFile, sourceAssets: lab.manifest.assets.filter(a => id === 'iss' ? false : id === 'shuttle-d' ? a.id.startsWith('shuttle-d') : a.id === id) });
    console.log('PACKED', runtimeId, bytes.length);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(await fingerprints(), report.sourceSha256);
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await browser?.close(); await lab.close(); console.log(report.result, report.failure || ''); }
