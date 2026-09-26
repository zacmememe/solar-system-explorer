// Normal UI reaches every pose. Explicit diagnostic pairs swap only terrain geometry, then restore.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sampleBrowserPerformance} from './lib/browser-performance.ts';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/minimal-hud-gale/gale-final';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={images:[],pairs:[],errors:[],consoleErrors:[],httpErrors:[],performance:[],visualAcceptance:'NOT_OBSERVED',method:'All travel/pose/time changes use UI. Explicit A/B swaps only DTM geometry; rocks keep candidate placement in both. Layer isolation is diagnostic, not acceptance.'};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
const click=id=>page.click(`[data-testid="${id}"]`);
async function state(){return page.evaluate(()=>{
 const e=window.__solarEngine,t=e.getLandingTelemetry(),mesh=e.getMarsTerrainMesh(),pose=e.getBodyWorldPose('mars');
 const scale=pose.surfaceRadius/(t.site.datumRadiusKm*1000),up=e.camera.position.clone().sub(pose.pos).normalize();
 e.raycaster.set(e.camera.position.clone().addScaledVector(up,100*scale),up.clone().negate());
 const hit=e.raycaster.intersectObject(mesh,false)[0];
 return {position:e.camera.position.toArray(),quaternion:e.camera.quaternion.toArray(),camera:e.getCameraSnapshot(),time:e.getSimTimeHours(),telemetry:t,clearanceM:hit?hit.distance/scale-100:null,refined:!!mesh.geometry.userData.localRefinement,triangles:mesh.geometry.index.count/3};
});}
async function shot(name){const meta=await state();await page.screenshot({path:path.join(out,name+'.png')});report.images.push({name,...meta});console.log('captured',name);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));return meta;}
async function pair(name,perf=false){
 const fine=await shot(name+'-fine');
 if(perf)report.performance.push(await sampleBrowserPerformance(page,'fine-before'));
 try{
  await page.evaluate(()=>{const e=window.__solarEngine;e.getMarsTerrainMesh().geometry=window.__galeCoarse;});await delay(350);
  const coarse=await shot(name+'-coarse');
  assert.deepEqual(coarse.position,fine.position);assert.deepEqual(coarse.quaternion,fine.quaternion);assert.equal(coarse.time,fine.time);
  if(perf)report.performance.push(await sampleBrowserPerformance(page,'coarse'));
  report.pairs.push({name,fine,coarse,identicalCameraAndTime:true});
 }finally{await page.evaluate(()=>{window.__solarEngine.getMarsTerrainMesh().geometry=window.__galeFine;});await delay(350);}
 if(perf)report.performance.push(await sampleBrowserPerformance(page,'fine-after'));
}
async function drag(dx,dy=0){await page.mouse.move(780,420);await page.mouse.down();await page.mouse.move(780+dx,420+dy,{steps:24});await page.mouse.up();await delay(700);}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5205',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
 report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('planet-btn-mars');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='mars'&&!c.isTransitioning;},{timeout:45000});
 await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]','gale-murray-buttes');
 await page.waitForFunction(()=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId==='gale-murray-buttes'&&['land','travel-to-site'].includes(a.action);},{timeout:90000});
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]');
 if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await click('lunar-landing-travel-site-btn');
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});await click('lunar-landing-start-btn');
 await page.waitForFunction(()=>{const e=window.__solarEngine,t=e.getLandingTelemetry(),a=e.getCameraSnapshot().anchor;return t.state==='DESCENDING'&&a?.kind==='surface'&&a.eyeHeightM<550;},{timeout:160000,polling:50});await click('landing-btn-hold');await delay(500);
 report.geometry=await page.evaluate(()=>{const e=window.__solarEngine,s=e.marsSiteStacks.get('gale-murray-buttes');window.__galeFine=e.getMarsTerrainMesh().geometry;window.__galeCoarse=s.dtm.buildDemWindowGeometry(e.marsBaseRadius);return {baseRadius:e.marsBaseRadius,refined:!!window.__galeFine.userData.localRefinement,fine:window.__galeFine.index.count/3,coarse:window.__galeCoarse.index.count/3};});
 assert.equal(report.geometry.refined,true);assert.equal(report.geometry.fine,583678);assert.equal(report.geometry.coarse,457084);
 await pair('01-low-hold');await click('landing-btn-resume');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:60000});await delay(1800);
 await pair('02-ground',true);const grounded=report.pairs.at(-1);assert.ok(Math.abs(grounded.fine.clearanceM-1.7)<.12,`fine clearance ${grounded.fine.clearanceM}`);assert.ok(Math.abs(grounded.fine.clearanceM-1.7)<Math.abs(grounded.coarse.clearanceM-1.7));
 await drag(300);await pair('03-left');await drag(-600);await pair('04-right');
 // Reach the earlier reported southeast color edge by ordinary drag, not private pose writes.
 for(let i=0;i<5;i++){
  const yaw=await page.evaluate(()=>window.__solarEngine.getCameraSnapshot().surfaceOrientation.yawDeg);
  const delta=((127-yaw+540)%360)-180;if(Math.abs(delta)<.5)break;
  await drag(Math.max(-500,Math.min(500,-delta/.2865)));
 }
 await shot('diag-southeast-normal');
 // Identify which existing regional layer owns the distant color edge without modifying shipped code.
 report.isolation=[];
 for(const name of ['mola-l1-regional-terrain','mola-l1-boundary-skirt','mola-l1-window-rim']){
  const exists=await page.evaluate(name=>{const s=window.__solarEngine.marsSiteStacks.get('gale-murray-buttes'),m=s.group.getObjectByName(name);if(!m)return false;window.__isolatedLayer={m,visible:m.visible};m.visible=false;return true;},name);
  if(!exists){report.isolation.push({name,found:false});continue;}
  try{await delay(300);await shot('diag-hide-'+name);report.isolation.push({name,found:true});}
  finally{await page.evaluate(()=>{const {m,visible}=window.__isolatedLayer;m.visible=visible;delete window.__isolatedLayer;});}
 }
 await drag(0,-240);await shot('05-sky-normal');
 await click('landing-btn-return-orbit');await page.waitForFunction(()=>{const e=window.__solarEngine;return e.getLandingTelemetry().state==='ORBIT'&&!e.getCameraSnapshot().isTransitioning;},{timeout:60000});await delay(1500);await shot('06-returned-normal');
 assert.equal(report.errors.length+report.consoleErrors.length+report.httpErrors.length,0);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{
 await page.evaluate(()=>{if(window.__galeFine)window.__solarEngine.getMarsTerrainMesh().geometry=window.__galeFine;window.__galeCoarse?.dispose();delete window.__galeCoarse;delete window.__galeFine;}).catch(()=>{});
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();
}
console.log(JSON.stringify({pairs:report.pairs.length,images:report.images.length,failure:report.failure,errors:report.errors,consoleErrors:report.consoleErrors,httpErrors:report.httpErrors}));
