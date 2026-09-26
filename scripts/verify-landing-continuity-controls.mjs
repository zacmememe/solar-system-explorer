// Explicit UI time selection supplies a lit comparison; never change a camera/time privately.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {timePanel} from './lib/hud-ui.mjs';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/landing-continuity/daylight-controls';await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1440,height:900},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
const page=await browser.newPage(),delay=ms=>new Promise(r=>setTimeout(r,ms)),click=id=>page.click(`[data-testid="${id}"]`);
const report={images:[],checks:[],errors:[],visualAcceptance:'NOT_OBSERVED'};page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function shot(name){const state=await page.evaluate(()=>{const e=window.__solarEngine;return {camera:e.getCameraSnapshot(),telemetry:e.getLandingTelemetry(),time:e.getSimTimeHours(),speed:e.getTimeScale()};});report.images.push({name,...state});await page.screenshot({path:path.join(out,name+'.png')});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(name);}
async function speed(value){await timePanel(page);await page.click(`[data-speed="${value}"]`);await page.keyboard.press('Escape');}
async function readySite(id){await page.select('[data-testid="landing-site-select"]',id);await page.waitForFunction(id=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId===id&&['land','travel-to-site'].includes(a.action);},{timeout:90000},id);await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]');}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5207',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('planet-btn-mars');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='mars'&&!c.isTransitioning;});await readySite('gale-murray-buttes');
 if(process.env.DAYLIGHT_ACTION==='1'){
  await timePanel(page);await click('landing-daylight');await shot('00-daylight-time-menu');await page.keyboard.press('Escape');
 }else{
 await speed(21600);await page.click('[aria-label="继续模拟"]');
 await page.waitForFunction(()=>{const e=window.__solarEngine,s=e.getLandingSiteChoices().find(s=>s.id==='gale-murray-buttes');if(!s)return false;const b=e.getBodyWorldPose('mars'),sun=e.getBodyWorldPose('sun'),a=s.centerLat*Math.PI/180,l=s.centerLon*Math.PI/180;const n=b.pos.clone().set(Math.cos(a)*Math.cos(l),Math.sin(a),-Math.cos(a)*Math.sin(l)).applyQuaternion(b.quaternion);const h=n.dot(sun.pos.clone().sub(b.pos).normalize());return h>.45&&h<.7;},{timeout:45000,polling:30});
 await page.click('[aria-label="暂停模拟"]');
 }
 await speed(50);await shot('01-explicit-daylight');
 if(await page.$('[data-testid="lunar-landing-travel-site-btn"]')){await click('lunar-landing-travel-site-btn');await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:30000});}
 const time=await page.evaluate(()=>window.__solarEngine.getSimTimeHours());await click('lunar-landing-start-btn');
 await page.waitForFunction(()=>{const e=window.__solarEngine,c=e.getCameraSnapshot();return e.getLandingTelemetry().state==='DESCENDING'&&c.anchor?.kind==='surface'&&c.anchor.eyeHeightM<550;},{timeout:140000});await click('landing-btn-hold');await shot('02-lit-low-hold');
 await click('landing-btn-return-hold');for(let i=0;i<5;i++){await delay(3300);await shot(`0${i+3}-lit-ascent`);}
 await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='ORBIT',{timeout:30000});await shot('08-lit-return');
 assert.equal(await page.evaluate(()=>window.__solarEngine.getTimeScale()),50);assert.equal(await page.evaluate(()=>window.__solarEngine.getSimTimeHours()),time);report.checks.push('lit journey preserved paused time and restored original 50x');
 await readySite('jezero');
 const standalone=!!await page.$('[data-testid="lunar-landing-travel-site-btn"]');await click(standalone?'lunar-landing-travel-site-btn':'lunar-landing-start-btn');
 await page.waitForFunction(()=>window.__solarEngine.getCameraSnapshot().isTransitioning,{timeout:15000});
 await click(standalone?'hud-cancel-transfer':'landing-btn-cancel-prep');await delay(1300);
 assert.equal(await page.evaluate(()=>window.__solarEngine.getTimeScale()),50);assert.equal(await page.evaluate(()=>window.__solarEngine.getLandingTelemetry().state),'ORBIT');assert.equal(await page.evaluate(()=>window.__solarEngine.getCameraSnapshot().isTransitioning),false);report.checks.push('UI cancel does not restart approach and restores 50x');await shot('09-cancel-keeps-location');
 await readySite('jezero');const standalone2=!!await page.$('[data-testid="lunar-landing-travel-site-btn"]');await click(standalone2?'lunar-landing-travel-site-btn':'lunar-landing-start-btn');
 await page.waitForFunction(()=>window.__solarEngine.getCameraSnapshot().isTransitioning,{timeout:15000});await speed(10);
 if(await page.$('[data-testid="landing-btn-cancel-prep"]'))await click('landing-btn-cancel-prep');else if(await page.$('[data-testid="hud-cancel-transfer"]'))await click('hud-cancel-transfer');else if(await page.$('[data-testid="landing-btn-cancel"]'))await click('landing-btn-cancel');
 await delay(1500);assert.equal(await page.evaluate(()=>window.__solarEngine.getTimeScale()),10);report.checks.push('manual 10x during preparation overrides automatic clock restore');await shot('10-manual-speed-kept');assert.equal(report.errors.length,0);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}console.log(JSON.stringify({checks:report.checks,errors:report.errors,failure:report.failure}));
