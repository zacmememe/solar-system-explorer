import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/hud-time-15/final';
await fs.mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});
const report={errors:[],samples:[],frames:[],visualAcceptance:'NOT_OBSERVED'};
let browser,page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile'),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11']});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]',{timeout:90000});
 report.bundle=await page.$$eval('script[src]',es=>es.map(e=>e.src));
 const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png')});report.frames.push(name);console.log(name);};
 const speed=async value=>{
  if(await page.$('[data-testid="hud-speed-control"]')){
   for(let step=0;step<8;step++){
    const current=await page.$eval('[data-testid="hud-speed-value"]',e=>Number(e.dataset.speed));
    if(current===value)break;
    await page.click(`[data-testid="hud-speed-${current<value?'up':'down'}"]`);
    await page.waitForFunction(old=>Number(document.querySelector('[data-testid="hud-speed-value"]').dataset.speed)!==old,{},current);
   }
  }
  else{await page.click('[aria-controls="hud-observe-panel"]');await page.click('[aria-label="调整时间流速"]');await page.click(`[data-speed="${value}"]`);await page.keyboard.press('Escape');}
  await page.waitForFunction(v=>window.__solarEngine.getTimeScale()===v,{},value);
 };
 const travel=async id=>{await page.click(`[data-testid="planet-btn-${id}"]`);await page.waitForFunction(id=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId===id&&!s.isTransitioning;},{timeout:90000},id);};
 const measure=async(label,rate)=>{
  const result=await page.evaluate(async()=>{const e=window.__solarEngine;const before={time:e.getSimTimeHours(),wall:e.lastTime,spin:e.getBodyNode('earth').mesh.rotation.y};const rates=[];await new Promise(resolve=>{const start=performance.now();function tick(){rates.push(e.getTimeScale());if(performance.now()-start<1500)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});const after={time:e.getSimTimeHours(),wall:e.lastTime,spin:e.getBodyNode('earth').mesh.rotation.y};return {before,after,rates:[...new Set(rates)],effectiveScale:(after.time-before.time)*3600000/(after.wall-before.wall),earthSpinPerSimHour:(after.spin-before.spin)/(after.time-before.time)};});
  report.samples.push({label,rate,...result});assert.deepEqual(result.rates,[rate]);assert.ok(result.effectiveScale<=rate*1.03&&result.effectiveScale>=rate*.70,JSON.stringify(result));console.log(label,result.effectiveScale);
 };
 await speed(1000);await shot('01-clock-desktop');
 for(const id of ['earth','jupiter','venus','mercury','saturn','earth']){await travel(id);await measure('1000x-'+id,1000);}
 await speed(200);await travel('jupiter');await travel('earth');await measure('200x-after-repeat',200);
 await page.click('[aria-label="暂停模拟"]');await travel('sun');await speed(50);
 const paused=await page.evaluate(()=>window.__solarEngine.getSimTimeHours());await delay(500);assert.equal(await page.evaluate(()=>window.__solarEngine.getSimTimeHours()),paused);
 await page.click('[aria-label="继续模拟"]');await measure('50x-resumed',50);
 if(!process.env.BASELINE){
  assert.equal(await page.$('[data-testid="hud-navigation"]'),null);
  assert.ok(await page.$('[data-testid="hud-context-preview"]'));
  for(const [width,height] of [[2560,1440],[1440,900],[390,844]]){
   await page.setViewport({width,height});await delay(250);await speed(10);
   const rect=await page.$eval('[data-testid="hud-speed-control"]',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});assert.ok(rect.x>=0&&rect.y>=0&&rect.right<=width&&rect.bottom<=height);await shot('clock-'+width);
  }
  await page.click('[aria-label="暂停模拟"]');await speed(86400);
  assert.ok(await page.$eval('[data-testid="hud-speed-up"]',e=>e.disabled));await shot('clock-upper-limit');
  await speed(1);assert.ok(await page.$eval('[data-testid="hud-speed-down"]',e=>e.disabled));
  await speed(10);await page.click('[aria-label="继续模拟"]');
  await page.setViewport({width:1920,height:1080});await travel('earth');await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(()=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId==='moon'&&!s.isTransitioning;},{timeout:90000});
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"],[data-testid="lunar-landing-travel-site-btn"]',{timeout:90000});
  for(const width of [1920,1440,1024,390]){
   await page.setViewport({width,height:900});await delay(200);
   const layout=await page.evaluate(()=>{const h=document.querySelector('.hud-layout').getBoundingClientRect();const r=document.querySelector('.hud-context-graphic,.hud-task-arc').getBoundingClientRect();const controls=[...document.querySelectorAll('.hud-layout button,.hud-layout select')].map(e=>{const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {label:e.textContent,within:b.x>=0&&b.right<=innerWidth,hit:hit===e||e.contains(hit),overlapsMap:b.x<r.right&&b.right>r.x&&b.y<r.bottom&&b.bottom>r.y};});return {height:h.height,controls};});
   report.samples.push({label:'moon-layout-'+width,...layout});assert.ok(layout.controls.every(c=>c.within&&c.hit&&!c.overlapsMap),'moon controls must be reachable without overlapping the map: '+width);if(width>=1024)assert.ok(layout.height<=(width>1250?130:144));await shot('moon-'+width);
  }
  await page.setViewport({width:1920,height:1080});await speed(10);
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"],[data-testid="lunar-landing-travel-site-btn"]',{timeout:90000});
  if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await page.click('[data-testid="lunar-landing-travel-site-btn"]');
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:90000});await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForSelector('[data-testid="landing-btn-hold"]',{timeout:90000});await page.click('[data-testid="landing-btn-hold"]');
  await speed(200);await measure('manual-200x-in-hold',200);await shot('moon-hold-time');
  await page.click('[data-testid="landing-btn-return-hold"]');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT',{timeout:90000});
  await measure('manual-200x-after-return',200);
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.httpServer.close(r));}
console.log(JSON.stringify({result:report.result,failure:report.failure,errors:report.errors}));
