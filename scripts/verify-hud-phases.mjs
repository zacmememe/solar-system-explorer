// UI writes only. Engine reads bind displayed phases/readings to actual observer state.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {journeyAction} from './lib/hud-ui.mjs';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/phase-aware-hud/candidate';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(), delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={bundle:[],checks:[],images:[],errors:[],consoleErrors:[],httpErrors:[],visualAcceptance:'NOT_OBSERVED'};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
const check=(label,pass)=>{report.checks.push({label,pass});assert.ok(pass,label);};
const snapshot=()=>page.evaluate(()=>({camera:window.__solarEngine.getCameraSnapshot(),telemetry:window.__solarEngine.getLandingTelemetry(),phase:document.querySelector('[data-testid="mission-hud"]').dataset.phase,agl:document.querySelector('[data-testid="telemetry-agl-value"]')?.textContent,simTime:window.__solarEngine.getSimTimeHours()}));
async function click(selector){await page.waitForSelector(selector,{visible:true});await page.click(selector);}
async function shot(name){const state=await snapshot();await page.screenshot({path:path.join(out,name+'.png')});report.images.push({name,viewport:page.viewport(),...state});console.log('captured',name);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
async function phase(value){await page.waitForFunction(value=>document.querySelector('[data-testid="mission-hud"]')?.dataset.phase===value,{timeout:60000},value);}
async function travel(id,moon=false){await click('[data-testid="'+(moon?'moon':'planet')+'-btn-'+id+'"]');await page.waitForFunction(id=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId===id&&!c.isTransitioning;},{timeout:60000},id);await delay(300);}
async function drag(dx,dy=0){const v=page.viewport(),x=v.width*.40,y=v.height*.42;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();await delay(250);}
async function saveOverview(){
 await click('[data-testid="toolbar-bookmark-btn"]');await click('[data-testid="bookmark-tab-custom"]');
 const before=await page.$$eval('[data-testid^="bookmark-fly-"]',els=>els.map(e=>e.getAttribute('data-testid')));
 await click('[data-testid="bookmark-btn-add"]');await page.click('[data-testid="bookmark-save-title-input"]',{clickCount:3});await page.type('[data-testid="bookmark-save-title-input"]','QA HUD overview');await click('[data-testid="bookmark-save-submit-btn"]');
 const ids=await page.$$eval('[data-testid^="bookmark-fly-"]',els=>els.map(e=>e.getAttribute('data-testid'))),id=ids.find(id=>!before.includes(id));
 check('overview bookmark saved by UI',!!id);await click('[data-testid="bookmark-modal-close-btn"]');return id;
}
async function layout(name){
 const info=await page.evaluate(()=>{
   const el=document.querySelector('[data-testid="mission-hud"]'),r=el.getBoundingClientRect();
   const boxes=[...el.querySelectorAll('.hud-flight,.hud-context,.hud-target')].map(e=>{const q=e.getBoundingClientRect();return {x:q.x,y:q.y,right:q.right,bottom:q.bottom};});
   const buttons=[...el.querySelectorAll('.hud-mission-actions button')].map(b=>{const q=b.getBoundingClientRect();const hit=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return {text:b.textContent,height:q.height,clickable:!!hit&&(hit===b||b.contains(hit))};});
   return {hudHeight:r.height,scrimHeight:el.querySelector('.hud-scrim').getBoundingClientRect().height,phase:el.dataset.phase,viewport:[innerWidth,innerHeight],boxes,buttons,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 check(name+' HUD within viewport',!info.overflow&&info.boxes.every(b=>b.x>=0&&b.y>=0&&b.right<=info.viewport[0]+1&&b.bottom<=info.viewport[1]+1));
 check(name+' sections do not overlap',info.boxes.every((a,i)=>info.boxes.slice(i+1).every(b=>Math.min(a.right,b.right)<=Math.max(a.x,b.x)+.5||Math.min(a.bottom,b.bottom)<=Math.max(a.y,b.y)+.5)));
 check(name+' mission buttons reachable >=44px',info.buttons.every(b=>b.height>=44&&b.clickable));
 if(['hold','surface_look','descending'].includes(info.phase))check(name+' essential journey controls present',info.buttons.length>=(info.phase==='surface_look'?1:2));
 check(name+' compact strip including fade',info.scrimHeight<=(info.viewport[0]>1250?110:220));
 report.checks.push({label:name+' layout metrics',pass:true,info});
}
async function popupLayout(name){
 const info=await page.evaluate(()=>{
   const panel=document.querySelector('.hud-popover'),r=panel.getBoundingClientRect();
   const nav=document.querySelector('.app-satellite-bar')?.getBoundingClientRect();
   const close=panel.querySelector('[aria-label="关闭面板"]'),c=close.getBoundingClientRect();
   const hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
   return {top:r.top,bottom:r.bottom,navBottom:nav?.bottom??0,viewportHeight:innerHeight,closeReachable:hit===close||close.contains(hit)};
 });
 report.checks.push({label:name+' popup metrics',pass:true,info});
 check(name+' details clear navigation by 8px',info.top>=info.navBottom+8);
 check(name+' details close reachable within viewport',info.top>=0&&info.bottom<=info.viewportHeight&&info.closeReachable);
}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5204',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]');
 report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
 if(await page.$('[aria-label="暂停模拟"]'))await click('[aria-label="暂停模拟"]');
 await delay(2000);await shot('01-observe');
 await click('[aria-controls="hud-observe-panel"]');
 await click('[data-testid="hud-collapse"]');
 check('collapse gives focus to restore',await page.$eval('.hud-restore',e=>e===document.activeElement));
 await click('.hud-restore');check('restore gives focus to options',await page.$eval('.hud-options',e=>e===document.activeElement));
 await click('[data-testid="hud-navigation"]');
 await click('[aria-label="俯瞰整个太阳系全景"]');await phase('transfer');
 check('navigation closes during transfer',!(await page.$('#hud-navigation-panel')));
 check('overview transition labelled as overview',(await page.$eval('[data-testid="hud-transfer"]',e=>e.textContent)).includes('太阳系全景'));
 await shot('02-overview-transfer');await phase('overview');await shot('03-overview');
 check('overview has no stale planet radius',!(await page.$('.hud-radius')));
 const overviewPose=(await snapshot()).camera.spherical,bookmarkId=await saveOverview();
 await travel('sun');await phase('observe');await click('[data-testid="hud-body-details"]');check('Sun radius available in details',!!(await page.$('.hud-radius')));await page.keyboard.press('Escape');
 await click('[data-testid="toolbar-bookmark-btn"]');await click('[data-testid="bookmark-tab-custom"]');await click('[data-testid="'+bookmarkId+'"]');await phase('overview');
 const restored=(await snapshot()).camera.spherical;check('overview bookmark restores framing and phase',Object.keys(overviewPose).every(k=>Math.abs(overviewPose[k]-restored[k])<1e-5)&&!(await page.$('.hud-radius')));await shot('03b-overview-restored');
 await click('[data-testid="planet-btn-saturn"]');await phase('transfer');await shot('04-transfer');await click('[data-testid="hud-cancel-transfer"]');await phase('free');await shot('05-cancelled');
 const id=process.env.SITE_ID||'jezero',moon=['tranquility-base','taurus-littrow','hadley-rille'].includes(id);
 if(moon){await travel('earth');await travel('moon',true);}else await travel('mars');
 await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]',id);
 await page.waitForFunction(()=>!!document.querySelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]'),{timeout:90000});
 if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await click('[data-testid="lunar-landing-travel-site-btn"]');
 await click('[data-testid="hud-navigation"]');await click('[data-testid="lunar-landing-start-btn"]');
 await delay(110);if((await snapshot()).phase==='preparing')await shot('06-preparing');else report.checks.push({label:'preparing screenshot',status:'NOT_OBSERVED - brief stage; unit assertions cover placeholder suppression'});
 await phase('descending');await shot('07-descending');
 check('navigation closes during descent',!(await page.$('#hud-navigation-panel')));
 const a=await snapshot();await delay(900);const b=await snapshot();check('astronomical pause does not stop guided descent',a.simTime===b.simTime&&b.telemetry.progress>a.telemetry.progress);
 await click('[data-testid="landing-btn-hold"]');await phase('hold');const held=await snapshot();await delay(800);const held2=await snapshot();
 check('HOLD freezes both rates and trajectory',held.telemetry.progress===held2.telemetry.progress&&held2.telemetry.verticalSpeedMps===0&&held2.telemetry.horizontalSpeedMps===0);
 await shot('08-hold-desktop');await layout('desktop HOLD');
 await page.setViewport({width:2560,height:1440});await delay(300);await shot('08b-hold-2560');await layout('2560 HOLD');
 await page.setViewport({width:1440,height:900});await delay(300);await shot('08c-hold-1440');await layout('1440 HOLD');
 await page.setViewport({width:390,height:844});await delay(400);await shot('09-hold-portrait');await layout('portrait HOLD');
 await click('[data-testid="hud-site-details"]');await shot('10-details-portrait');await popupLayout('portrait HOLD');await page.keyboard.press('Escape');
 check('Escape restores info trigger focus',await page.$eval('[data-testid="hud-site-details"]',b=>b===document.activeElement));
 await page.setViewport({width:844,height:390});await delay(400);await shot('11-hold-landscape');await layout('landscape HOLD');
 await click('[data-testid="hud-site-details"]');await shot('11b-details-landscape');await popupLayout('landscape HOLD');await page.keyboard.press('Escape');
 await page.setViewport({width:1920,height:1080});await delay(300);await drag(90);await journeyAction(page,'landing-btn-reguide');await click('[data-testid="landing-btn-resume"]');await phase('descending');
 await phase('surface_look');await journeyAction(page,'landing-btn-reset-look');await delay(1000);await shot('12-surface-desktop');await layout('desktop surface');
 check('surface compass replaces orbit map',!!(await page.$('[data-testid="hud-surface-compass"]'))&&!(await page.$('[data-testid="hud-context-map"]')));
 const yawBefore=await page.$eval('[data-testid="hud-surface-compass"]',e=>Number(e.dataset.yaw));await drag(180,-140);
 const yawAfter=await page.$eval('[data-testid="hud-surface-compass"]',e=>Number(e.dataset.yaw));check('compass responds to actual looking direction',Math.abs(yawBefore-yawAfter)>1);await shot('13-look-sky');
 if(moon){await click('[data-testid="landing-btn-look-earth"]');await delay(1200);await shot('14-look-earth');}
 await page.setViewport({width:390,height:844});await delay(300);await shot('15-surface-portrait');await layout('portrait surface');
 await click('[data-testid="hud-site-details"]');await shot('16-surface-details');await popupLayout('portrait surface');await click('[aria-label="关闭面板"]');
 await click('[data-testid="landing-btn-return-orbit"]');await phase('ascending');const asc0=await snapshot();await delay(1500);const asc1=await snapshot();
 check('return starts below completion and advances',asc0.telemetry.progress<.3&&asc1.telemetry.progress>asc0.telemetry.progress&&asc1.telemetry.progress<1);
 await shot('17-ascending');await layout('portrait ascending');
 await page.waitForFunction(()=>{const e=window.__solarEngine;return e.getLandingTelemetry().state==='ORBIT'&&e.getCameraSnapshot().mode==='ORBIT_TARGET'&&!e.getCameraSnapshot().isTransitioning&&document.querySelector('[data-testid="mission-hud"]')?.dataset.phase==='observe';},{timeout:60000});await delay(500);await shot('18-returned');await layout('portrait returned');
 check('return leaves default view uncluttered',!(await page.$('[data-testid="hud-context-map"]'))&&!(await page.$('[data-testid="hud-altitude-profile"]')));
 await click('[data-testid="hud-navigation"]');check('context map is available on demand',!!(await page.$('[data-testid="hud-context-map"]')));await shot('19-navigation-menu');await page.keyboard.press('Escape');
 check('no runtime or resource errors',!report.errors.length&&!report.consoleErrors.length&&!report.httpErrors.length);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks.length,images:report.images.length,failure:report.failure,errors:report.errors,consoleErrors:report.consoleErrors,httpErrors:report.httpErrors}));
