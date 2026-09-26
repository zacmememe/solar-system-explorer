// Normal UI journey; engine access is read-only. Optional slow texture response tests asset ordering.
import puppeteer from 'puppeteer-core';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sampleBrowserPerformance} from './lib/browser-performance.ts';

const out=process.env.EVIDENCE_DIR || 'D:/solar-evidence/codex-system-polish/final';
const url=process.env.TEST_URL || 'http://127.0.0.1:5203';
const withVehicle=process.env.VERIFY_VEHICLE==='1';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true,userDataDir:path.join(out,`profile-${process.pid}`),defaultViewport:{width:1440,height:900},
  args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:45000});
const page=await browser.newPage(), delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={url,errors:[],consoleErrors:[],frames:[],performance:[],checks:[],visualAcceptance:'NOT_OBSERVED'};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
const click=id=>page.click(`[data-testid="${id}"]`);
async function shot(name){
  const meta=await page.evaluate(()=>{const e=window.__solarEngine;return {camera:e.getCameraSnapshot(),telemetry:e.getLandingTelemetry(),simTime:e.getSimTimeHours(),vehicle:e.getCurrentVehicle(),display:e.lastFrameRenderInfo};});
  if(meta.vehicle) {
    assert.equal(meta.display.vehicleDisplayPass,true);
    const r=meta.display.vehicleDisplayRange;
    assert.ok(Number.isFinite(r.near)&&r.near>0&&Number.isFinite(r.far)&&r.far>r.near);
  }
  await page.screenshot({path:path.join(out,`${name}.png`)});
  report.frames.push({name,...meta});
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
async function drag(dx,dy=0){await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640+dx,400+dy,{steps:12});await page.mouse.up();}
async function perf(name){const p=await sampleBrowserPerformance(page,name);report.performance.push(p);assert.equal(p.status,'complete');assert.ok(p.engineFrames>0);}
try {
  if(process.env.SLOW_TEXTURE==='1') {
    await page.setRequestInterception(true);
    page.on('request',r=>{
      if(r.url().includes('lroc_color_2k.jpg'))setTimeout(()=>r.continue().catch(()=>{}),12000);
      else r.continue().catch(()=>{});
    });
  }
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
  if(withVehicle) {
    await click('toolbar-hangar-btn');
    await page.waitForSelector('[data-testid="hangar-board-btn"]');await click('hangar-board-btn');
    await page.waitForFunction(()=>window.__solarEngine.currentVehicleMesh&&window.__solarEngine.vehicleGroup.visible,{timeout:30000});
    if(await page.$('[data-testid="hangar-close-btn"]'))await click('hangar-close-btn');
    // Real pointer click below, including when the transient boarding toast overlaps navigation.
  }
  await click('moon-btn-moon');
  await page.waitForFunction(()=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId==='moon'&&!s.isTransitioning;});
  await page.waitForSelector('[data-testid="landing-site-select"]');
  await page.select('[data-testid="landing-site-select"]','tranquility-base');
  await page.waitForFunction(()=>['land','travel-to-site'].includes(window.__solarEngine.getLandingAvailability().action),{timeout:60000});
  if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await click('lunar-landing-travel-site-btn');
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});
  await shot('01-moon-ready');
  await click('lunar-landing-start-btn');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='DESCENDING',{timeout:45000});
  // Pause through the real HOLD control before screenshotting: metadata and pixels share a stable pose.
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().altitudeAGLM<310000,{timeout:100000,polling:100});
  await click('landing-btn-hold');await delay(250);
  await shot('02-transition-held');
  await perf('transition-held');
  await click('landing-btn-resume');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:100000,polling:300});
  await shot('03-surface');await perf('surface');
  await click('landing-btn-reset-look');await delay(600);await shot('04-surface-horizon');
  await drag(260);await shot('05-surface-left');await drag(-520);await shot('06-surface-right');
  // Read-only delayed-material invariant: the currently used stack must share the current body's uniforms.
  report.materials=await page.evaluate(()=>{const e=window.__solarEngine, s=e.moonSiteStacks.get('tranquility-base');return {
    patchReference:s.patchMaterial===s.patchMesh.material,
    liveSun:s.valleyMaterial.uniforms.sunDirection===e.moonMaterial.uniforms.sunDirection,
    liveTeaching:s.valleyMaterial.uniforms.teachingLight===e.moonMaterial.uniforms.teachingLight,
    patchSun:s.patchMesh.material.uniforms.sunDirection===e.moonMaterial.uniforms.sunDirection,
    bodyAlpha:e.moonMaterial.uniforms.uOpacity.value,
  };});
  assert.deepEqual(report.materials,{patchReference:true,liveSun:true,liveTeaching:true,patchSun:true,bodyAlpha:1});
  await click('landing-btn-return-orbit');
  await page.waitForFunction(()=>{const e=window.__solarEngine,s=e.getCameraSnapshot();return e.getLandingTelemetry().state==='ORBIT'&&!s.isTransitioning;},{timeout:45000});
  await shot('07-return');await perf('return');
  report.checks.push('normal descent/hold/ground/drag/return and live material bindings');

  // Fresh mobile page so its initial compact disclosure matches a real narrow-screen launch.
  await page.setViewport({width:390,height:844});await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  await click('moon-btn-moon');
  await page.waitForFunction(()=>!window.__solarEngine.getCameraSnapshot().isTransitioning);
  await page.waitForSelector('[data-testid="landing-site-select"]');
  await shot('08-mobile-orbit');
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});await click('lunar-landing-start-btn');
  await page.waitForSelector('[data-testid="landing-btn-hold"]',{timeout:45000});await click('landing-btn-hold');
  await shot('09-mobile-hold');
  assert.equal(await page.$eval('.landing-details',d=>d.open),false);
  await page.click('.landing-details summary');await shot('10-mobile-details');
  await page.click('.landing-details summary');
  await click('landing-btn-return-hold');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT',{timeout:45000});
  report.checks.push('mobile details disclosure and visible return control');
  assert.equal(report.errors.length,0);assert.equal(report.consoleErrors.length,0);
} catch(error){report.failure=String(error);process.exitCode=1;}
finally {await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks,performance:report.performance,errors:report.errors,failure:report.failure}));
