import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const baseline = process.env.BASELINE === '1';
const vehicle=baseline?'hubble':'cassini';
const assetFile=baseline?'public/assets/models/hubble-nasa-b.glb':'public/assets/models/selected/cassini.glb';
const out = process.env.EVIDENCE_DIR || `D:/solar-evidence/vehicle-reliability-09/${baseline ? 'baseline' : 'final'}`;
await fs.mkdir(out, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const report = { base: process.env.BASE_SHA || '9f37d19d80c66ef59977bf74183571345fef8757', baseline, vehicle, indexSha256: sha(await fs.readFile('dist/index.html')), cases: [], errors: [], expectedNetworkErrors: [] };
const sources = ['src/app/App.tsx', 'src/contracts/hud.ts', 'src/engine/SolarEngine.ts', 'src/vehicles/HangarModal.tsx', 'src/vehicles/VehicleLoader.ts', 'src/vehicles/VehicleTextures.ts', 'src/vehicles/VehicleViewer3D.tsx'];
report.sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async file => [file, sha(await fs.readFile(file))])));
const sourceGlb = await fs.readFile(assetFile);
const jsonLength = sourceGlb.readUInt32LE(12), gltf = JSON.parse(sourceGlb.subarray(20, 20 + jsonLength).toString());
// Add a missing dependency to a used material only in the intercepted response.
// Preserve all existing embedded images; never alter the checked-in asset.
gltf.images??=[];gltf.textures??=[];gltf.materials??=[];
gltf.images.push({uri:'/injected-missing-vehicle-texture.png'});
gltf.textures.push({source:gltf.images.length-1});
gltf.materials.push({pbrMetallicRoughness:{baseColorTexture:{index:gltf.textures.length-1}}});
gltf.meshes[0].primitives[0].material=gltf.materials.length-1;
const encoded = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
const textureFaultGlb = Buffer.concat([sourceGlb.subarray(0, 20), padded, sourceGlb.subarray(20 + jsonLength)]);
textureFaultGlb.writeUInt32LE(textureFaultGlb.length, 8); textureFaultGlb.writeUInt32LE(padded.length, 12);
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser, page, fault = 'fail', pending = [], requests = 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: path.join(out, 'profile'), args: ['--no-first-run', '--disable-background-networking'], protocolTimeout: 120000 });
  page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false); await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('/injected-missing-vehicle-texture.png')) { void req.respond({ status: 503, body: 'Injected texture failure' }); return; }
    if (!req.url().includes(assetFile.replace('public',''))) { void req.continue(); return; }
    requests++;
    if (fault === 'fail') void req.respond({ status: 503, body: 'Injected vehicle failure' });
    else if (fault === 'texture') void req.respond({ status: 200, contentType: 'model/gltf-binary', body: textureFaultGlb });
    else if (fault === 'delay') pending.push(req);
    else void req.continue();
  });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') {
    const text = m.text();
    if (text.includes('503') || text.includes('injected-missing-vehicle-texture.png') || (baseline && text.includes('[VehicleLoader]'))) report.expectedNetworkErrors.push(text);
    else report.errors.push(text);
  } });
  const click = id => page.click(`[data-testid="${id}"]`);
  const wait = predicate => page.waitForFunction(predicate, { timeout: 45000 });
  const ready = () => wait(() => document.querySelector('[data-testid="hangar-3d-viewport"]')?.getAttribute('data-load-state') === 'ready' && document.querySelector('[data-testid="hangar-board-btn"]')?.disabled === false);
  const waitPending = async () => { const deadline = Date.now() + 20000; while (!pending.length && Date.now() < deadline) await delay(40); assert.ok(pending.length > 0, 'delayed request was intercepted'); };
  const shot = async name => {
    const state = await page.evaluate(() => ({ selected: window.__solarEngine.getCurrentVehicle(), model: window.__solarEngine.currentVehicleMesh?.userData, visible: window.__solarEngine.vehicleGroup.visible, view: window.__solarEngine.getViewCameraMode(), text: document.body.innerText, boardDisabled: document.querySelector('[data-testid="hangar-board-btn"]')?.disabled, preview: document.querySelector('[data-testid="hangar-3d-viewport"]')?.getAttribute('data-load-state') }));
    await page.screenshot({ path: path.join(out, name + '.png') }); report.cases.push({ name, ...state }); return state;
  };
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await wait(() => window.__solarEngine?.getBodyNode('earth'));
  report.bundles = await page.$$eval('script[src]', els => els.map(e => new URL(e.src).pathname));
  report.bundleSha256 = Object.fromEntries(await Promise.all(report.bundles.map(async url => [url, sha(await fs.readFile('dist' + url))])));
  await click('planet-btn-earth');
  await wait(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'earth' && !c.isTransitioning; });
  await click('toolbar-hangar-btn'); await click('hangar-vehicle-item-'+vehicle); await delay(2000);
  const failure = await shot('01-model-failure');
  if (baseline) {
    assert.equal(failure.boardDisabled, false);
    await click('hangar-board-btn'); await delay(1800);
    const boarded = await shot('02-false-success');
    assert.equal(boarded.selected, vehicle); assert.equal(boarded.model.isGlb, false);
    assert.match(boarded.text, /已登船/);
  } else {
    assert.equal(failure.preview, 'error'); assert.equal(failure.boardDisabled, true);
    fault = 'texture'; await click('hangar-model-retry');
    await wait(() => document.querySelector('[data-testid="hangar-3d-viewport"]')?.getAttribute('data-load-state') === 'error');
    const missingTexture = await shot('01b-texture-failure'); assert.equal(missingTexture.boardDisabled, true);
    fault = 'none'; await click('hangar-model-retry');
    await ready();
    await shot('02-retry-ready');
    // Successful preview does not certify the subsequent, independent main load.
    fault = 'fail'; await click('hangar-board-btn'); await delay(2000);
    const failedMain = await shot('03-main-failure');
    assert.equal(failedMain.selected, null); assert.equal(failedMain.visible, false); assert.match(failedMain.text, /未能加载/); assert.doesNotMatch(failedMain.text, /开始伴飞/);
    fault = 'delay'; await click('toolbar-hangar-btn'); await click('hangar-vehicle-item-'+vehicle); await waitPending();
    assert.equal((await shot('04-loading')).boardDisabled, true);
    await click('hangar-close-btn'); await click('toolbar-hangar-btn');
    await ready();
    const delayed = pending; pending = []; for (const req of delayed) await req.continue();
    await delay(1600); assert.equal((await shot('05-close-reopen')).preview, 'ready');
    // A delayed selection must not overwrite a subsequent ISS selection.
    await click('hangar-vehicle-item-'+vehicle); await waitPending(); await click('hangar-vehicle-item-iss');
    await ready();
    for (const req of pending) await req.continue(); pending = []; await delay(1400);
    await shot('06-rapid-switch'); await click('hangar-board-btn');
    await wait(() => window.__solarEngine.getCurrentVehicle() === 'iss' && window.__solarEngine.vehicleGroup.visible);
    const iss = await shot('07-iss-formation'); assert.equal(iss.model.isGlb, false);
    fault = 'none'; await click('toolbar-hangar-btn'); await click('hangar-vehicle-item-'+vehicle);
    await ready();
    fault = 'delay'; await click('hangar-board-btn'); await waitPending();
    const loadingMain = await shot('08-main-pending'); assert.equal(loadingMain.selected, null); assert.doesNotMatch(loadingMain.text, /开始伴飞/);
    await click('toolbar-hangar-btn'); await page.waitForSelector('[data-testid="hangar-clear-vehicle-btn"]'); await click('hangar-clear-vehicle-btn');
    fault = 'none'; for (const req of pending) await req.continue(); pending = [];
    await delay(1800); assert.equal((await shot('08b-pending-cancelled')).selected, null);
    await click('toolbar-hangar-btn'); await click('hangar-vehicle-item-'+vehicle); await ready(); await click('hangar-board-btn');
    await page.waitForFunction(id => window.__solarEngine.getCurrentVehicle() === id && window.__solarEngine.vehicleGroup.visible, {timeout:45000}, vehicle);
    const loaded = await shot('09-selected-formation'); assert.equal(loaded.model.isGlb, true); assert.match(loaded.text, /开始伴飞/);
    await click('toolbar-hangar-btn'); await click('hangar-clear-vehicle-btn');
    await wait(() => window.__solarEngine.getCurrentVehicle() === null);
    assert.equal((await shot('10-clear')).visible, false);
  }
  report.requests = requests; assert.deepEqual(report.errors, []);
  assert.equal(sha(await fs.readFile('dist/index.html')), report.indexSha256);
  for (const file of sources) assert.equal(sha(await fs.readFile(file)), report.sourceSha256[file]);
  report.result = 'PASS';
} catch (e) { report.result = 'FAIL'; report.failure = String(e.stack || e); process.exitCode = 1; await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await browser?.close(); await new Promise(r => server.httpServer.close(r)); }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, failure: report.failure }));
