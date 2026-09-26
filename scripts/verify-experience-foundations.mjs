// User journeys: all writes go through real UI. Engine access below is read-only diagnostics.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {journeyAction,timePanel} from './lib/hud-ui.mjs';
const out=process.env.EVIDENCE_DIR || 'D:/solar-evidence/experience-foundations';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,`profile-${process.pid}`),defaultViewport:{width:1440,height:900},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(), delay=ms=>new Promise(r=>setTimeout(r,ms));
let injectingFailure=false;
const report={expectedResourceErrors:[],url:process.env.TEST_URL || 'http://127.0.0.1:5201',checks:[],errors:[],consoleErrors:[],visualAcceptance:'NOT_OBSERVED'};
try {report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();} catch {report.commit='UNKNOWN';}
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')(injectingFailure?report.expectedResourceErrors:report.consoleErrors).push(m.text());});
const click=id=>page.click(`[data-testid="${id}"]`);
const shot=name=>page.screenshot({path:path.join(out,`${name}.png`)});
const snap=()=>page.evaluate(()=>window.__solarEngine.getCameraSnapshot());
async function travel(id,moon=false) {await click(`${moon?'moon':'planet'}-btn-${id}`);await page.waitForFunction(id=>window.__solarEngine.getCameraSnapshot().targetBodyId===id&&!window.__solarEngine.getCameraSnapshot().isTransitioning,{timeout:30000},id);await delay(200);}
async function drag(dx,dy=0){await page.mouse.move(660,440);await page.mouse.down();await page.mouse.move(660+dx,440+dy,{steps:Math.max(1,Math.ceil(Math.abs(dx)/15))});await page.mouse.up();await delay(150);}
async function buttonText(text){const el=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text),text);assert.ok(el.asElement(),`button ${text} missing`);await el.asElement().click();await el.dispose();}
async function save(name) {
  await click('toolbar-bookmark-btn');await click('bookmark-tab-custom');
  const before=await page.$$eval('[data-testid^="bookmark-fly-"]',els=>els.map(e=>e.getAttribute('data-testid')));
  await click('bookmark-btn-add');await page.click('[data-testid="bookmark-save-title-input"]',{clickCount:3});await page.type('[data-testid="bookmark-save-title-input"]',name);await click('bookmark-save-submit-btn');
  const ids=await page.$$eval('[data-testid^="bookmark-fly-"]',els=>els.map(e=>e.getAttribute('data-testid')));
  const id=ids.find(id=>!before.includes(id));assert.ok(id,'new bookmark was not saved');
  await click('bookmark-modal-close-btn');return id;
}
async function restore(id){await click('toolbar-bookmark-btn');await click('bookmark-tab-custom');await click(id);await delay(400);}
async function test(name,fn){console.log('START',name);try{const detail=await fn();report.checks.push({name,pass:true,detail});console.log('PASS',name);}catch(e){report.checks.push({name,pass:false,error:String(e),diagnostic:await page.evaluate(()=>({camera:window.__solarEngine?.getCameraSnapshot(),landing:window.__solarEngine?.getLandingTelemetry(),availability:window.__solarEngine?.getLandingAvailability()})).catch(()=>null)});await shot(`${name}-FAIL`).catch(()=>{});console.log('FAIL',name,String(e));}finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}}
try {
  await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));report.browser=await browser.version();
  const suite=process.env.FOUNDATION_CASE || 'all';
  if(suite==='all'||suite==='core') {
    await test('planet-navigation',async()=>{
      for(const id of ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']){await travel(id);const s=await snap();assert.ok(Number.isFinite(s.distanceToTarget));assert.ok(s.distanceToTarget>s.minDistance);await shot(`orbit-${id}`);}
      await travel('mars');await travel('phobos',true);const before=await snap();await page.mouse.move(660,440);await page.mouse.wheel({deltaY:-80});await delay(900);const close=await snap();assert.ok(close.distanceToTarget<before.distanceToTarget);await page.mouse.wheel({deltaY:80});await delay(900);assert.ok((await snap()).distanceToTarget>close.distanceToTarget);await shot('phobos-zoom');
    });
    await test('interrupt-and-idle',async()=>{
      await click('planet-btn-earth');await delay(80);await click('planet-btn-saturn');await delay(100);await drag(30);assert.equal((await snap()).isTransitioning,false);const a=await snap();await delay(1500);const b=await snap();assert.ok(Math.abs(a.spherical.theta-b.spherical.theta)<1e-8);assert.ok(Math.abs(a.spherical.phi-b.spherical.phi)<1e-8);await shot('interrupted');await travel('earth');
    });
    await test('time-and-observation',async()=>{
      await page.click('[aria-label="暂停模拟"]');const t=await page.evaluate(()=>window.__solarEngine.getSimTimeHours());await delay(500);assert.equal(await page.evaluate(()=>window.__solarEngine.getSimTimeHours()),t);
      await click('earth-observation-mode-btn');await delay(500);assert.equal(await page.evaluate(()=>window.__solarEngine.getSimTimeHours()),t);await shot('terrain-study');await click('earth-observation-mode-btn');
      await timePanel(page);await page.click('[data-speed="10"]');await page.keyboard.press('Escape');
      await page.click('[aria-controls="hud-observe-panel"]');await page.waitForFunction(()=>document.querySelector('.hud-rate')?.textContent.replace(/\s/g,'')==='10×');assert.equal(await page.$eval('.hud-rate',e=>e.textContent.replace(/\s/g,'')),'10×');await page.keyboard.press('Escape');
    });
    await test('orbit-bookmark',async()=>{
      await travel('earth');await drag(125,30);const before=await snap(),id=await save('QA orbit');await travel('saturn');await restore(id);await page.waitForFunction(()=>window.__solarEngine.getCameraSnapshot().targetBodyId==='earth'&&!window.__solarEngine.getCameraSnapshot().isTransitioning);
      const after=await snap();for(const k of ['radius','phi','theta'])assert.ok(Math.abs(before.spherical[k]-after.spherical[k])<1e-5,`bookmark ${k}`);await shot('orbit-restored');return {before,after};
    });
    await test('vehicle-and-postcard',async()=>{
      await click('toolbar-hangar-btn');await page.waitForSelector('[data-testid="hangar-board-btn"]');await click('hangar-board-btn');await page.waitForFunction(()=>window.__solarEngine.currentVehicleMesh && window.__solarEngine.vehicleGroup.visible,{timeout:30000});await delay(500);
      if(await page.$('[data-testid="hangar-close-btn"]'))await click('hangar-close-btn');await shot('vehicle-formation');assert.ok(await page.evaluate(()=>window.__solarEngine.getCurrentVehicle()));
      await click('toolbar-clear-vehicle-btn');await delay(300);assert.equal(await page.evaluate(()=>window.__solarEngine.getCurrentVehicle()),null);
      await page.click('[aria-label="探索明信片"]');await delay(1600);await shot('postcard');
      const close=await page.$('[aria-label="关闭明信片"]');if(close)await close.click();else await page.keyboard.press('Escape');
    });
    await test('responsive-controls',async()=>{
      for(const [w,h] of [[1280,720],[390,844],[844,390]]){await page.setViewport({width:w,height:h});await travel('earth');await delay(300);await shot(`viewport-${w}x${h}`);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);}
      await page.setViewport({width:1440,height:900});
    });
  }
  if(suite==='all'||suite==='sites') {
    const sites=(process.env.SITE_IDS || 'taurus-littrow,hadley-rille,tranquility-base,jezero,victoria-duck-bay,gale-murray-buttes').split(',');
    for(const id of sites) await test(id,async()=>{
      const moon=['taurus-littrow','hadley-rille','tranquility-base'].includes(id), body=moon?'moon':'mars';
      if(moon){await travel('earth');await travel('moon',true);}else await travel('mars');
      await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]',id);
      await page.waitForFunction(id=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId===id&&['land','travel-to-site'].includes(a.action);},{timeout:60000},id);
      await page.waitForFunction(()=>{
        const a=window.__solarEngine.getLandingAvailability();
        return a.action==='land' ? !!document.querySelector('[data-testid="lunar-landing-start-btn"]')
          : a.action==='travel-to-site' && !!document.querySelector('[data-testid="lunar-landing-travel-site-btn"]');
      },{timeout:30000});if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await click('lunar-landing-travel-site-btn');
      await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:30000});await click('lunar-landing-start-btn');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='DESCENDING',{timeout:30000});
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="mission-hud"]').dataset.timeScale)===window.__solarEngine.getTimeScale());
      const direction=await page.evaluate(()=>{const c=window.__solarEngine.camera;return c.getWorldDirection(c.position.clone()).toArray();});await drag(10);assert.equal(await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().state),'HOLD');
      const directionAfter=await page.evaluate(()=>{const c=window.__solarEngine.camera;return c.getWorldDirection(c.position.clone()).toArray();});const dot=direction.reduce((v,x,i)=>v+x*directionAfter[i],0);assert.ok(Math.acos(Math.min(1,dot))<0.12,'small drag snapped view');
      const held=await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().altitudeAGLM);await delay(400);assert.ok(Math.abs(await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().altitudeAGLM)-held)<0.02);await journeyAction(page,'landing-btn-reguide');await delay(500);await click('landing-btn-resume');
      const samples=[], captured=new Set();const start=Date.now();
      while(Date.now()-start<110000){await delay(1000);const t=await page.evaluate(()=>window.__solarEngine.getLandingTelemetry());samples.push(t);for(const threshold of [50000,5000])if(t.altitudeAGLM<threshold&&!captured.has(threshold)){await shot(`${id}-below-${threshold}`);captured.add(threshold);}if(t.state==='SURFACE_LOOK')break;}
      assert.equal(samples.at(-1)?.state,'SURFACE_LOOK');assert.equal(samples.at(-1)?.site.id,id);await shot(`${id}-ground`);
      const ground=await page.evaluate(()=>{
        const e=window.__solarEngine, t=e.getLandingTelemetry(), pose=e.getBodyWorldPose(t.site.bodyId), mesh=t.site.bodyId==='moon'?e.getLunarValleyMesh():e.getMarsTerrainMesh();
        const scale=pose.surfaceRadius/(t.site.datumRadiusKm*1000), up=e.camera.position.clone().sub(pose.pos).normalize();
        e.raycaster.set(e.camera.position.clone().addScaledVector(up,100*scale),up.clone().negate());
        const hit=e.raycaster.intersectObject(mesh,false)[0];
        return {telemetry:t,displayedClearanceM:hit?hit.distance/scale-100:null,activeMoon:e.activeMoonSiteId,activeMars:e.activeMarsSiteId,opacity:mesh.material.opacity};
      });
      report.lastSurface=ground;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
      await drag(260);await shot(`${id}-left`);await drag(-520);await shot(`${id}-right`);
      const orientation=await page.evaluate(()=>({camera:window.__solarEngine.getCameraSnapshot().surfaceOrientation,telemetry:window.__solarEngine.getLandingTelemetry()}));
      assert.ok(Math.abs(orientation.camera.yawDeg-orientation.telemetry.surfaceYawDeg)<0.11,'surface HUD yaw is stale');
      assert.ok(Math.abs(orientation.camera.pitchDeg-orientation.telemetry.surfacePitchDeg)<0.11,'surface HUD pitch is stale');
      await click('hud-site-details');assert.equal(await page.$eval('[data-testid="telemetry-agl-detail"]',e=>e.textContent.trim()),'1.7 m');await page.keyboard.press('Escape');
      const savedClock=await page.evaluate(()=>({paused:window.__solarEngine.isPaused,speed:window.__solarEngine.getTimeScale()}));
      const before=await page.evaluate(()=>window.__solarEngine.getSurfaceStationPose()?.station);const bookmark=await save(`QA ${id}`);
      await click('landing-btn-return-orbit');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT'&&window.__solarEngine.getCameraSnapshot().mode==='ORBIT_TARGET',{timeout:45000});await shot(`${id}-returned`);
      await travel(moon?'mars':'earth');if(['hadley-rille','victoria-duck-bay'].includes(id)){await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));}await restore(bookmark);await page.waitForFunction(body=>window.__solarEngine.getCameraSnapshot().targetBodyId===body&&window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:60000},body);await delay(500);
      const restored=await page.evaluate(()=>({station:window.__solarEngine.getSurfaceStationPose()?.station,telemetry:window.__solarEngine.getLandingTelemetry()}));assert.deepEqual(await page.evaluate(()=>({paused:window.__solarEngine.isPaused,speed:window.__solarEngine.getTimeScale()})),savedClock);assert.equal(restored.telemetry.site.id,id);assert.ok(Math.abs(restored.station.latDeg-before.latDeg)<1e-6);assert.ok(Math.abs(restored.station.eyeHeightM-before.eyeHeightM)<1e-6);await shot(`${id}-bookmark-restored`);
      await click('landing-btn-return-orbit');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT',{timeout:45000});
      assert.ok(ground.displayedClearanceM!==null&&Math.abs(ground.displayedClearanceM-1.7)<0.6,`camera vs displayed ground ${ground.displayedClearanceM}m`);
      return {ground,restored,samples};
    });
  }
  if(suite==='all'||suite==='faults') await test('failed-terrain-can-exit',async()=>{
    // Deliberate failure injection is reported separately, never as a normal clean console.
    injectingFailure=true;await page.setRequestInterception(true);
    const intercept=request=>request.url().includes('/apollo15-v1/metadata.json')?request.abort('failed'):request.continue();
    page.on('request',intercept);
    try {
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
      await travel('earth');await travel('moon',true);await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]','hadley-rille');
      await page.waitForFunction(()=>window.__solarEngine.getLandingAvailability().reason==='assets-error',{timeout:30000});
      await page.waitForFunction(()=>document.querySelector('[data-testid="lunar-landing-wait"]')?.textContent.includes('装载失败'));
      assert.equal(await page.$('[data-testid="lunar-landing-start-btn"]'),null);await shot('terrain-unavailable');
      await travel('saturn');assert.equal((await snap()).targetBodyId,'saturn');assert.equal(await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().state),'ORBIT');
    } finally {await page.setRequestInterception(false);page.off('request',intercept);injectingFailure=false;}
  });
  report.performance=await page.evaluate(async()=>{
    const e=window.__solarEngine,start=performance.now(),frames=e.getRenderFrameCount(),intervals=[];let previous=start;
    await new Promise(resolve=>{const sample=now=>{intervals.push(now-previous);previous=now;if(now-start<2000)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});
    intervals.sort((a,b)=>a-b);
    return {engineFrames:e.getRenderFrameCount()-frames,elapsedMs:performance.now()-start,rafP95Ms:intervals[Math.floor(intervals.length*.95)],geometryCount:e.renderer.info.memory.geometries,textureCount:e.renderer.info.memory.textures,note:'single headless Edge session; RAF wall intervals, not GPU timing'};
  });
} catch(e){report.fatal=String(e);}finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks.map(({name,pass,error})=>({name,pass,error})),errors:report.errors,consoleErrors:report.consoleErrors,fatal:report.fatal,evidence:out}));
if(report.fatal||report.errors.length||report.consoleErrors.length||report.checks.some(c=>!c.pass))process.exitCode=1;
