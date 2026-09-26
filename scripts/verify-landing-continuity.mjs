import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/landing-continuity/baseline';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1440,height:900},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
const page=await browser.newPage(),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={bundle:[],journeys:[],errors:[],visualAcceptance:'NOT_OBSERVED'};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const click=id=>page.click(`[data-testid="${id}"]`);
async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});}
async function recordStart(){await page.evaluate(()=>{
 const e=window.__solarEngine;window.__continuity={rows:[],stop:false};let start=performance.now(),previous=e.camera.quaternion.clone();
 function tick(){const c=e.getCameraSnapshot(),t=e.getLandingTelemetry(),body=e.getBodyWorldPose(t.site.bodyId),local=e.camera.position.clone().sub(body.pos).applyQuaternion(body.quaternion.clone().invert());
 window.__continuity.rows.push({ms:performance.now()-start,state:t.state,progress:t.progress,mode:c.mode,anchor:c.anchor?.kind,nearM:e.camera.near/body.surfaceRadius*t.site.datumRadiusKm*1000,transition:c.isTransitioning,lat:Math.asin(local.y/local.length())*180/Math.PI,lon:Math.atan2(-local.z,local.x)*180/Math.PI,datum:(local.length()/body.surfaceRadius-1)*t.site.datumRadiusKm*1000,position:e.camera.position.toArray(),quaternion:e.camera.quaternion.toArray(),angle:previous.angleTo(e.camera.quaternion),sim:e.getSimTimeHours(),blocked:c.navigationBlocked});previous.copy(e.camera.quaternion);if(!window.__continuity.stop)requestAnimationFrame(tick);}
 tick();
 });}
async function recordEnd(name){const frames=await page.evaluate(()=>{window.__continuity.stop=true;return window.__continuity.rows;});report.journeys.push({name,frames});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(name,JSON.stringify({frames:frames.length,start:frames[0]?.datum,min:Math.min(...frames.map(x=>x.datum)),end:frames.at(-1)?.datum,maxAngle:Math.max(...frames.map(x=>x.angle))}));
 if(process.env.CHECK_FIXED==='1'){
  assert.ok(frames.length>10);assert.ok(frames.every(f=>!f.blocked));
  assert.ok(Math.max(...frames.map(f=>f.sim))-Math.min(...frames.map(f=>f.sim))<1e-8,'paused journey must not jump time');
  if(name.includes('abort')||name.includes('return')){
   const ascent=frames.filter(f=>f.state==='ASCENDING');assert.ok(ascent.length>10);
   for(let i=1;i<ascent.length;i++)assert.ok(ascent[i].datum>=ascent[i-1].datum-.05,'ascent descended');
   const last=ascent.at(-1),end=frames.at(-1);assert.ok(Math.abs(end.lat-last.lat)<.001&&Math.abs(end.lon-last.lon)<.001,'completion moved to another site');
   assert.ok(end.datum>=last.datum-.05,'completion lost altitude');
   assert.ok(end.nearM<end.datum*.26,'orbit handoff clips the nearby globe');
   const handoff=frames.findIndex((f,i)=>i>0&&f.state==='ORBIT'&&frames[i-1].state==='ASCENDING');
   assert.ok(handoff>=0&&frames[handoff].angle<.035,'orbit handoff rotated abruptly');
  }
 }
 return frames;
}
async function drag(){await page.mouse.move(650,360);await page.mouse.down();await page.mouse.move(850,420,{steps:18});await page.mouse.up();}
async function arrived(body){await page.waitForFunction(body=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId===body&&c.mode==='ORBIT_TARGET'&&!c.isTransitioning;},{timeout:65000},body);await delay(400);}
async function selectSite(site){await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]',site);await page.waitForFunction(site=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId===site&&['land','travel-to-site'].includes(a.action);},{timeout:90000},site);}
async function land(){await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]');if(await page.$('[data-testid="lunar-landing-travel-site-btn"]')){await click('lunar-landing-travel-site-btn');}await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:60000});await click('lunar-landing-start-btn');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='DESCENDING',{timeout:90000});}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5207',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
 report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('planet-btn-mars');await arrived('mars');await selectSite('jezero');await land();await delay(3500);
 await recordStart();await shot('01-before-abort');await click('landing-btn-cancel');await delay(3500);await shot('02-abort-three-seconds');
 await arrived('mars');await shot('03-return-completed');await recordEnd('mars-high-abort');
 await selectSite('gale-murray-buttes');await recordStart();await land();await delay(1500);await shot('04-new-site-descent');await recordEnd('mars-change-site');
 await click('landing-btn-cancel');await arrived('mars');
 if(process.env.CHECK_FIXED==='1'){
  // The next departure is from the previous return's actual local orbital view.
  await selectSite('gale-murray-buttes');await land();
  await page.waitForFunction(()=>{const e=window.__solarEngine,c=e.getCameraSnapshot();return e.getLandingTelemetry().state==='DESCENDING'&&c.anchor?.kind==='surface'&&c.anchor.eyeHeightM<550;},{timeout:120000});
  await click('landing-btn-hold');await drag();await recordStart();await shot('05-low-hold-before-return');await click('landing-btn-return-hold');
  await delay(4000);await shot('06-low-return-climbing');await page.mouse.wheel({deltaY:150});await arrived('mars');await shot('07-low-return-completed');await recordEnd('mars-low-hold-return');
  await selectSite('jezero');
  // Start and cancel the explicit far-side travel or the preparing approach.
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]');
  await recordStart();
  if(await page.$('[data-testid="lunar-landing-travel-site-btn"]')){await click('lunar-landing-travel-site-btn');await delay(500);await drag();}
  else{await click('lunar-landing-start-btn');await page.waitForFunction(()=>window.__solarEngine.getLandingPreparationStatus().phase==='approach',{timeout:15000});await click('landing-btn-cancel-prep');}
  await delay(2500);assert.equal(await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().state),'ORBIT');assert.equal(await page.evaluate(()=>window.__solarEngine.getCameraSnapshot().isTransitioning),false);await shot('08-approach-cancelled');await recordEnd('mars-approach-cancel');
  await click('planet-btn-earth');await arrived('earth');await click('moon-btn-moon');await arrived('moon');await selectSite('tranquility-base');await land();await delay(3000);
  await recordStart();await shot('09-moon-high-abort-start');await click('landing-btn-cancel');await delay(3500);await shot('10-moon-high-abort-climb');await arrived('moon');await shot('11-moon-high-abort-completed');await recordEnd('moon-high-abort');
  await land();await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:120000});await drag();await recordStart();await shot('12-moon-ground-return-start');await click('landing-btn-return-orbit');await delay(6000);await drag();await shot('13-moon-return-user-look');await arrived('moon');await shot('14-moon-return-completed');await recordEnd('moon-ground-return');
  assert.equal(report.errors.length,0);
 }
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({errors:report.errors,failure:report.failure}));
