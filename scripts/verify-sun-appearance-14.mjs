// Normal UI solar observation; diagnostic isolation is separately labelled.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/sun-appearance-14/enhanced-final';
await fs.mkdir(out,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={indexSha256:hash(await fs.readFile('dist/index.html')),errors:[],expectedFaults:[],frames:[],visualAcceptance:'NOT_OBSERVED'};
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});
let browser,page,injectMissingTexture=false;const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile'),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'){
  const expected=injectMissingTexture&&(m.location().url?.includes('/sun/2k_sun.jpg')||m.text().includes('assets/textures/sun/2k_sun.jpg'));
  (expected?report.expectedFaults:report.errors).push(m.text());
 }});
 page.on('response',r=>{if(r.status()>=400){const expected=injectMissingTexture&&r.status()===503&&r.url().includes('/sun/2k_sun.jpg');(expected?report.expectedFaults:report.errors).push(`${r.status()} ${r.url()}`);}});
 const shot=async name=>{
  const state=await page.evaluate(()=>{const e=window.__solarEngine,n=e.getBodyNode('sun');return {snapshot:e.getCameraSnapshot(),time:e.getSimTimeHours(),exposure:e.renderer.toneMappingExposure,renderer:e.renderer.getContext().getParameter(e.renderer.getContext().RENDERER),sunRadius:e.getBodyWorldPose('sun').surfaceRadius,sunPosition:e.getBodyWorldPose('sun').pos.toArray(),cameraPosition:e.camera.position.toArray(),slices:e.lastFrameRenderInfo,uniforms:Object.fromEntries(Object.entries(e.sunMaterial.uniforms).filter(([k])=>k!=='sunTexture').map(([k,u])=>[k,u.value])),coronaVisible:n.coronaMesh.visible};});
  await page.screenshot({path:path.join(out,name+'.png')});report.frames.push({name,...state});console.log(name);return state;
 };
 const travel=async id=>{await page.click(`[data-testid="planet-btn-${id}"]`);await page.waitForFunction(id=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId===id&&!s.isTransitioning;},{timeout:60000},id);await delay(400);};
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const u=window.__solarEngine?.sunMaterial?.uniforms;return u&&(!u.hasSurfaceMap||u.hasSurfaceMap.value===1);},{timeout:90000});
 report.bundles=await page.$$eval('script[src]',es=>es.map(e=>new URL(e.src).pathname));
 await page.click('[aria-controls="hud-observe-panel"]');if(await page.$('[aria-label="暂停天体时间"]'))await page.click('[aria-label="暂停天体时间"]');await page.keyboard.press('Escape');
 await travel('sun');const standard=await shot('01-sun-default');assert.equal(standard.exposure,1.1);
 report.defaultFrameIntervals=await page.evaluate(async()=>{const times=[];await new Promise(resolve=>{let prev;function tick(t){if(prev!==undefined)times.push(t-prev);prev=t;if(times.length<90)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});const sorted=[...times].sort((a,b)=>a-b);return {medianMs:sorted[45],p95Ms:sorted[85],maxMs:sorted[89],sampleCount:times.length};});
 await page.evaluate(()=>{window.__sunNormalBookmark=window.__solarEngine.captureObservationSnapshot('sun normal UI diagnostic');});
 await page.mouse.move(960,490);await page.mouse.wheel({deltaY:-460});await delay(1300);await shot('02-sun-near');
 // Normal UI resume/pause: the effect follows the existing simulation clock.
 await page.click('[aria-label="继续模拟"]');const activityStart=await shot('02a-activity-start');
 await delay(3500);const activityEnd=await shot('02b-activity-end');assert.ok(activityEnd.time>activityStart.time);
 await page.click('[aria-label="暂停模拟"]');await delay(80);
 const pausedTime=await page.evaluate(()=>window.__solarEngine.getSimTimeHours());await delay(300);
 assert.equal(await page.evaluate(()=>window.__solarEngine.getSimTimeHours()),pausedTime);report.activityPauseResume='PASS';
 const beforeDrag=await page.evaluate(()=>window.__solarEngine.getCameraSnapshot().spherical);
 await page.mouse.move(960,490);await page.mouse.down();await page.mouse.move(1180,550,{steps:25});await page.mouse.up();await delay(400);const dragged=await shot('03-sun-drag');
 assert.ok(Math.abs(dragged.snapshot.spherical.theta-beforeDrag.theta)+Math.abs(dragged.snapshot.spherical.phi-beforeDrag.phi)>.01,'normal UI drag must actually move the view');
 // Readable diagnostic: remove just the halo, preserving pose/time/exposure.
 await page.evaluate(()=>{window.__solarEngine.getBodyNode('sun').coronaMesh.visible=false;});await delay(80);await shot('diag-no-corona');
 await page.evaluate(()=>{window.__solarEngine.getBodyNode('sun').coronaMesh.visible=true;});
 await page.mouse.wheel({deltaY:1600});await delay(1500);await shot('04-sun-far');
 await page.setViewport({width:390,height:844});await travel('sun');await shot('05-sun-portrait');
 if(!process.env.SUN_ONLY){
  await page.setViewport({width:1920,height:1080});await travel('earth');await shot('06-earth-regression');await travel('saturn');await shot('07-saturn-regression');
  // Fault injection is separate from the normal UI acceptance above. The only
  // allowed errors are the deliberately missing solar texture and its loader.
  injectMissingTexture=true;await page.setCacheEnabled(false);await page.setRequestInterception(true);
  page.on('request',r=>r.url().includes('/sun/2k_sun.jpg')?r.respond({status:503,body:'intentional solar texture failure'}):r.continue());
  const failureResponse=page.waitForResponse(r=>r.status()===503&&r.url().includes('/sun/2k_sun.jpg'));
  await page.reload({waitUntil:'domcontentloaded'});await failureResponse;
  await page.waitForFunction(()=>window.__solarEngine?.sunMaterial?.uniforms.hasSurfaceMap.value===0,{timeout:90000});
  await travel('sun');const fallback=await shot('08-sun-texture-fallback');assert.equal(fallback.uniforms.hasSurfaceMap,0);assert.ok(report.expectedFaults.length);
 }
 assert.deepEqual(report.errors,[]);assert.equal(hash(await fs.readFile('dist/index.html')),report.indexSha256);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.httpServer.close(r));}
console.log(JSON.stringify({result:report.result,frames:report.frames.length,errors:report.errors,failure:report.failure}));
