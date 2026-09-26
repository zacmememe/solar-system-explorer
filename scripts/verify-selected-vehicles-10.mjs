import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/selected-vehicles-10/final';
await fs.mkdir(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={indexSha256:sha(await fs.readFile('dist/index.html')),cases:[],errors:[],checks:[]};
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});
let browser,page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile'),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
 const click=id=>page.click(`[data-testid="${id}"]`);
 const ready=()=>page.waitForFunction(()=>document.querySelector('[data-testid="hangar-3d-viewport"]')?.dataset.loadState==='ready'&&!document.querySelector('[data-testid="hangar-board-btn"]').disabled,{timeout:45000});
 const shot=async name=>{
   const state=await page.evaluate(()=>{const e=window.__solarEngine,g=e.currentVehicleMesh,mats=[];
     g?.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!mats.some(a=>a.uuid===m.uuid))mats.push({uuid:m.uuid,name:m.name,side:m.side,metalness:m.metalness,opacity:m.opacity,transparent:m.transparent});});
     let maxNdc=0;
     if(g){g.updateWorldMatrix(true,true);const b=g.userData.box;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
       const p=b.min.clone().set(x,y,z).applyMatrix4(g.matrixWorld).applyMatrix4(e.camera.matrixWorldInverse).applyMatrix4(e.camera.projectionMatrix);maxNdc=Math.max(maxNdc,Math.abs(p.x),Math.abs(p.y));}}
     return {maxNdc,camera:e.getCameraSnapshot(),selected:e.getCurrentVehicle(),view:e.getViewCameraMode(),visible:e.vehicleGroup.visible,rotation:e.vehicleGroup.rotation.toArray(),model:g?{id:g.userData.vehicleId,maxDim:g.userData.maxDim,scale:g.scale.toArray(),metric:g.getObjectByName('vehicle-metric-root')?.scale.toArray()}:null,mats,display:e.lastFrameRenderInfo,
       text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth};});
   await page.screenshot({path:path.join(out,name+'.png')});report.cases.push({name,...state});console.log('captured',name);return state;
 };
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('earth'));
 report.bundles=await page.$$eval('script[src]',els=>els.map(e=>new URL(e.src).pathname));
 await click('planet-btn-earth');await page.waitForFunction(()=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId==='earth'&&!s.isTransitioning;},{timeout:60000});
 await page.click('[aria-controls="hud-observe-panel"]');if(await page.$('[aria-label="暂停天体时间"]'))await page.click('[aria-label="暂停天体时间"]');await page.keyboard.press('Escape');
 for(const id of ['iss','cassini','voyager-1','juno','space-shuttle']){
   await click('toolbar-hangar-btn');await click('hangar-vehicle-item-'+id);await ready();await delay(1600);
   assert.equal(await page.$$eval('[data-testid^="hangar-vehicle-item-"]',a=>a.length),5);
   assert.equal(await page.$('[data-testid="hangar-scale-toggle-btn"]'),null);
   await shot(id+'-01-studio');await click('hangar-light-toggle-btn');await delay(250);await shot(id+'-02-sun');
   if(id==='juno'){
     // Normal pointer gestures stop auto-spin and inspect the formerly clipped wing.
     const v=await page.$('[data-testid="hangar-3d-viewport"]'),b=await v.boundingBox();
     for(const [i,dx,dy] of [[1,160,0],[2,120,190],[3,-160,-300]]){
       await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:12});await page.mouse.up();await delay(150);await shot('juno-drag-'+i);
     }
   }
   await click('hangar-board-btn');await page.waitForFunction(id=>window.__solarEngine.getCurrentVehicle()===id&&window.__solarEngine.vehicleGroup.visible,{timeout:45000},id);await delay(800);
   const s=await shot(id+'-03-formation');assert.equal(s.selected,id);assert.equal(s.view,'VEHICLE_FORMATION');
   assert(s.maxNdc<=.921,'desktop vehicle fits');
   if(id==='juno')assert(s.mats.filter(m=>/solar_panels|shiny_panels/.test(m.name)).every(m=>m.metalness===0));
   if(id==='space-shuttle'){assert(Math.abs(s.rotation[0]-.24)<1e-8);assert(Math.abs(s.rotation[1]-(Math.PI+.58))<1e-8);}
   // A second independent preview must not destroy the current main model.
   await click('toolbar-hangar-btn');await ready();await click('hangar-close-btn');await delay(200);
   assert.equal(await page.evaluate(()=>window.__solarEngine.getCurrentVehicle()),id);
   await page.click('[aria-label="结束伴飞"]');await delay(200);assert.equal(await page.evaluate(()=>window.__solarEngine.getCurrentVehicle()),null);
   report.checks.push(id+': preview two lights, formation, concurrent preview, clear');
 }
 await page.setViewport({width:390,height:844});
 for(const id of ['iss','cassini','voyager-1','juno','space-shuttle']){
   await click('toolbar-hangar-btn');await click('hangar-vehicle-item-'+id);await ready();await delay(300);
   const narrow=await shot('narrow-'+id+'-preview');assert.equal(narrow.overflow,false);
   const action=await page.$('[data-testid="hangar-board-btn"]');await action.scrollIntoView();await click('hangar-board-btn');
   await page.waitForFunction(id=>window.__solarEngine.getCurrentVehicle()===id&&window.__solarEngine.vehicleGroup.visible,{timeout:45000},id);await delay(300);
   const formation=await shot('narrow-'+id+'-formation');assert(formation.maxNdc<=.921,'portrait vehicle fits');
   await page.setViewport({width:1920,height:1080});await delay(100);const restored=await shot('resized-'+id);assert(restored.maxNdc<=.921);
   await page.click('[aria-label="结束伴飞"]');await delay(100);await page.setViewport({width:390,height:844});
 }
 assert.deepEqual(report.errors,[]);assert.equal(sha(await fs.readFile('dist/index.html')),report.indexSha256);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.httpServer.close(r));}
console.log(JSON.stringify({result:report.result,cases:report.cases.length,failure:report.failure,errors:report.errors}));
