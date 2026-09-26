// Normal UI writes; engine and DOM reads only. Site-travel identity and cancellation.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/hud-task-arc/final-controls';await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:out+'/profile-'+process.pid,defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:90000});
const page=await browser.newPage(),report={checks:[],images:[],errors:[]},delay=ms=>new Promise(r=>setTimeout(r,ms));
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const click=id=>page.click(`[data-testid="${id}"]`);
async function shot(name){await page.screenshot({path:out+'/'+name+'.png'});report.images.push({name,camera:await page.evaluate(()=>window.__solarEngine.getCameraSnapshot()),phase:await page.$eval('[data-testid="mission-hud"]',e=>e.dataset.phase)});console.log(name);}
try {
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5210',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
 report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('moon-btn-moon');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='moon'&&!c.isTransitioning;});
 await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]','tranquility-base');
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"],[data-testid="lunar-landing-travel-site-btn"]',{timeout:90000});
 for(const width of [1920,1440,1280,1024]){
  await page.setViewport({width,height:900});await delay(250);
  const controls=await page.$$eval('.hud-layout button,.hud-layout select',els=>els.map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:el.textContent,height:r.height,x:r.x,right:r.right,within:r.x>=0&&r.right<=innerWidth,reachable:el===hit||el.contains(hit)};}));
  assert.ok(controls.every(c=>c.within&&c.reachable&&c.height>=44),'space controls reachable at '+width);
  report.checks.push('space controls within viewport and reachable at '+width);
 }
 await page.setViewport({width:1920,height:1080});await delay(250);
 for(let i=0;i<12&&!await page.$('[data-testid="lunar-landing-travel-site-btn"]');i++){
  await page.mouse.move(850,430);await page.mouse.down();await page.mouse.move(1080,430,{steps:10});await page.mouse.up();await delay(250);
 }
 assert.ok(await page.$('[data-testid="lunar-landing-travel-site-btn"]'),'normal drag exposes far-side landing site');
 const selected=await page.$eval('[data-testid="landing-site-select"]',el=>el.selectedOptions[0].textContent.split(' · ')[0]);
 await shot('01-far-side');await click('lunar-landing-travel-site-btn');
 await page.waitForSelector('[data-testid="mission-hud"][data-phase="site_travel"]');
 assert.ok((await page.$eval('[data-testid="hud-transfer"]',el=>el.textContent)).includes(selected),'site name survives empty transitional site choices');
 assert.equal(await page.$('[data-testid="toolbar-hangar-btn"]'),null);
 report.checks.push('explicit site travel preserves chosen name, stage and vehicle restriction');await shot('02-site-travel');
 await click('hud-cancel-transfer');await page.waitForFunction(()=>!window.__solarEngine.getCameraSnapshot().isTransitioning);
 await delay(400);assert.notEqual(await page.$eval('[data-testid="mission-hud"]',e=>e.dataset.phase),'site_travel');
 await delay(1800);assert.equal(await page.$('[data-testid="hud-transfer"]'),null);report.checks.push('cancel removes journey arc and does not restart');await shot('03-cancelled');
 await click('hud-navigation');assert.ok(await page.$('[data-testid="hud-context-map"]'));
 await shot('04-position-lens');await page.keyboard.press('Escape');
 assert.equal(await page.$eval('[data-testid="hud-navigation"]',el=>el===document.activeElement),true);
 report.checks.push('position lens opens after cancellation and Escape restores focus');
 assert.equal(report.errors.length,0);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
