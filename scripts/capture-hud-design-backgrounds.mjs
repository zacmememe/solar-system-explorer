// Design references only: normal UI navigation; hide DOM overlays solely for clean scene captures.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {timePanel} from './lib/hud-ui.mjs';
const out='D:/solar-evidence/hud-directions/backgrounds';await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:180000});
const page=await browser.newPage(),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={images:[],errors:[]};page.on('pageerror',e=>report.errors.push(String(e)));
const click=id=>page.click(`[data-testid="${id}"]`);
async function shot(name){
 const pose=await page.evaluate(()=>({camera:window.__solarEngine.getCameraSnapshot(),landing:window.__solarEngine.getLandingTelemetry()}));
 await page.screenshot({path:path.join(out,name+'-current.jpg'),type:'jpeg',quality:92});
 const style=await page.addStyleTag({content:'body *{visibility:hidden!important}canvas{visibility:visible!important}'});
 await delay(120);await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:94});await style.evaluate(e=>e.remove());
 report.images.push({name,pose});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(name);
}
try{
 await page.goto('http://127.0.0.1:5208',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('mars'));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('planet-btn-mars');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='mars'&&!c.isTransitioning;});
 await page.select('[data-testid="landing-site-select"]','jezero');await page.waitForFunction(()=>window.__solarEngine.getLandingAvailability().siteId==='jezero');
 await timePanel(page);await click('landing-daylight');await page.keyboard.press('Escape');await delay(1600);await shot('orbit');
 if(await page.$('[data-testid="lunar-landing-travel-site-btn"]')){await click('lunar-landing-travel-site-btn');await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:60000});}
 await click('lunar-landing-start-btn');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return window.__solarEngine.getLandingTelemetry().state==='DESCENDING'&&c.anchor?.kind==='surface'&&c.anchor.eyeHeightM<28000;},{timeout:140000});
 await click('landing-btn-hold');await delay(1000);await shot('descent');await click('landing-btn-resume');
 await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:120000});await delay(1400);await shot('ground');
}catch(e){report.failure=String(e);process.exitCode=1;console.log(String(e));}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
