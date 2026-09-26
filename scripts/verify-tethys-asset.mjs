import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/mars-materials-body-assets/tethys';await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(),wait=ms=>new Promise(r=>setTimeout(r,ms)),report={images:[],errors:[],expectedFaults:[],visualAcceptance:'NOT_OBSERVED'};
let faultPhase=false;
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'){
 const expected=faultPhase&&(m.text().includes('tethys')||m.location().url?.includes('/tethys/'));
 (expected?report.expectedFaults:report.errors).push(m.text());
}});
page.on('response',r=>{if(r.status()>=400)(faultPhase&&r.url().includes('/tethys/')?report.expectedFaults:report.errors).push(r.status()+' '+r.url());});
async function travel(id,moon=false){await page.click(`[data-testid="${moon?'moon':'planet'}-btn-${id}"]`);await page.waitForFunction(id=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId===id&&!c.isTransitioning;},{timeout:50000},id);await wait(800);}
async function shot(name){const state=await page.evaluate(()=>{const e=window.__solarEngine,m=e.getBodyNode('tethys').mesh.material;return {camera:e.getCameraSnapshot(),time:e.getSimTimeHours(),texture:{src:m.map?.image?.src,width:m.map?.image?.width,height:m.map?.image?.height,offset:m.map?.offset.toArray(),repeat:m.map?.repeat.toArray(),flipY:m.map?.flipY,colorSpace:m.map?.colorSpace}};});await page.screenshot({path:path.join(out,name+'.png')});report.images.push({name,...state});console.log(name);return state;}
async function drag(dx){await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(800+dx,450,{steps:30});await page.mouse.up();await wait(500);}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5206',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('tethys'));
 report.bundle=await page.$$eval('script[src]',e=>e.map(x=>x.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await travel('saturn');await travel('tethys',true);
 await page.waitForFunction(()=>window.__solarEngine.getBodyNode('tethys').mesh.material.map?.image?.width===4096);
 const s=await shot('01-default-parent-background');assert.equal(s.texture.height,2048);assert.deepEqual(s.texture.offset,[0,0]);assert.deepEqual(s.texture.repeat,[1,1]);assert.equal(s.texture.flipY,true);
 await page.mouse.move(960,460);await page.mouse.wheel({deltaY:-550});await wait(1000);await shot('02-near');
 for(let i=0;i<4;i++){await drag(380);await shot('03-rotate-'+i);}
 await page.click('[data-testid="moon-btn-mimas"]');await wait(160);await page.click('[data-testid="moon-btn-tethys"]');
 await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='tethys'&&!c.isTransitioning;},{timeout:50000});await wait(1000);await shot('04-rapid-switch-return');
 faultPhase=true;await page.setCacheEnabled(false);await page.setRequestInterception(true);
 page.on('request',r=>r.url().includes('/tethys/tethys-cassini')?r.respond({status:503,contentType:'image/jpeg',body:''}):r.continue());
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('tethys'));
 await travel('saturn');await travel('tethys',true);await wait(1200);
 const fallback=await shot('05-injected-load-failure');assert.equal(fallback.texture.src,undefined);
 const failed=await page.evaluate(()=>window.__solarEngine.assetManager.getAssetItem('tethys-cassini-pia14931-4k')?.state);assert.equal(failed,'error');
 report.fallback={injected503:true,state:failed,neutralMaterial:true};
 assert.equal(report.errors.length,0);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({images:report.images.length,errors:report.errors,failure:report.failure}));
