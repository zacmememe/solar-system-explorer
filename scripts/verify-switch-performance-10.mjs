// Continuous sampling starts before app code; click-to-frame includes synchronous handlers.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/switch-performance-10/baseline';
await fs.mkdir(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={indexSha256:sha(await fs.readFile('dist/index.html')),cases:[],errors:[],note:'New HTTP profile; OS/GPU driver cache not cleared. RAF intervals include GPU/scheduling; longtask is main-thread evidence.'};
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});
let browser,page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile'),defaultViewport:{width:1920,height:1080,deviceScaleFactor:1},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.evaluateOnNewDocument(()=>{
   const log=window.__perf10={frames:[],longtasks:[],events:[],resources:[]};
   const tick=t=>{log.frames.push(t);requestAnimationFrame(tick);};requestAnimationFrame(tick);
   new PerformanceObserver(list=>{for(const e of list.getEntries())log.longtasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
   new PerformanceObserver(list=>{for(const e of list.getEntries())log.resources.push({name:e.name,start:e.startTime,end:e.responseEnd,bytes:e.transferSize});}).observe({type:'resource',buffered:true});
   for(const type of ['click','change'])document.addEventListener(type,e=>log.events.push({type,start:performance.now(),id:e.target.closest('[data-testid]')?.dataset.testid,value:e.target.value}),true);
 });
 const mark=()=>page.evaluate(()=>performance.now());
 const finish=async(name,start)=>{
   const end=await mark();await delay(120);
   const data=await page.evaluate(({start,end})=>{
     const l=window.__perf10,e=window.__solarEngine,frames=l.frames.filter(t=>t>=start&&t<=end);
     const all=l.frames,intervals=[];for(let i=1;i<all.length;i++)if(all[i]>=start&&all[i-1]<=end)intervals.push(all[i]-all[i-1]);
     intervals.sort((a,b)=>a-b);
     return {start,end,duration:end-start,firstRafMs:frames[0]-start,frames:frames.length,p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:Math.max(...intervals),over50:intervals.filter(t=>t>50).length,
       longtasks:l.longtasks.filter(t=>t.start+t.duration>=start&&t.start<=end),events:l.events.filter(t=>t.start>=start&&t.start<=end),resources:l.resources.filter(t=>t.end>=start&&t.start<=end),
       renderer:{memory:e.renderer.info.memory,programs:e.renderer.info.programs.length},camera:e.getCameraSnapshot(),availability:e.getLandingAvailability()};
   },{start,end});
   report.cases.push({name,...data});console.log(name,JSON.stringify({duration:data.duration,maxMs:data.maxMs,longestTask:Math.max(0,...data.longtasks.map(t=>t.duration))}));
   await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 };
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__solarEngine?.moonSiteStacks?.get('taurus-littrow')?.built,{timeout:90000});
 await delay(3000);await finish('startup-default-terrain',0);
 report.bundles=await page.$$eval('script[src]',els=>els.map(e=>new URL(e.src).pathname));
 report.browser=await browser.version();
 const travel=async(id,label)=>{
   await delay(1000);const start=await mark();
   await page.click(`[data-testid="${id==='moon'?'moon':'planet'}-btn-${id}"]`);
   await page.waitForFunction(id=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId===id&&!c.isTransitioning;},{timeout:60000},id);
   await delay(400);await finish(label,start);
 };
 for(const phase of ['first','warm'])for(const id of ['earth','saturn','earth','moon','mars','earth'])await travel(id,`${phase}-${id}-${report.cases.length}`);
 await travel('moon','prepare-moon');
 for(const site of ['tranquility-base','hadley-rille','tranquility-base']){
   const start=await mark();await page.select('[data-testid="landing-site-select"]',site);
   await page.waitForFunction(site=>window.__solarEngine.moonSiteStacks.get(site)?.built,{timeout:90000},site);
   await delay(1000);await finish(`site-${site}-${report.cases.length}`,start);
 }
 await page.screenshot({path:path.join(out,'final-ui.png')});
 report.raw=await page.evaluate(()=>window.__perf10);
 assert.deepEqual(report.errors,[]);assert.equal(sha(await fs.readFile('dist/index.html')),report.indexSha256);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.httpServer.close(r));}
console.log(JSON.stringify({result:report.result,failure:report.failure,errors:report.errors}));
