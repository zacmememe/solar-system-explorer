import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=process.env.EVIDENCE_DIR||'D:/solar-evidence/hud-directions-16';
await mkdir(root+'/renders',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:root+'/profile',defaultViewport:{width:1920,height:1080}});
const page=await browser.newPage(),report={errors:[],views:[],checks:[],visualAcceptance:'NOT_OBSERVED'},url=pathToFileURL(root+'/HUD三方向比较.html').href;
page.on('pageerror',e=>report.errors.push(String(e)));const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(const phase of ['orbit','descent','ground']){
  for(const scheme of ['a','b','c']){
   await page.goto(`${url}?render=1&scheme=${scheme}&phase=${phase}`);await page.waitForFunction(()=>document.querySelector('.world')&&document.images[0]?.complete);await delay(200);
   const buttons=await page.$$eval('#preview .hud button',els=>els.map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:e.textContent,within:r.x>=0&&r.right<=1920&&r.y>=0&&r.bottom<=1080,hit:e===hit||e.contains(hit)};}));
   assert.ok(buttons.every(b=>b.within&&b.hit),JSON.stringify({scheme,phase,buttons}));
   await page.screenshot({path:`${root}/renders/${scheme}-${phase}.png`});report.views.push({scheme,phase,buttons});
   await page.click('[data-action="faster"]');assert.match(await page.$eval('.clock .value',e=>e.textContent),/200/);
   await page.click('[data-action="slower"]');assert.match(await page.$eval('.clock .value',e=>e.textContent),/50/);
   await page.click('[data-action="pause"]');assert.equal(await page.$eval('.clock-block .kicker',e=>e.textContent),'时间暂停');
   await page.click('[data-action="info"]');await page.waitForSelector('.popover');await page.keyboard.press('Escape');assert.equal(await page.$('.popover'),null);
   if(phase==='descent'){await page.click('[data-action="hold"]');assert.match(await page.$eval('[data-action="hold"]',e=>e.textContent),/继续/);await page.click('[data-action="return"]');assert.ok(await page.$('[data-action="land"]'));}
  }
  await page.goto(`${url}?sheet=1&phase=${phase}`);await delay(250);await page.$eval('#sheet',e=>e.scrollIntoView());await(await page.$('#sheet')).screenshot({path:`${root}/renders/compare-${phase}.png`});
 }
 await page.goto(url);await page.click('[data-scheme="b"]');await page.click('#tilt');assert.equal(await page.$eval('#preview .wing',e=>e.style.transform),'none');await page.click('#tilt');
 await page.click('#immersive');assert.ok(await page.$('body.immersive'));await page.keyboard.press('Escape');assert.equal(await page.$('body.immersive'),null);
 await page.keyboard.press('3');assert.ok(await page.$('#preview .hud.c'));await page.keyboard.press('g');assert.match(await page.$eval('#preview .metric',e=>e.textContent),/SURFACE/);
 await page.setViewport({width:1440,height:1000});await page.click('[data-scheme="a"]');await page.click('[data-phase="descent"]');await delay(200);await page.screenshot({path:root+'/renders/comparison-page.png',fullPage:true});
 report.checks.push('9 views: buttons in bounds and hit-test reachable','9 views: direct speed, pause, details, Escape','3 schemes: hold/resume and return','scheme and phase selection, keyboard, tilt toggle, immersive exit');assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await page.screenshot({path:root+'/failure.png'});}
finally{await writeFile(root+'/preview-checks.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({result:report.result,views:report.views.length,checks:report.checks,errors:report.errors,failure:report.failure}));
