// Real UI regression, using installed Edge. Evidence stays outside the synced repo.
// TEST_URL may point at either Vite dev or the normal built preview.
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/observation-recovery';
await mkdir(out, {recursive:true});
const browser = await puppeteer.launch({
  executablePath:process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true, userDataDir:path.join(out, `profile-${process.pid}`),
  args:['--use-gl=angle','--use-angle=d3d11'], protocolTimeout:240000,
});
const page = await browser.newPage();
await page.setViewport({width:1440,height:900});
const report = {url:process.env.TEST_URL || 'http://127.0.0.1:5201', pageErrors:[], consoleErrors:[], checks:[], visualAcceptance:'NOT_OBSERVED'};
page.on('pageerror', error=>report.pageErrors.push(String(error)));
page.on('console', message=>{if(message.type()==='error') report.consoleErrors.push(message.text());});
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shot = name=>page.screenshot({path:path.join(out,`${name}.png`)});
async function travel(id, moon=false) {
  await page.evaluate(()=>{
    const e=window.__solarEngine, start=e.camera.position.clone();
    window.__travelCheck={maxDistance:0,stop:false};
    const sample=()=>{
      window.__travelCheck.maxDistance=Math.max(window.__travelCheck.maxDistance,e.camera.position.distanceTo(start));
      if(!window.__travelCheck.stop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.click(`[data-testid="${moon?'moon':'planet'}-btn-${id}"]`);
  await page.waitForFunction(id=>{
    const s=window.__solarEngine.getCameraSnapshot();
    return s.targetBodyId===id && !s.isTransitioning;
  },{timeout:30000},id);
  await delay(500);
  const maxDistance=await page.evaluate(()=>{window.__travelCheck.stop=true; return window.__travelCheck.maxDistance;});
  assert.ok(maxDistance<500,`travel to ${id} detoured ${maxDistance} scene units`);
  report.checks.push({name:`travel-${id}`,maxDistance,pass:true});
  console.log(`Travel ${id}: PASS`);
}
async function checkSky(label) {
  const values = await page.evaluate(()=>{
    const e=window.__solarEngine, p=e.getBodyPoseProvider(), refId=p.getPhysicalReferenceBody();
    const ref=p.getPhysicalBodyState(refId,e.simTimeHours), origin=e.getBodyWorldPose(refId);
    const scale=origin.surfaceRadius/ref.meanRadiusKm;
    const offset=e.camera.position.clone().sub(origin.pos).divideScalar(scale);
    const rows=[];
    for(const [id,node] of e.bodyNodes) {
      const physical=p.getPhysicalBodyState(id,e.simTimeHours), pose=e.getBodyWorldPose(id);
      const expected=pose.pos.clone().set(...physical.positionKm).sub(pose.pos.clone().set(...ref.positionKm)).sub(offset);
      const observed=pose.pos.clone().sub(e.camera.position);
      const distance=observed.length();
      rows.push({id,visible:node.systemGroup.visible,distance,radius:pose.surfaceRadius,
        directionError:observed.clone().normalize().distanceTo(expected.clone().normalize()),
        angularRatioError:Math.abs(pose.surfaceRadius/distance-physical.meanRadiusKm/expected.length())});
    }
    return {reference:refId,policy:e.getPresentationPolicy(),rows};
  });
  assert.equal(values.policy,'PHYSICAL_OBSERVATION');
  for(const row of values.rows) {
    assert.equal(row.visible,true,`${label}: hidden ${row.id}`);
    assert.ok(Number.isFinite(row.radius)&&row.radius>0,`${label}: invalid ${row.id}`);
    assert.ok(row.directionError<1e-6,`${label}: ${row.id} direction ${row.directionError}`);
    assert.ok(row.angularRatioError<1e-6,`${label}: ${row.id} angular size ${row.angularRatioError}`);
  }
  report.checks.push({name:label,pass:true,...values});
}
async function drag(name, dx=340, dy=20) {
  await page.mouse.move(730,430); await page.mouse.down();
  await page.mouse.move(730+dx,430+dy,{steps:25}); await page.mouse.up();
  await delay(200); await shot(name);
}
async function land(label) {
  await page.waitForFunction(()=>['land','travel-to-site'].includes(window.__solarEngine.getLandingAvailability().action),{timeout:45000});
  if(await page.$('[data-testid="lunar-landing-travel-site-btn"]')) {
    await page.click('[data-testid="lunar-landing-travel-site-btn"]');
  }
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});
  await page.click('[data-testid="lunar-landing-start-btn"]');
  const start=Date.now(), samples=[];
  while(Date.now()-start<120000) {
    await delay(5000);
    const telemetry=await page.evaluate(()=>window.__solarEngine.getLandingTelemetry());
    samples.push(telemetry); await shot(`${label}-descent-${samples.length}`);
    if(telemetry.state==='SURFACE_LOOK') break;
  }
  assert.equal(samples.at(-1)?.state,'SURFACE_LOOK',`${label}: descent did not complete`);
  await drag(`${label}-ground-left`,260,0);
  await drag(`${label}-ground-right`,-520,0);
  const landed=await page.evaluate(()=>{
    const e=window.__solarEngine;
    return {telemetry:e.getLandingTelemetry(),depth:e.lastFrameRenderInfo,
      moonOpacity:e.lunarValleyMaterial?.opacity,marsOpacity:e.marsTerrainMaterial?.opacity};
  });
  const performanceSample=await page.evaluate(async()=>{
    const e=window.__solarEngine, frames=e.getRenderFrameCount(), start=performance.now();
    await new Promise(resolve=>setTimeout(resolve,2000));
    return {renderedFrames:e.getRenderFrameCount()-frames,elapsedMs:performance.now()-start};
  });
  landed.performanceSample=performanceSample;
  report.checks.push({name:label,pass:true,samples,landed});
  await page.click('[data-testid="landing-btn-return-orbit"]');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT' && window.__solarEngine.getCameraSnapshot().mode==='ORBIT_TARGET',{timeout:60000});
  await shot(`${label}-returned`);
  console.log(`${label} descent, ground drag and return: PASS`);
}
try {
  await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  report.bundle=await page.evaluate(()=>Array.from(document.scripts).map(s=>s.src).filter(Boolean));
  report.browser=await browser.version();
  await travel('earth'); await checkSky('earth'); await shot('earth');
  for(let i=0;i<4;i++) {await drag(`earth-drag-${i}`); await checkSky(`earth-drag-${i}`);}
  await travel('saturn'); await checkSky('saturn'); await shot('saturn');
  for(let i=0;i<3;i++) await drag(`saturn-drag-${i}`);
  await page.click('[aria-label="俯瞰整个太阳系全景"]');
  await page.waitForFunction(()=>window.__solarEngine.getPresentationPolicy()==='NAV_SCHEMATIC'&&!window.__solarEngine.getCameraSnapshot().isTransitioning);
  await shot('overview'); report.checks.push({name:'overview',pass:true});
  await travel('mars'); await travel('phobos',true); await checkSky('phobos'); await shot('phobos');
  await page.mouse.move(800,430); await page.mouse.wheel({deltaY:-60}); await delay(500); await shot('phobos-wheel');
  if(process.env.VERIFY_SURFACES!=='0') {
    if(process.env.VERIFY_SURFACES!=='mars') {
      await travel('earth'); await travel('moon',true); await checkSky('moon'); await land('moon');
    }
    if(process.env.VERIFY_SURFACES!=='moon') {
      await travel('mars'); await checkSky('mars'); await land('mars');
    }
  }
  assert.deepEqual(report.pageErrors,[]);
  assert.deepEqual(report.consoleErrors.filter(s=>/THREE.WebGLProgram|VALIDATE_STATUS|WebGL: INVALID|CONTEXT_LOST/.test(s)),[]);
} catch(error) {
  report.failure=String(error); process.exitCode=1;
  await shot('failure').catch(()=>{});
} finally {
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({checks:report.checks.map(x=>x.name),failure:report.failure,pageErrors:report.pageErrors,evidence:out}));
