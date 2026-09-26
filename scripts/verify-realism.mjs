// All navigation/time/camera changes use UI. Engine reads are diagnostics only.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sampleBrowserPerformance} from './lib/browser-performance.ts';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/surface-realism';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,`profile-${process.pid}`),defaultViewport:{width:1440,height:900},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const report={images:[],errors:[],consoleErrors:[],performance:[],failedRequests:[],visualAcceptance:'NOT_OBSERVED'};
page.on('response',r=>{if(r.status()>=400)report.failedRequests.push({url:r.url(),status:r.status()});});
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
async function toggleAtmosphere(){
 const h=await page.evaluateHandle(()=>[...document.querySelectorAll('button.hud-setting')].find(e=>e.textContent.startsWith('大气微光')));
 if(!h.asElement())throw Error('Atmosphere button missing');await h.asElement().click();await h.dispose();
}
async function shot(name){
 const state=await page.evaluate(()=>{const e=window.__solarEngine;return {camera:e.getCameraSnapshot(),time:e.getSimTimeHours(),landing:e.getLandingTelemetry(),availability:e.getLandingAvailability(),exposure:e.renderer.toneMappingExposure,atmosphere:e.getMarsAtmosphereDiagnostics?.()};});
 await page.screenshot({path:path.join(out,name+'.png')}); console.log('captured',name);report.images.push({name,...state});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
async function travel(id,moon=false){console.log('travel',id);await page.click(`[data-testid="${moon?'moon':'planet'}-btn-${id}"]`);await page.waitForFunction(id=>{const s=window.__solarEngine.getCameraSnapshot();return s.targetBodyId===id&&!s.isTransitioning;},{timeout:45000},id);await wait(700);}
async function drag(dx,dy=0){await page.mouse.move(650,440);await page.mouse.down();await page.mouse.move(650+dx,440+dy,{steps:30});await page.mouse.up();await wait(350);}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5203',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
 report.bundle=await page.$$eval('script[src]',xs=>xs.map(x=>x.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 if(process.env.REALISM_CASE==='bodies'){
   const groups=await page.evaluate(()=>[...window.__solarEngine.bodyNodes].filter(([,n])=>n.data.type!=='moon').map(([id])=>({id,moons:[...window.__solarEngine.bodyNodes].filter(([,n])=>n.data.type==='moon'&&n.data.parentId===id).map(([id])=>id)})));
   for(const g of groups){await travel(g.id);await shot(g.id);for(const id of g.moons){await travel(id,true);await shot(id);}}
 }else{
  for(const id of (process.env.SITE_IDS||'jezero').split(',')){
   const moon=['taurus-littrow','hadley-rille','tranquility-base'].includes(id);
   if(moon){await travel('earth');await travel('moon',true);}else await travel('mars');
   await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]',id);
   await page.waitForFunction(id=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId===id&&['land','travel-to-site'].includes(a.action);},{timeout:90000},id);
   await page.waitForFunction(()=>{
     const a=window.__solarEngine.getLandingAvailability();
     const id=a.action==='land'?'lunar-landing-start-btn':a.action==='travel-to-site'?'lunar-landing-travel-site-btn':null;
     const button=id&&document.querySelector('[data-testid="'+id+'"]');return button&&!button.disabled;
   },{timeout:45000});
   const go=await page.$('[data-testid="lunar-landing-travel-site-btn"]');if(go)await go.click();
   await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});await page.click('[data-testid="lunar-landing-start-btn"]');
   const captured=new Set(),start=Date.now();let landed=false;
   while(Date.now()-start<160000){await wait(750);const t=await page.evaluate(()=>window.__solarEngine.getLandingTelemetry());for(const h of [150000,50000,5000,500])if(t.altitudeAGLM<h&&!captured.has(h)){captured.add(h);await shot(id+'-descent-'+h);if(h===5000&&t.state==='DESCENDING'){await page.click('[data-testid="landing-btn-hold"]');await wait(400);await drag(60);await shot(id+'-hold');await page.click('[data-testid="landing-btn-resume"]');}}if(t.state==='SURFACE_LOOK'){landed=true;break;}}
   if(!landed)throw Error('Landing timeout '+id);
   await wait(1800);report.performance.push(await sampleBrowserPerformance(page,id+'-ground'));await shot(id+'-ground');await drag(260);await shot(id+'-left');await drag(-520);await shot(id+'-right');
   await drag(0,-260);await shot(id+'-sky');await drag(300);await shot(id+'-sky-opposite');
   if(process.env.SKY_CYCLE==='1'&&!moon&&id==='jezero'){
     for(const phase of ['twilight','night']){
       await page.click('[aria-label="调整时间流速"]');await page.click('[data-speed="21600"]');await page.click('[aria-label="关闭面板"]');
       if(await page.$('[aria-label="继续模拟"]'))await page.click('[aria-label="继续模拟"]');
       await page.waitForFunction(phase=>{const a=window.__solarEngine.getMarsAtmosphereDiagnostics();return phase==='night'?a.sunHeight<-.4:a.sunHeight>-.07&&a.sunHeight<.07;},{timeout:45000,polling:50},phase);
       await page.click('[aria-label="暂停模拟"]');await wait(1000);
       await page.click('[data-testid="landing-btn-reset-look"]');await wait(800);
       await shot(id+'-'+phase+'-horizon');if(phase==='night')await drag(0,-80);
       for(let i=0;i<4;i++){await shot(id+'-'+phase+'-sky-'+i);await drag(300);}
     }
     await page.click('[aria-controls="hud-observe-panel"]');
     await toggleAtmosphere();await page.click('[aria-label="关闭面板"]');await wait(3600);await shot(id+'-atmosphere-off');
     if(report.images.at(-1).atmosphere.density>.001)throw Error('Atmosphere did not clear after toggle');
     await page.click('[aria-controls="hud-observe-panel"]');await toggleAtmosphere();await page.click('[aria-label="关闭面板"]');await wait(1500);
     await page.click('[aria-label="调整时间流速"]');await page.click('[data-speed="1"]');await page.click('[aria-label="关闭面板"]');
   }
   await page.click('[data-testid="landing-btn-return-orbit"]');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT'&&!window.__solarEngine.getCameraSnapshot().isTransitioning,{timeout:50000});await wait(3500);await shot(id+'-returned');
  }
 }
 if(report.errors.length||report.consoleErrors.length)process.exitCode=1;
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({images:report.images.length,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure}));
